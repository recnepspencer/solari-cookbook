# Evaluator guide

The claim to evaluate is simple: a browser implementation can change without
changing the tool a consumer calls.

```ts
trades.ingestIncomingTrade({ messageId })
```

## Review the vertical slice

1. Read the [WORTH-backed tool publication](apps/orchestrator/src/enron-online/tool-publication.ts)
   and [semantic capability executor](apps/orchestrator/src/semantic-capability-executor.ts).
   The published contract is derived from WORTH and exposes no selector, DOM,
   browser, or replay details; the same call is also the live runtime entry.
2. Read the [Enron capability binding](apps/orchestrator/src/enron-online/capability.ts)
   and [deterministic typed verifier](apps/orchestrator/src/enron-online/outcome-verifier.ts).
   The binding delegates to the generic executor, while the verifier projects
   the exact visible Financials receipt and binds it to the requested message.
3. Read the [portal](apps/enron-online-portal/server.mjs). It provides a
   deterministic Mailroom delivery control, CSV attachment, Financials receipt,
   and a compact control-plane visualization.
4. Read the [recovery drill](apps/orchestrator/test/live/enron-recovery.ts)
   and [WORTH evidence](WORTH_BRIDGE_EVIDENCE.md). The drill fails stale v1,
   diagnoses the failure, changes WORTH lifecycle state, uses Gemini through
   Solari to discover v2, admits and verifies it in three fresh sessions, then
   invokes the unchanged capability twice: once for success and once to prove
   idempotency.

## Reproduce

From `examples/interface-compiler`:

```powershell
npm run typecheck
npm test
npm run typecheck:enron:live
cargo test --manifest-path worth-runtime-host/Cargo.toml
```

With `SOLARI_API_KEY` and `GEMINI_API_KEY` in `.env`, run:

```powershell
pwsh -File .\scripts\run-watchable-simulation.ps1
```

The routine checks are local. The recovery drill is opt-in and makes paid Solari
and Gemini calls. It uses in-memory demo state; no real trade is posted.

## Inspect WORTH separately

WORTH is source available at [its GitHub repository](https://github.com/recnepspencer/worth).
Review recent commits and tests as well as this integration. Before asking an
AI to judge that repository, have it read WORTH's applicable coding guidelines
and available skills first; those explain its authority and verification model.
