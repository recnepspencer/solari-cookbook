# Solari adapter

This package is the live-browser boundary for Interface Compiler. It adapts
the official `@solarisdk/browser` client to the neutral domain `SolariPort`
and `SolariSession` contracts. It does not store capabilities, replay
lineage, executions, or evidence records.

## Setup

From the Interface Compiler workspace:

```bash
npm install
npm run typecheck --workspace @interface-compiler/solari-adapter
npm test --workspace @interface-compiler/solari-adapter
```

Production construction reads configuration only from the process
environment. Set `SOLARI_API_KEY`; optional SDK settings are
`SOLARI_REGION=us-west`, `SOLARI_BASE_URL`, and `SOLARI_TIMEOUT_MS`. No
`.env` loader is used, and the key is never included in telemetry.

The composition root supplies the domain `Clock` and `IdSource` ports, then
calls `createSolariPortFromEnv`. Tests inject a narrow SDK factory, so the
test suite makes no live or paid request.

## Lifecycle and evidence

Session creation follows the cookbook pattern: a fresh `Solari` client launches
with `recording: true`, the returned Playwright-compatible browser creates
pages, and cleanup calls `browser.close()` followed by `solari.close()`.
Cleanup is idempotent and is also started when cancellation or a deadline
crosses an operation. A browser action that was interrupted returns an
`unknown` partial-effect posture; the adapter never guesses whether the
remote action completed.

`captureEvidence({ kind: "session_recording" })` releases the browser, polls
the SDK replay URL up to ten times with the cookbook's three-second upload
interval, and returns the actual Solari URL plus an `EvidenceId` from the
injected id source. Call it before ordinary close when a recording receipt is
required. Screenshot and snapshot capture are explicitly reported as
unsupported until a real artifact owner is provided; the adapter does not
embed bytes or invent references. The current `SolariSession` contract has no
output carrier for `ReadStep`, so the adapter rejects that step explicitly
until its owning replay contract can carry the value.

The adapter returns only typed external-effect outcomes and actual Solari
receipts through the domain contracts. Worth Query is the Interface Compiler
runtime authority: its caller resolves delegated work through the
Worth-facing contracts and reports these outcomes through `WorthAuthority`.
This package never submits or reads durable lifecycle state, and it owns no
capability, replay, verification, execution, evidence, economics, health, or
publication authority.

## Safety boundaries

Replay navigation is restricted to the requested application origin and
rejects URLs containing credentials. Each session admits cancellation, the
absolute deadline, a session wall-clock budget, and the optional
browser-action/evidence budgets before remote work. Recording capture is
URL-only: it materializes zero artifact bytes inside this adapter, so a
positive evidence-byte budget is not consumed; a zero budget still denies
capture before release.
Concurrent page operations are rejected while one operation is in flight.
Telemetry contains only schema/version, operation, outcome, typed IDs,
low-cardinality step/evidence kinds, and typed failure codes; URLs, selectors,
input values, recording URLs, API keys, and SDK error text are excluded.
