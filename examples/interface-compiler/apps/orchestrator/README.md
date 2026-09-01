# Orchestrator

The orchestrator is WORTH's delegated external-effect worker. It reads an active replay, runs private Solari actions, publishes observed facts, and settles the WORTH-admitted execution. It does not own capability, replay, evidence, or lifecycle state.

The demo's public tool is `trades.ingestIncomingTrade({ messageId })`. Its typed ingestion boundary validates a deterministic CSV into a canonical `Trade`, applies in-memory idempotency, posts Financials, and verifies the receipt. Run `npm test --workspace @interface-compiler/orchestrator` for focused ingestion, idempotency, malformed-input, and runtime tests. `npm run demo:enron:recovery` is the live Solari/WORTH recovery drill.
