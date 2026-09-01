# WORTH bridge evidence

The local **Solari UI API Builder** demo has one public capability:

```ts
trades.ingestIncomingTrade({ messageId })
```

Its contract remains stable while its private replay changes. WORTH is the
runtime authority for replay lifecycle and recovery; the portal is a
deterministic in-memory Mailroom and Financials demo, not an authority store.

## What the bridge owns

`worth-runtime-host` installs a typed application runtime through WORTH's
public `worth-query-host` facade. It serves only the application reads and
typed recovery operations needed by this demo. The TypeScript adapter owns
process transport and request correlation only; it has no replay reducer,
ledger, or local fallback.

The seeded replay is `replay.trades.ingest-incoming-trade.v1`. It deliberately
clicks the removed **Open attachment** control and fails. WORTH then records
the degradation. A supplied v2 replay delivers the fixed trade email, posts it
to Financials, and verifies `POSTED FT-1042` in three fresh Solari sessions.
Only after those receipts does WORTH activate v2 under the unchanged capability
identity `capability.trades.ingest-incoming-trade`.

## Evidence paths

- [Typed public contract](apps/orchestrator/src/enron-online/contracts.ts)
- [Semantic tool publication](apps/orchestrator/src/enron-online/tool-publication.ts)
- [Deterministic ingestion and idempotency](apps/orchestrator/src/enron-online/ingestion.ts)
- [Live recovery scenario](apps/orchestrator/test/live/enron-recovery.ts)
- [WORTH host seed and recovery API](worth-runtime-host/src/host.rs)
- [Narrow WORTH fixture](worth-runtime-host/src/host/demo_fixture.rs)

`cargo test --manifest-path worth-runtime-host/Cargo.toml` exercises the
WORTH-backed lifecycle transitions, including denials for stale revisions,
duplicate verification sessions, and insufficient fresh-session verification.
`npm run demo:enron:recovery` is the opt-in live browser proof.

## Limits kept explicit

The WORTH graph and portal state are intentionally in memory for the demo.
The initial replay and candidate are supplied fixtures, not discovered from a
production UI. Solari evidence establishes browser execution; WORTH retains
the lifecycle decisions and verification receipts. The generic benchmark
library remains an independent package, but it is not a demo workflow or
portal surface.
