# Solari UI API Builder

Solari UI API Builder turns cross-application computer use into typed, versioned workflows agents can call by intent.

The demo ingests an incoming energy-trade email and its CSV attachment into a local Financials surface through one stable public contract:

```ts
trades.ingestIncomingTrade({ messageId })
// => { status, tradeId, financialReceiptId, sourceMessageId, idempotencyKey }
```

The consumer never receives selectors, page state, attachment bytes, CSV columns, or Financials-specific UI knowledge. Solari operates the private browser surfaces. WORTH is the runtime authority for active replay implementations, verification evidence, health, degradation, and replacement history.

The local Mailroom and Financials surfaces are deterministic and in-memory. Delivery identity plus the attachment SHA-256 forms the idempotency key, so duplicate delivery returns the existing receipt and creates no second Financials trade.

## Run it

```powershell
pwsh -File .\scripts\bootstrap.ps1
docker compose --profile portal up --build
```

Open `http://127.0.0.1:4310/?page=mail`, deliver the trade email, then post it to Financials. The control-plane page shows the public contract, active implementation, evidence posture, timeline, and idempotency outcome.

For the watchable WORTH/Solari recovery drill, place `SOLARI_API_KEY` in the ignored `.env`, then run:

```powershell
pwsh -File .\scripts\run-watchable-simulation.ps1 -Scenario recovery
```

The supplied drill intentionally runs stale v1, lets WORTH degrade it, verifies v2 in three fresh Solari sessions, activates v2, and reruns the exact same `trades.ingestIncomingTrade({ messageId })` contract.

See [SETUP.md](SETUP.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [WORTH bridge evidence](WORTH_BRIDGE_EVIDENCE.md).
