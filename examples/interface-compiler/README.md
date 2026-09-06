# Solari UI API Builder

Solari UI API Builder turns cross-application computer use into typed, versioned workflows agents can call by intent.

The demo ingests an incoming energy-trade email and its CSV attachment into a local Financials surface through one stable public contract:

```ts
trades.ingestIncomingTrade({ messageId })
// => { status, tradeId, financialReceiptId, sourceMessageId, idempotencyKey }
```

The consumer never receives selectors, page state, attachment bytes, CSV columns, or Financials-specific UI knowledge. Every invocation enters the generic semantic capability executor, which reads the full contract and active replay from WORTH, executes that replay through Solari, verifies the typed result, and settles it back through WORTH. WORTH is the runtime authority for contracts, replay implementations, verification evidence, health, degradation, and replacement history.

The local Mailroom and Financials surfaces are deterministic and in-memory. Delivery identity plus the attachment SHA-256 forms the idempotency key, so duplicate delivery returns the existing receipt and creates no second Financials trade.

## Run it

```powershell
pwsh -File .\scripts\bootstrap.ps1
docker compose --profile portal up --build
```

Open `http://127.0.0.1:4310/?page=mail`, deliver the trade email, then post it to Financials. The control-plane page shows the public contract, active implementation, evidence posture, timeline, and idempotency outcome.

For the watchable WORTH/Solari/Gemini recovery drill, place `SOLARI_API_KEY` and `GEMINI_API_KEY` in the ignored `.env`, then run:

```powershell
pwsh -File .\scripts\run-watchable-simulation.ps1 -Scenario recovery
```

The drill intentionally invokes the semantic capability while stale v1 is active, classifies its missing target as UI drift, and lets WORTH degrade it. Gemini 3.7 Flash then explores the changed UI through Solari; only actions it actually completed are compiled into candidate v2. WORTH admits that candidate before verification, records three fresh-session receipts, and activates it. The first call returns typed retryable `capability_recovered`; the next identical call uses v2 and returns the Financials receipt; a third returns `duplicate` without a second post.

See [SETUP.md](SETUP.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [WORTH bridge evidence](WORTH_BRIDGE_EVIDENCE.md).
