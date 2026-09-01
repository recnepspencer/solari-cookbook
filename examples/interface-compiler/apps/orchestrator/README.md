# Orchestrator runtime

This package plans and runs the two Interface Compiler experiment paths:

- direct runs ask the injected provider-neutral reasoning port for a structured decision after each Solari observation;
- compiled runs resolve an active replay projection from Worth and execute its steps without Gemini UI reasoning.

Compiled planning requires a non-empty semantic outcome contract. The verifier is another delegated boundary; a false condition is settled as a typed execution failure. Replay degradation and exploration recovery remain unavailable on the live narrow port.

Worth Query, Solari, and Gemini are injected through their adapter contracts. The orchestrator is a Worth-delegated external-effect worker: it receives a bounded `OperationContext` admitted by Worth, checks immutable authority projections, treats Worth's admitted running execution projection as the final work handoff, submits revisioned settlement through the narrow `WorthExecutionRuntimePort`, calls external-effect adapters, publishes actual browser/model telemetry through Worth, and returns typed outcomes. It owns no lifecycle, replay, evidence, event, projection, or telemetry store; only in-flight cancellation and resource handles remain local.

## Setup

From `examples/interface-compiler`, install dependencies with `npm install`. Construct `InterfaceCompilerWorthClient`, then pass its narrow runtime/read port to `ExperimentRunner`. The worker's caller must supply the `OperationContext` admitted by Worth when creating an `OperationController`; the worker does not mint operation ids, deadlines, budgets, or admission decisions.

A real Gemini model is created only by `@interface-compiler/gemini-adapter` when `GEMINI_API_KEY` and `GEMINI_MODEL` are present in the process environment. Supply model pricing from the current pricing source when constructing the adapter; pricing is intentionally not embedded here.

Tests inject fake ports and never make a Gemini request. Do not put credentials in source files or `.env` files. Start counters are authority initialization values; actual model/verifier/browser telemetry is published to the execution's WORTH journal, where authoritative counters and cost are projected. Logical event idempotency keys are derived from the WORTH execution, replay, session, observation, or step identity rather than from the per-attempt event id.

Browser telemetry carries the execution identity alongside Solari session and observation/action identities. The worker keeps no metrics aggregate or session-to-execution map. A terminal event that cannot publish is returned as `finalization_blocked` after WORTH settlement, with the accepted settlement and terminal outcome preserved for reconciliation.

## Safe Demoblaze benchmark

The package exposes the benchmark harness and a CLI composition that uses the
real configured Gemini and Solari adapters plus the app-specific live WORTH
process client. Direct and compiled plans are both resolved before the first
browser effect. The direct run must settle at a classified human-required
boundary and close its fresh Solari session before the compiled run may start.
Both modes use the same immutable objective, application, capability, model,
and resource limits.

The default command is a no-network configuration inspection. It does not
construct Gemini, Solari, or WORTH clients:

```text
npm run benchmark:demoblaze:dry-run
```

For a separately reviewed live run, provide credentials and current Gemini
pricing through the environment, then use both explicit gates:

```powershell
$env:GEMINI_API_KEY = "..."
$env:GEMINI_MODEL = "..."
$env:GEMINI_INPUT_USD_PER_MILLION_TOKENS = "..."
$env:GEMINI_OUTPUT_USD_PER_MILLION_TOKENS = "..."
$env:SOLARI_API_KEY = "..."
$env:INTERFACE_COMPILER_ALLOW_DEMOBLAZE_NETWORK = "true"
npm run benchmark:demoblaze:dry-run
npm run benchmark:demoblaze:run
```

The task may select only `Samsung galaxy s6`, add one unit, and open the cart.
It stops at the first order, authentication, personal-information, shipping,
payment, credential, or access-control boundary. A task-specific stateful guard
admits only public HTTPS Demoblaze navigation plus one informational-modal
Close (if present), then the fixed sequence: Phones (if needed), Samsung galaxy
s6, one Add to cart action, and Cart. It never
supplies form data, clicks Place Order or Purchase, or purchases. Every fill
and select is denied before the Solari effect.

The report comes from the two WORTH terminal settlement projections. The
checked-in capability/replay is explicitly `synthetic_seed`, so its compile
cost and break-even fields truthfully read `not_measured`; the seed is never
treated as measured discovery or verification economics.

## Checks

```text
npm run typecheck --prefix apps/orchestrator
npm run test --prefix apps/orchestrator
```
