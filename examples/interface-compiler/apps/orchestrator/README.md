# Orchestrator runtime

This package plans and runs the two Interface Compiler experiment paths:

- direct runs ask the injected provider-neutral reasoning port for a structured decision after each Solari observation;
- compiled runs resolve an active replay projection from Worth and execute its steps without Gemini UI reasoning.

Compiled planning requires a non-empty semantic outcome contract. The verifier is another delegated boundary; a false condition is returned as a typed replay failure so Worth can break the replay and resume exploration.

Worth Query, Solari, and Gemini are injected through their adapter contracts. The orchestrator is a Worth-delegated external-effect worker: it receives a bounded `OperationContext` admitted by Worth, checks immutable authority projections, treats Worth's accepted running execution projection as the final work handoff, submits revisioned lifecycle commands through the Worth adapter, calls external-effect adapters, publishes actual browser/model telemetry through Worth, and returns typed outcomes. It owns no lifecycle, replay, evidence, event, projection, or telemetry store; only in-flight cancellation and resource handles remain local.

## Setup

From `examples/interface-compiler`, install dependencies with `npm install`. Bind the host's Worth Query facade with `@interface-compiler/worth-adapter`, then pass its `WorthAdapter` to `ExperimentRunner`. The worker's caller must supply the `OperationContext` admitted by Worth when creating an `OperationController`; the worker does not mint operation ids, deadlines, budgets, or admission decisions.

A real Gemini model is created only by `@interface-compiler/gemini-adapter` when `GEMINI_API_KEY` and `GEMINI_MODEL` are present in the process environment. Supply model pricing from the current pricing source when constructing the adapter; pricing is intentionally not embedded here.

Tests inject fake ports and never make a Gemini request. Do not put credentials in source files or `.env` files. The zero counters sent in the `start_execution` command are protocol initialization values, not measured benchmark results; actual model/verifier/browser telemetry is published to Worth from completed adapter results, where authoritative execution metrics and economics are aggregated. Logical event idempotency keys are derived from the Worth execution, replay, session, observation, or step identity rather than from the per-attempt event id.

Browser telemetry is keyed by the Solari session and observation/action identifiers from the shared event contract. The worker passes the execution identity when it creates the Solari session; the Worth/Solari event composition is responsible for correlating that session with the Worth execution, so the worker does not keep a session-to-execution map. A terminal event that cannot publish is returned as `finalization_blocked` after the Worth settlement, with the accepted settlement and terminal outcome preserved for reconciliation.

## Checks

```text
npm run typecheck --prefix apps/orchestrator
npm run test --prefix apps/orchestrator
```
