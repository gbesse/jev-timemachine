# jev-timemachine

**Replay changed DecisionPacks over historical data, pay only for genuinely new questions, and measure which decisions flip.**

[![Tests](https://github.com/gbesse/jev-timemachine/actions/workflows/test.yml/badge.svg)](https://github.com/gbesse/jev-timemachine/actions/workflows/test.yml) [MIT](LICENSE) · Node.js 22+ · No runtime dependencies · Public alpha

Jev input is paid while typed output is free, and a corpus can now be re-judged routinely. This tool makes that economic property durable: each question/item judgment is content-addressed and bought once, while thresholds and ordered policy gates can be replayed for free.

## 30-second offline quick start

```sh
git clone https://github.com/gbesse/jev-timemachine.git
cd jev-timemachine
npm run demo
```

The demo imports two synthetic records, runs a policy twice, shows the cache hit, changes a threshold and builds an offline report. Fixture probabilities are synthetic, not measured Jev output.

## Call real Jev

```sh
export TYPESAFE_API_KEY=... # paid requests go to https://api.typesafe.ai/v1/systemone
jev-timemachine import history.jsonl --store local-data/history
jev-timemachine estimate policy.json --store local-data/history
jev-timemachine run policy.json --store local-data/history --budget-usd 5
```

Policies use DecisionPacks pack format v1 verbatim: schema version, pinned model, input declaration, Jev questions, ordered rules and fallback. This project reimplements validation and does not depend on DecisionPacks. Official SDKs are an alternative; the bundled client is dependency-free.

## How it decides

Each corpus version hashes `{text, meta}`. Each stored judgment hashes the model, individual question fingerprint and item hash. A policy edit touching one of eight questions therefore reuses seven-eighths of prior judgments. Missing questions for one item fan out in one request. Rules then evaluate typed fields such as `answers.urgent.noul >= 0.8` in order; thresholds are illustrative, not calibrated guarantees.

`whatif` and threshold sweeps make zero provider calls. `timeline` reports outcome mix by month/year as data drift, never model degradation. `comparePolicies` reports Wilson accuracy intervals and McNemar's exact paired test; a p-value is not a business decision. See [docs/method.md](docs/method.md).

## Boundaries

The JSONL store is single-process and append-only, not a database. CSV parsing is intentionally basic. Reports are evidence aids, not causal estimates. Jev reads literally, is weak at dates/counts and can follow injected text; dates, slicing, hashes and arithmetic stay in code. No live benchmark was run.

## Shareable demo report

Run `npm run demo:report` to capture this repository’s bundled example as one JSON object with the project purpose, version and complete demo output. The command fails if the demo fails, so the report is useful when sharing a reproducible first look or reporting unexpected behavior. The bundled demo’s data and safety boundaries still apply.

## Validation

`npm run check && npm run typecheck && npm test && npm run demo` runs in CI on Node 22 and 24. `npm run live-smoke` is opt-in and makes one synthetic paid request.

## Related projects

[DecisionPacks](https://github.com/gbesse/decisionpacks) handles free gate-only replay; [Autonomy Meter](https://github.com/gbesse/autonomy-meter) calibrates thresholds; [Question Forge](https://github.com/gbesse/question-forge) develops questions; [jev-codebook](https://github.com/gbesse/jev-codebook) compares labels.

Independent project; not affiliated with TypeSafe AI. [API](https://docs.typesafe.ai/api) · [model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
