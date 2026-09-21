// Purpose: Hardened zero-dependency Jev client and validated offline fake provider.
import { setTimeout as sleep } from 'node:timers/promises';
import { estimateTokens } from './index.mjs';
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
export function createJevClient({ apiKey = process.env.TYPESAFE_API_KEY, endpoint = 'https://api.typesafe.ai/v1/systemone', model = 'jev-1.13.0', timeoutMs = 30_000, maxRetries = 2, fetchImpl = globalThis.fetch } = {}) {
  ensure(apiKey, 'Set TYPESAFE_API_KEY to call Jev'); const url = new URL(endpoint); ensure(url.protocol === 'https:' || (url.protocol === 'http:' && loopback.has(url.hostname)), 'Endpoint must use HTTPS (loopback HTTP allowed for tests)');
  return async ({ state, questions, signal }) => { ensure(estimateTokens(state) <= 24_000, 'State exceeds 24000-token budget'); const body = JSON.stringify({ model, state, questions });
    for (let attempt = 0; ; attempt += 1) { const timeout = AbortSignal.timeout(timeoutMs); try { const response = await fetchImpl(url, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); if ([429, 529].includes(response.status) && attempt < maxRetries) { await response.text(); await sleep(10 * 2 ** attempt); continue; } if (!response.ok) throw new Error(`Jev HTTP ${response.status}: ${(await response.text()).slice(0, 200).split(apiKey).join('[redacted]')}`); const json = await response.json(); ensure(json.model === model, 'Jev model mismatch'); return json; } catch (error) { if (timeout.aborted) throw new Error(`Jev timeout after ${timeoutMs} ms`); if (signal?.aborted) throw signal.reason; if (attempt < maxRetries && !String(error.message).startsWith('Jev HTTP')) { await sleep(10 * 2 ** attempt); continue; } throw error; } }
  };
}
export function createFakeProvider(resolve) { const calls = []; const provider = async request => { calls.push(structuredClone(request)); const answers = {}; for (const [id, q] of Object.entries(request.questions)) answers[id] = resolve(request.state, id, q); return { model: request.model, answers, usage: { input_tokens: estimateTokens(request), output_tokens: 0 } }; }; provider.calls = calls; return provider; }
