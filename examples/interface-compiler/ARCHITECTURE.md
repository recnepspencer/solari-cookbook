# Solari UI API Builder architecture

`trades.ingestIncomingTrade({ messageId })` is the consumer contract. It accepts a delivered source-message reference and returns a typed Financials receipt. The contract omits mail UI, CSV shape, canonical mapping, and Financials controls.

The local portal provides two deterministic operational surfaces: Mailroom supplies a fixed message and attachment; Financials shows the verified trade receipt. Its in-memory idempotency key is `messageId:sha256(attachment bytes)`, so duplicate work returns the original receipt without another Financials post.

Solari operates the private UI implementation. WORTH Query is the authority for the active replay, execution admission and settlement, verification receipts, degradation, replacement activation, and history. The orchestrator owns only in-flight external-effect coordination.

Recovery preserves the public contract: stale replay v1 targets a removed Mailroom action, WORTH degrades it, three fresh Solari sessions verify supplied v2, and WORTH activates v2. The caller still invokes `trades.ingestIncomingTrade({ messageId })`.

The WORTH graph and portal state are intentionally in memory for the demo. This does not create a competing capability authority: restart discards the demonstration state.
