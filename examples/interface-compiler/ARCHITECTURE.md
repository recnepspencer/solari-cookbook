# Solari UI API Builder architecture

`trades.ingestIncomingTrade({ messageId })` is the consumer contract. It accepts a delivered source-message reference and returns a typed Financials receipt. The contract omits mail UI, CSV shape, canonical mapping, and Financials controls.

The local portal provides two deterministic operational surfaces: Mailroom supplies a fixed message and attachment; Financials shows the verified trade receipt. Its in-memory idempotency key is `messageId:sha256(attachment bytes)`, so duplicate work returns the original receipt without another Financials post.

Solari operates the private UI implementation. WORTH Query is the authority for the complete contract, active replay, execution admission and settlement, verification receipts, degradation, replacement activation, and history. The orchestrator owns only in-flight external-effect coordination. The only runtime entry is the generic semantic capability executor:

```text
semantic call → WORTH contract/application/replay → WORTH admission → Solari replay
              → typed postcondition verification → WORTH settlement → typed receipt
```

Recovery preserves the public contract: stale replay v1 targets a removed Mailroom action. The orchestrator diagnoses the failure before asking WORTH to alter lifecycle state: an absent semantic target on a healthy same-origin observation is `ui_drift`; a false business postcondition is `semantic_drift`; navigation failure is `application_unavailable`; a still-present target that fails is `interaction_failed`; and authority or browser-provider faults are `provider_failure`. A false WORTH postcondition is paired with a fresh Solari session receipt before settlement; WORTH retains that receipt on the active replay and refuses degradation if the settled evidence reference was not registered. Cleanup uncertainty strips the replay-failure claim. Only confirmed, evidence-backed UI or semantic drift reaches WORTH degradation.

After degradation, Gemini 3.7 Flash explores the current UI through Solari. The model can propose only semantic actions—no selectors, navigation, reads, or assertions—and the candidate contains only actions Solari actually completed. Candidate identity, version, lineage, timestamp, confidence, and contract assertions are assigned outside the model. WORTH admits the candidate before any verification run, retains each independent fresh-session receipt, and activates v2 after three successes. A failed candidate is recorded, marked broken by WORTH, and followed by another bounded discovery cycle. The recovering call returns a typed retry signal rather than repeating a possibly completed side effect; the next identical call resolves WORTH's new active replay.

The WORTH graph and portal state are intentionally in memory for the demo. This does not create a competing capability authority: restart discards the demonstration state.
