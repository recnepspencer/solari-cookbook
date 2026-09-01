# Evaluator guide

The claim to evaluate is simple: a browser implementation can change without
changing the tool a consumer calls.

```ts
trades.ingestIncomingTrade({ messageId })
```

## Review the vertical slice

1. Read the [public contract](apps/orchestrator/src/enron-online/contracts.ts)
   and [tool publication](apps/orchestrator/src/enron-online/tool-publication.ts).
   They expose one semantic call and no selector, DOM, browser, or replay
   details.
2. Read the [ingestion model](apps/orchestrator/src/enron-online/ingestion.ts).
   It validates a canonical trade, hashes source identity and attachment bytes,
   posts once, verifies the Financials receipt, and returns that same receipt on
   a duplicate request.
3. Read the [portal](apps/enron-online-portal/server.mjs). It provides a
   deterministic Mailroom delivery control, CSV attachment, Financials receipt,
   and a compact control-plane visualization.
4. Read the [recovery drill](apps/orchestrator/test/live/enron-recovery.ts)
   and [WORTH evidence](WORTH_BRIDGE_EVIDENCE.md). The drill fails stale v1,
   changes WORTH lifecycle state, verifies v2 in three fresh Solari sessions,
   then invokes the unchanged capability again.

## Reproduce

From `examples/interface-compiler`:

```powershell
npm run typecheck
npm test
npm run typecheck:enron:live
cargo test --manifest-path worth-runtime-host/Cargo.toml
```

With `SOLARI_API_KEY` in `.env`, run:

```powershell
pwsh -File .\scripts\run-watchable-simulation.ps1
```

The routine checks are local. The recovery drill is opt-in and makes Solari
calls. It uses in-memory demo state; no real trade is posted.

## Inspect WORTH separately

WORTH is source available at [its GitHub repository](https://github.com/recnepspencer/worth).
Review recent commits and tests as well as this integration. Before asking an
AI to judge that repository, have it read WORTH's applicable coding guidelines
and available skills first; those explain its authority and verification model.
