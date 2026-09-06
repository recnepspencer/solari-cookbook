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

The semantic capability executor reads the full contract and seeded replay
`replay.trades.ingest-incoming-trade.v1` from WORTH. The replay deliberately
clicks the removed **Open attachment** control and fails. WORTH then records
the degradation only after the orchestrator diagnoses confirmed UI drift.
Gemini 3.7 Flash then explores the changed UI through Solari. Candidate v2 is
compiled from the semantic actions that completed during that WORTH-admitted
execution; model-proposed selectors and unexecuted actions cannot enter it.
WORTH admits the candidate and retains three fresh-session receipts that verify
`POSTED FT-1042`. Only after those receipts does WORTH activate v2 under the
unchanged capability identity `capability.trades.ingest-incoming-trade`.

## Evidence paths

- [Generic semantic capability executor](apps/orchestrator/src/semantic-capability-executor.ts)
- [Enron capability binding](apps/orchestrator/src/enron-online/capability.ts)
- [Semantic tool publication](apps/orchestrator/src/enron-online/tool-publication.ts)
- [Typed receipt verifier](apps/orchestrator/src/enron-online/outcome-verifier.ts)
- [Live recovery scenario](apps/orchestrator/test/live/enron-recovery.ts)
- [Gemini-to-replay compiler](apps/orchestrator/src/replay-discovery.ts)
- [Failure diagnosis gate](apps/orchestrator/src/failure-diagnosis.ts)
- [WORTH host seed and recovery API](worth-runtime-host/src/host.rs)
- [Narrow WORTH fixture](worth-runtime-host/src/host/demo_fixture.rs)

`cargo test --manifest-path worth-runtime-host/Cargo.toml` exercises the
WORTH-backed lifecycle transitions, including denials for stale revisions,
duplicate verification sessions, and insufficient fresh-session verification.
`npm run demo:enron:recovery` is the opt-in live browser proof.

## Limits kept explicit

The WORTH graph and portal state are intentionally in memory for the demo, and
the initial broken replay is a seeded fixture. Candidate v2 is discovered live;
if any candidate fails verification, WORTH records the failed receipt, breaks
that candidate, and permits another discovery cycle until cancellation or the
operation deadline. Solari evidence establishes browser execution; WORTH
retains lifecycle decisions and verification receipts. The
generic benchmark library remains an independent package, but it is not a demo
workflow or portal surface.
