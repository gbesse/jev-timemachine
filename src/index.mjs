// Purpose: Versioned corpus, permanent per-question judgment cache, policy replay, paired statistics and offline reports.
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export { createJevClient, createFakeProvider } from './jev-client.mjs';

export const MODEL = 'jev-1.13.0';
export const PRICE = 0.042;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

export function canonicalJson(value) {
  const walk = item => Array.isArray(item) ? item.map(walk) : object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, walk(item[key])])) : item;
  return JSON.stringify(walk(value));
}
export function sha256(value) { return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex'); }
export function estimateTokens(value) { return Math.ceil((typeof value === 'string' ? value : JSON.stringify(value)).length / 4); }
export function estimateCostUsd(tokens) { return tokens * PRICE / 1_000_000; }

/** DecisionPacks v1 validation, intentionally local so packs move between tools without a runtime dependency. */
export function validatePolicy(pack) {
  ensure(object(pack) && pack.schemaVersion === 1, 'Policy must use DecisionPacks schemaVersion 1');
  for (const key of ['name', 'version', 'description', 'model', 'fallback']) ensure(typeof pack[key] === 'string' && pack[key], `Policy ${key} is required`);
  ensure(pack.model === MODEL, `Policy model must be ${MODEL}`);
  ensure(object(pack.inputs) && object(pack.questions) && Object.keys(pack.questions).length, 'Policy inputs and non-empty questions are required');
  ensure(Array.isArray(pack.rules), 'Policy rules must be an array');
  const ids = new Set();
  for (const [id, q] of Object.entries(pack.questions)) {
    ensure(object(q) && ['noul', 'choice', 'score'].includes(q.type), `Question ${id} has invalid type`);
    ensure(typeof q.instructions === 'string' && q.instructions, `Question ${id} needs instructions`);
    if (q.type === 'choice') ensure(object(q.criteria) && Object.keys(q.criteria).length >= 2 && Object.keys(q.criteria).length <= 255, `Question ${id} needs 2-255 choices`);
    if (q.type === 'score') ensure(Array.isArray(q.criteria) && q.criteria.length >= 2 && q.criteria.length <= 10, `Question ${id} needs 2-10 levels`);
  }
  for (const rule of pack.rules) {
    ensure(typeof rule.id === 'string' && !ids.has(rule.id), 'Rule ids must be unique strings'); ids.add(rule.id);
    ensure(typeof rule.outcome === 'string' && Array.isArray(rule.all) && rule.all.length, `Rule ${rule.id} is invalid`);
    for (const p of rule.all) ensure(typeof p.field === 'string' && ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(p.op), `Rule ${rule.id} has invalid predicate`);
  }
  return pack;
}
export function policyFingerprint(pack) { validatePolicy(pack); return sha256(pack); }
export function questionFingerprint(model, id, question) { return sha256({ model, id, question }); }
export function judgmentKey(model, id, question, itemHash) { return sha256(`${model}:${questionFingerprint(model, id, question)}:${itemHash}`); }

function getPath(root, path) { return path.split('.').reduce((value, key) => value?.[key], root); }
function matches({ field, op, value }, root) {
  const actual = getPath(root, field);
  if (actual === undefined) return false;
  return op === 'eq' ? actual === value : op === 'neq' ? actual !== value : op === 'gt' ? actual > value : op === 'gte' ? actual >= value : op === 'lt' ? actual < value : actual <= value;
}
export function decide(pack, item, answers) {
  validatePolicy(pack);
  const rule = pack.rules.find(candidate => candidate.all.every(predicate => matches(predicate, { state: item, answers })));
  return { outcome: rule?.outcome ?? pack.fallback, ruleId: rule?.id ?? null };
}

export function normalizeItem(row, { id = 'id', text = 'text', time = 'occurred_at', meta = [] } = {}) {
  ensure(row[id] !== undefined && row[text] !== undefined && row[time] !== undefined, `Input needs ${id}, ${text} and ${time}`);
  const occurredAt = new Date(row[time]).toISOString();
  const metadata = Object.fromEntries(meta.map(key => [key, row[key]]));
  const item = { id: String(row[id]), occurredAt, text: String(row[text]), meta: metadata };
  return { ...item, hash: sha256({ text: item.text, meta: item.meta }) };
}
export async function importItems(store, rows, mapping = {}) {
  const corpus = join(store, 'corpus'); await mkdir(corpus, { recursive: true });
  const existing = await readCorpus(store);
  const known = new Set(existing.map(item => `${item.id}:${item.hash}`));
  const added = rows.map(row => normalizeItem(row, mapping)).filter(item => !known.has(`${item.id}:${item.hash}`));
  if (added.length) await appendFile(join(corpus, 'items.jsonl'), `${added.map(JSON.stringify).join('\n')}\n`, 'utf8');
  return { added: added.length, unchanged: rows.length - added.length, items: added };
}
export async function readCorpus(store) {
  const dir = join(store, 'corpus');
  let files; try { files = (await readdir(dir)).filter(file => file.endsWith('.jsonl')).sort(); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const items = [];
  for (const file of files) for (const line of (await readFile(join(dir, file), 'utf8')).split('\n')) if (line.trim()) items.push(JSON.parse(line));
  return items;
}
export function sliceItems(items, { from, to } = {}) {
  const start = from ? Date.parse(from) : -Infinity, end = to ? Date.parse(to) : Infinity;
  return items.filter(item => Date.parse(item.occurredAt) >= start && Date.parse(item.occurredAt) < end);
}

async function loadJudgment(store, key) { try { return JSON.parse(await readFile(join(store, 'judgments', `${key}.json`), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function saveJudgment(store, key, value) { const dir = join(store, 'judgments'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, `${key}.json`), `${JSON.stringify(value)}\n`); }
function validateAnswer(question, answer) {
  ensure(object(answer) && answer.type === question.type, 'Jev answer type mismatch');
  if (question.type === 'noul') ensure(typeof answer.noul === 'number' && answer.noul >= 0 && answer.noul <= 1, 'Invalid noul answer');
  if (question.type === 'choice') ensure(Object.hasOwn(question.criteria, answer.choice) && typeof answer.confidence === 'number' && object(answer.probabilities), 'Invalid choice answer');
  if (question.type === 'score') ensure(Number.isFinite(answer.score) && answer.score >= 0 && answer.score < question.criteria.length && typeof answer.confidence === 'number', 'Invalid score answer');
}

export async function estimateRun(store, pack, range = {}) {
  validatePolicy(pack); const items = sliceItems(await readCorpus(store), range);
  let cached = 0, toBuy = 0, inputTokens = 0;
  for (const item of items) for (const [id, q] of Object.entries(pack.questions)) {
    if (await loadJudgment(store, judgmentKey(pack.model, id, q, item.hash))) cached += 1;
    else { toBuy += 1; inputTokens += estimateTokens({ model: pack.model, state: item, questions: { [id]: q } }); }
  }
  return { items: items.length, cachedQuestions: cached, questionsToBuy: toBuy, estimatedInputTokens: inputTokens, estimatedCostUsd: estimateCostUsd(inputTokens) };
}

export async function runPolicy(store, pack, { provider, budgetUsd = Infinity, from, to, now = () => new Date() } = {}) {
  validatePolicy(pack); ensure(typeof provider === 'function', 'provider is required');
  const startedAt = now().toISOString(), items = sliceItems(await readCorpus(store), { from, to });
  const results = []; let bought = 0, cached = 0, inputTokens = 0, stoppedForBudget = false;
  for (const item of items) {
    const answers = {}; const missing = {};
    for (const [id, q] of Object.entries(pack.questions)) {
      const key = judgmentKey(pack.model, id, q, item.hash), saved = await loadJudgment(store, key);
      if (saved) { answers[id] = saved.answer; cached += 1; } else missing[id] = q;
    }
    if (Object.keys(missing).length) {
      const predicted = estimateCostUsd(estimateTokens({ model: pack.model, state: item, questions: missing }));
      if (estimateCostUsd(inputTokens) + predicted > budgetUsd) { stoppedForBudget = true; break; }
      const response = await provider({ model: pack.model, state: item, questions: missing });
      ensure(response.model === pack.model && object(response.answers), 'Provider returned invalid response');
      inputTokens += response.usage?.input_tokens ?? estimateTokens({ state: item, questions: missing });
      for (const [id, q] of Object.entries(missing)) {
        validateAnswer(q, response.answers[id]); answers[id] = response.answers[id]; bought += 1;
        await saveJudgment(store, judgmentKey(pack.model, id, q, item.hash), { model: pack.model, itemHash: item.hash, questionFingerprint: questionFingerprint(pack.model, id, q), answer: response.answers[id], timestamp: now().toISOString() });
      }
    }
    results.push({ item, answers, ...decide(pack, item, answers) });
  }
  const run = { runId: randomUUID(), policyFingerprint: policyFingerprint(pack), model: pack.model, slice: { from: from ?? null, to: to ?? null }, itemCount: results.length, boughtJudgments: bought, cachedJudgments: cached, inputTokens, estimatedCostUsd: estimateCostUsd(inputTokens), stoppedForBudget, startedAt, finishedAt: now().toISOString(), results };
  const dir = join(store, 'runs'); await mkdir(dir, { recursive: true }); await writeFile(join(dir, `${run.runId}.json`), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

export async function diffPolicies(store, before, after, options) {
  const a = await runPolicy(store, before, options), b = await runPolicy(store, after, options);
  const map = new Map(b.results.map(row => [row.item.hash, row])); const transitions = {}, examples = [];
  let unchanged = 0, flipped = 0;
  for (const left of a.results) { const right = map.get(left.item.hash); if (!right) continue; const key = `${left.outcome} -> ${right.outcome}`; transitions[key] = (transitions[key] ?? 0) + 1; if (left.outcome === right.outcome) unchanged += 1; else { flipped += 1; if (examples.length < (options.examples ?? 5)) examples.push({ id: left.item.id, from: left.outcome, to: right.outcome, text: left.item.text }); } }
  const totalQuestions = a.boughtJudgments + a.cachedJudgments + b.boughtJudgments + b.cachedJudgments;
  return { diffId: randomUUID(), before: a, after: b, unchanged, flipped, transitions, examples, boughtRatio: totalQuestions ? (a.boughtJudgments + b.boughtJudgments) / totalQuestions : 0 };
}
export function withThresholds(pack, overrides) {
  const clone = structuredClone(pack);
  for (const [questionId, value] of Object.entries(overrides)) for (const rule of clone.rules) for (const predicate of rule.all) if (predicate.field.startsWith(`answers.${questionId}.`)) predicate.value = value;
  return clone;
}
export function whatIf(pack, run, overrides) { const changed = withThresholds(pack, overrides); return run.results.map(row => ({ id: row.item.id, before: row.outcome, after: decide(changed, row.item, row.answers).outcome })); }
export function sweep(pack, run, questionId, start, stop, step) {
  const rows = []; for (let value = start; value <= stop + 1e-12; value += step) { const outcomes = {}; for (const row of whatIf(pack, run, { [questionId]: Number(value.toFixed(12)) })) outcomes[row.after] = (outcomes[row.after] ?? 0) + 1; rows.push({ threshold: Number(value.toFixed(12)), outcomes }); } return rows;
}
export function timeline(run, bucket = 'month') {
  const rows = {};
  for (const result of run.results) { const date = new Date(result.item.occurredAt); const key = bucket === 'year' ? String(date.getUTCFullYear()) : date.toISOString().slice(0, 7); rows[key] ??= {}; rows[key][result.outcome] = (rows[key][result.outcome] ?? 0) + 1; }
  return rows;
}
export function wilson(successes, n, z = 1.959963984540054) { if (!n) return { estimate: null, low: 0, high: 1 }; const p = successes / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / d; return { estimate: p, low: c - m, high: c + m }; }
function combination(n, k) { k = Math.min(k, n - k); let value = 1; for (let i = 1; i <= k; i += 1) value = value * (n - k + i) / i; return value; }
export function mcnemarExact(b, c) { const n = b + c; if (!n) return { b, c, pValue: 1 }; const tail = Math.min(b, c); let sum = 0; for (let k = 0; k <= tail; k += 1) sum += combination(n, k) * 0.5 ** n; return { b, c, pValue: Math.min(1, 2 * sum) }; }
export function comparePolicies(a, b, labels) {
  const byB = new Map(b.results.map(row => [row.item.id, row.outcome])); let correctA = 0, correctB = 0, discordA = 0, discordB = 0, n = 0;
  for (const row of a.results) { if (!(row.item.id in labels) || !byB.has(row.item.id)) continue; n += 1; const ca = row.outcome === labels[row.item.id], cb = byB.get(row.item.id) === labels[row.item.id]; if (ca) correctA += 1; if (cb) correctB += 1; if (ca && !cb) discordA += 1; if (!ca && cb) discordB += 1; }
  return { n, a: wilson(correctA, n), b: wilson(correctB, n), mcnemar: mcnemarExact(discordA, discordB) };
}
export function htmlReport(data) {
  const safe = JSON.stringify(data).replaceAll('<', '\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>jev-timemachine report</title><style>body{font:15px system-ui;max-width:960px;margin:2rem auto}pre{white-space:pre-wrap;background:#f5f5f5;padding:1rem}</style><h1>jev-timemachine report</h1><p>Offline report. Probabilities and decisions come from the recorded run.</p><pre id="report"></pre><script>const data=${safe};document.querySelector('#report').textContent=JSON.stringify(data,null,2)</script>`;
}
