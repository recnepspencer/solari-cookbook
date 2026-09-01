# Benchmark reporting

## What This Feature Is

`@interface-compiler/benchmark` turns two sets of measured Worth execution
projections into a renderable Direct Computer Use versus Compiled Capability
report. It is for the dashboard or demo composition root that already owns
the Worth query result. The package is a pure function: it does not run a
browser, call a model, call an API, or retain benchmark state.

## Why You Use It

Use this package when you need to:

- show a side-by-side comparison for the same task, application, and model;
- explain exactly which measured records produced token, latency, action,
  tool-call, and model-cost values;
- show Worth-owned compilation cost, break-even, and lifetime economics while
  withholding any value that was not measured or cannot be compared safely.

## Stable Entry Points

The public facade is `src/index.ts`:

```ts
import {
  createBenchmarkReport,
  validateBenchmarkComparison,
  type BenchmarkComparisonInput,
  type BenchmarkReport,
} from "@interface-compiler/benchmark"
```

`createBenchmarkReport(input)` returns a `BenchmarkReport` with one of three
top-level outcomes: `measured`, `not_measured`, or `not_comparable`.
`validateBenchmarkComparison(input)` returns the typed rejection details that
explain why a claimed comparison was denied. Neither entry point performs I/O.

The safe Walmart harness uses the narrower one-run terminal handoff API:

```ts
import { createTerminalBenchmarkReport } from "@interface-compiler/benchmark"

const report = createTerminalBenchmarkReport({
  task,
  direct: directWorthSettlement,
  compiled: compiledWorthSettlement,
  compiledPlan: {
    capabilityId,
    replayVersionId,
    compilationProvenance,
    capabilityEvidence,
    replayEvidence,
  },
})
```

This API admits only committed terminal projections returned by the narrow
live WORTH runtime port. It copies model calls, input/output tokens, browser
observations/actions, wall clock, and estimated model cost from those
projections, then derives per-run savings as disposable presentation data. It
does not accept a Node-side measurement record, event counter, or pricing
fallback for those fields.

Compilation economics have an additional authority gate. A capability and
replay marked `synthetic_seed` remain runnable, but compilation cost and
break-even are returned as `not_measured` even if a caller supplies apparent
compilation runs. A `measured` provenance must name exact, unique discovery and
verification WORTH execution IDs, and the report requires the corresponding
successful terminal projections before it derives compile cost and
break-even. Missing values never become zero.

## Core Mental Model

Worth Query remains the authority for execution, replay verification,
evidence, and compilation economics. The benchmark package only reads those
immutable projections and derives a disposable report for presentation.

The report treats a value as measured only when the caller supplies a terminal
Worth execution projection and measurement metadata with passed inspection,
complete evidence, explicit safety, and resolved recovery. A compiled run also
needs an active replay projection whose fresh verification runs all succeeded.

The report derives totals, averages, total tokens, per-execution savings, and
percentage savings. Break-even and lifetime economics are displayed from the
Worth compilation-metrics projection after consistency checks; this package
does not create a second economics authority or recompute those Worth-owned
values from local observations.

## How It Executes

`createBenchmarkReport` follows this order:

1. Check the exact task identity on the comparison and every record.
2. Admit only terminal, correctly-modeled, measured Worth executions.
3. Require passed inspection, complete evidence, explicit safety, and resolved
   recovery on every record.
4. Require an active, fully verified replay and complete replay evidence for
   the compiled side. Worth may retain failed verification attempts alongside
   enough successful fresh runs; those retained attempts are reported rather
   than silently discarded.
5. Resolve each side's monetary basis from one explicit source: a measured
   provider cost, explicit token pricing over matching measured usage, or the
   Worth execution projection's measured model-cost estimate.
6. Aggregate the admitted records and derive presentation metrics.
7. Project optional Worth compilation, break-even, and lifetime values with
   calculation provenance.

No step stores a record or contacts an external system.

## Small Example

The caller obtains every value below from Worth or from its explicit paid-run
configuration, then passes it to the pure report function:

```ts
const report = createBenchmarkReport(inputFromWorthAndPricing)

if (report.kind === "measured") {
  renderComparison(report.direct, report.compiled, report.economics)
} else {
  renderUnavailable(report.kind, report.reasons)
}
```

The example intentionally contains no sample measurements. A report must not
become measured because a fixture, fallback, or demo constant exists.

## Real Example: live-run input protocol

The eventual paid benchmark must assemble one `BenchmarkComparisonInput` with
the following exact protocol. The same `task` value must be copied into every
execution record and, when present, the compilation input.

```ts
const input: BenchmarkComparisonInput = {
  task: {
    taskId,                 // stable run-set identity
    applicationId,          // Worth application id
    objectiveFingerprint,   // fingerprint of the exact user objective
    modelId,                // exact model/deployment identifier
  },
  direct: [directRecord],
  compiled: [compiledRecord],
  compiledReplay: activeReplayProjection,
  compiledReplayInspection: { status: "passed", source: "worth" },
  compiledReplayEvidence: {
    status: "complete",
    source: "worth",
    evidenceIds: replayVerificationEvidenceIds,
  },
  pricing: {
    direct: { inputMicrocentsPerToken, outputMicrocentsPerToken },
    compiled: { inputMicrocentsPerToken, outputMicrocentsPerToken },
  },
  compilation: {
    task,
    projection: worthCompilationMetricsProjection,
    attribution: {
      kind: "discovery_and_verification_only",
      discoveryExecutionIds,
      verificationExecutionIds,
    },
  },
}
```

Each `directRecord` or `compiledRecord` must contain:

```ts
{
  task,
  execution: terminalWorthExecutionProjection,
  measurement: {
    status: "measured",
    source: "worth",
    recordId,
    toolCalls,
    inspection: { status: "passed", source: "worth" },
    evidence: { status: "complete", source: "worth", evidenceIds },
    recovery: { status: "not_required" }, // or { status: "completed" }
    safety: { kind: "safe_completion" },  // or a matching stopped_at_boundary stop
    usage,          // optional; if supplied, exactly matches execution.metrics
    modelCostMicrocents,   // optional; do not pass together with pricing for this side
  },
}
```

The live-run producer must follow these rules:

1. Run the identical objective against the identical application and model in
   both modes. Create `objectiveFingerprint` outside this package; do not use
   a shortened prompt or capability name as task identity.
2. Have the orchestrator submit start and terminal completion through Worth.
   Query the resulting `ExecutionProjection` values only after they are
   terminal. Direct projections must have `mode: "direct"` and no replay id;
   compiled projections must have `mode: "compiled"` and the active replay id.
3. Obtain inspection and evidence status from Worth. Do not turn a missing
   evidence reference, failed inspection, provisional measurement, unresolved
   recovery, or unsafe outcome into a successful record.
4. Supply the active `ActiveReplayProjection` from Worth. Its required fresh
   verification runs must have succeeded, and `compiledReplayEvidence` must
   contain every evidence id referenced by those runs.
5. Use one monetary basis across both sides. If using token pricing, use the
   same input/output rates for the same model on both sides. The Worth
   execution projection supplies the measured input/output counts; an optional
   `usage` value is accepted only as an exact cross-check. If using
   provider-reported cost, pass that measured USD value explicitly. Never mix
   pricing, provider cost, and Worth-estimated cost in one comparison. Never
   estimate cost from a fixture or use zero as a missing-cost sentinel.
6. Obtain `WorthCompilationMetricsProjection` from the Worth adapter for the
   same task. Its attribution ids must be discovery/verification executions
   separate from the direct and compiled comparison executions. The projection
   must report the component and total compilation costs consistently.
7. Pass the result to `createBenchmarkReport` and publish only the returned
   report. Preserve its `provenance` and rejection details in the dashboard or
   demo so a viewer can see the source ids and formulas.

The package never performs any API call. The Worth adapter, Solari adapter,
model provider, and orchestrator remain responsible for live execution and
for submitting measured outcomes. This package also never reads `.env`, stores
credentials, or persists projections.

## How It Relates To Other Features

- Pair it with `@interface-compiler/worth-adapter` for read-only Worth
  execution and compilation projections.
- Pair it with the dashboard only as a report data source; the dashboard must
  not recalculate or promote report values to authority.
- The domain economics functions remain useful to the Worth authority and are
  used here only to validate the internal consistency of a Worth economics
  projection.
- A missing compilation projection does not erase a valid measured execution
  comparison. It yields `not_measured` for compilation, break-even, and
  lifetime fields inside an otherwise measured report.

## Inspection And Debugging

For a `measured` report, inspect:

- `direct` and `compiled` record and execution ids;
- `totals` and `averages` for model calls, input/output/total tokens,
  observations, actions, tool calls, and wall-clock latency;
- `modelCost.source` and `provenance.calculations` for the monetary formula;
- `stop`, `recovery`, `evidence`, and `inspection` status on each side;
- `compiledReplay` and its verification evidence;
- `economics.compilation.attribution`, `breakEven`, and `lifetime`.

`not_measured` means the required measurement is absent or incomplete, such as
no records, a running execution, or an explicitly unmeasured record.
`not_comparable` means records exist but a claim would be unsafe or apples to
oranges, such as mixed task identity, mismatched modes, failed inspection,
missing evidence, an unverified replay, an unsafe stop, or missing monetary
data. Every denial carries a code, path, and remediation-oriented message.

## Anti-Patterns

- Do not call Solari, Gemini, a billing API, or Worth from this package.
- Do not add a local registry, cache, reducer, persistence file, or benchmark
  history store.
- Do not compare records with different task identities, models, applications,
  replay versions, safety outcomes, or verification postures.
- Do not infer monetary values from browser actions, token fixtures, averages
  that were not returned, or a missing field treated as zero.
- Do not use `not_measured` or `not_comparable` values as zeros in dashboard
  arithmetic.

## Current Limits

- This package reports model-cost economics in USD; Solari billing and other
  provider-specific charges must already be represented by an explicit Worth
  projection or caller-supplied measured cost.
- Break-even and lifetime values are available only when Worth returns a
  consistent compilation-metrics projection. They are not locally estimated.
- The package aggregates the records supplied in one call. It does not query,
  persist, deduplicate, or discover additional runs.
- The live paid run, Worth transport binding, and dashboard wiring are outside
  this package's boundary. The callable Walmart composition is in
  `apps/orchestrator`; this package remains pure.

## Related Docs

- [Interface Compiler project spec](../../README.md)
- [Worth adapter contract](../worth-adapter/README.md)
- [Dashboard projection contract](../../apps/dashboard/README.md)
