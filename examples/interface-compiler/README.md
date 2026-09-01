# Project Spec — Interface Compiler

## Working Name

**Interface Compiler**

One-liner:

> **Point it at a UI. It learns an API.**

Longer definition:

> Interface Compiler uses Gemini agents running through Solari browsers to explore real software, discover and verify useful semantic operations, store/version those capabilities in Worth, and publish them as stable tools that Gemini can later invoke without repeatedly reasoning through the underlying UI.

---

# 1. Core Thesis

General-purpose computer-use agents are powerful because they can figure out unfamiliar software.

They are also expensive because they repeatedly pay for intelligence.

A direct computer-use task looks like:

```text
observe page
↓
reason
↓
click
↓
observe
↓
reason
↓
type
↓
observe
↓
reason
↓
click
...
```

That makes sense when the interface is unknown.

It is wasteful after the same operation has already been understood.

Interface Compiler follows this rule:

> **Use intelligence to discover a capability once, then replay the learned capability deterministically until something changes.**

When deterministic replay fails:

> **Return that capability to exploratory mode, learn a new valid replay, verify it, version it, and continue.**

---

# 2. Repository

Start from the official Solari challenge repository.

```bash
git clone https://github.com/solari-sdk/solari-cookbook.git
cd solari-cookbook
```

For the actual submission:

1. Fork the Solari cookbook repository.
2. Clone the public fork.
3. Add Interface Compiler as a new example/project.

Upstream:

```text
https://github.com/solari-sdk/solari-cookbook/
```

Suggested structure:

```text
solari-cookbook/
└── examples/
    └── interface-compiler/
        ├── README.md
        ├── apps/
        │   ├── orchestrator/
        │   └── dashboard/
        ├── packages/
        │   ├── domain/
        │   ├── worth-adapter/
        │   ├── solari-adapter/
        │   ├── explorer/
        │   ├── replay/
        │   ├── verifier/
        │   ├── benchmark/
        │   └── tool-publisher/
        ├── prompts/
        ├── scripts/
        └── tests/
```

Use existing cookbook conventions where they are cleaner.

---

# 3. Demo Target

Use a real public website.

Primary target:

# Walmart

Demo task:

> Search for a common product, add one suitable result to the cart, continue toward checkout, and stop when authentication, credentials, shipping details, personal information, or payment becomes required.

Example:

```text
Go to Walmart.

Search for Tide Pods.

Choose a suitable result.

Add one to the cart.

Proceed toward checkout.

Stop when credentials are required.
```

The demo must not:

* enter private credentials,
* submit payment,
* place an order,
* bypass authentication,
* bypass access controls,
* or continue beyond the credential/payment boundary.

---

# 4. Primary Experiment

The same Gemini model performs the same task two ways.

This is critical.

## Path A — Direct Computer Use

Gemini receives:

```text
Go to Walmart, find Tide Pods, add one to the cart,
proceed toward checkout, and stop when credentials are required.
```

Gemini directly controls a Solari browser.

The loop is:

```text
Gemini
  ↓
observe browser
  ↓
reason
  ↓
take browser action
  ↓
observe
  ↓
reason
  ↓
...
```

Record:

* total model input tokens
* total model output tokens
* total model calls
* total reasoning turns
* browser observations
* browser actions
* screenshots/snapshots
* wall-clock time
* estimated model cost
* success/failure

This is the baseline.

---

# 5. Path B — Compiled Capability

The same Gemini model receives the same user task.

But Gemini now has semantic tools such as:

```text
walmart.search_products
walmart.add_to_cart
walmart.begin_checkout
```

Gemini reasons once at the business-operation level.

Example:

```text
Need Tide Pods.
↓
walmart.search_products(...)
↓
walmart.add_to_cart(...)
↓
walmart.begin_checkout(...)
↓
AUTHENTICATION_REQUIRED
```

Underneath those tools, Interface Compiler resolves a previously learned replay and executes it through Solari.

Gemini does not repeatedly inspect and reason over the Walmart UI.

---

# 6. Required Benchmark

The demo must show a side-by-side comparison.

Example format:

```text
SAME MODEL
SAME TASK
SAME WEBSITE

DIRECT COMPUTER USE

Model calls:            18
Input tokens:           ...
Output tokens:          ...
Browser observations:   ...
Browser actions:        ...
Wall time:              ...
Estimated model cost:   ...


COMPILED CAPABILITY

Model calls:            2
Input tokens:           ...
Output tokens:          ...
Browser observations:   ...
Browser actions:        ...
Wall time:              ...
Estimated model cost:   ...
```

Do not use fabricated demo numbers.

All published numbers should come from measured runs.

---

# 7. Primary Economic Metric

Each compiled capability should calculate:

```text
Discovery cost
+
Verification cost
=
Compilation cost
```

Then measure:

```text
Direct UI cost per execution

vs.

Compiled replay cost per execution
```

Then calculate:

```text
Break-even calls
```

Formula:

```text
break_even =
compile_cost /
(direct_cost_per_call - compiled_cost_per_call)
```

Also track:

```text
lifetime executions
lifetime direct cost avoided
lifetime compiled cost
lifetime net savings
```

Example dashboard concept:

```text
walmart.add_to_cart

Discovery cost            $...
Verification cost         $...
Total compilation cost    $...

Direct UI cost/call       $...
Replay cost/call          $...

Break-even                ... calls

Calls executed            ...
Estimated lifetime saved  $...
```

---

# 8. Core Product Principle

The system is not primarily:

```text
AI browser automation
```

It is:

> **Intelligence amortization.**

Computer use is the bootstrap mechanism.

Deterministic replay is the steady state.

Exploration returns only when needed.

---

# 9. System Architecture

```text
                     GEMINI
                       │
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼

DIRECT MODE                    COMPILED MODE

Gemini reasons                semantic tool call
through every                 walmart.add_to_cart(...)
UI transition                        │
        │                             ▼
        ▼                           Worth
 Solari Browser                resolve capability
        │                             │
        ▼                             ▼
     Walmart                    replay version
                                      │
                                      ▼
                               Solari Browser
                                      │
                                      ▼
                                   Walmart
```

---

# 10. Solari's Role

Solari is the execution substrate.

Solari provides:

* exploratory browser sessions
* verification browser sessions
* deterministic replay sessions
* fresh sessions for independent tests
* session replay/evidence where available
* parallel explorers when a capability breaks or new behavior needs discovery

Solari should be visibly important in the demo.

The project should not build its own browser infrastructure.

---

# 11. Worth's Role

Worth owns authoritative learned knowledge.

Worth stores:

* applications
* capabilities
* semantic contracts
* capability versions
* replay implementations
* current active version
* evidence
* verification state
* confidence
* dependencies
* health
* failures
* invalidation
* lineage

The separation is:

> **Gemini proposes. Solari executes. Worth remembers what is trusted.**

---

# 12. Gemini's Role

Gemini performs reasoning only where intelligence is useful.

Gemini has three logical roles.

## Explorer Gemini

Used when behavior is unknown.

Responsibilities:

* inspect current UI state
* infer page meaning
* identify useful semantic operations
* propose next experiment
* reason about failures
* discover working UI sequences

## Verifier Gemini

Used to independently judge whether a proposed replay actually satisfies the semantic capability.

This may use lighter structured reasoning than the explorer.

## Consumer Gemini

Receives the original business task.

It should know only the semantic tools in compiled mode.

It should not know selectors, page layout, replay details, or exploration history.

---

# 13. Capability Model

A capability is a semantic operation.

Examples:

```text
SearchProducts
AddToCart
BeginCheckout
```

Suggested representation:

```typescript
interface Capability {
  id: string
  applicationId: string

  name: string
  description: string

  inputSchema: JsonSchema
  outputSchema: JsonSchema

  preconditions: Condition[]
  postconditions: Condition[]

  activeReplayVersionId?: string

  status:
    | "discovering"
    | "verifying"
    | "healthy"
    | "degraded"
    | "broken"
}
```

---

# 14. Replay Version

A replay is one learned deterministic implementation of a semantic capability.

```typescript
interface ReplayVersion {
  id: string
  capabilityId: string

  version: number

  steps: ReplayStep[]

  status:
    | "candidate"
    | "verifying"
    | "active"
    | "broken"
    | "superseded"

  confidence: number

  discoveredFromExperimentId: string
  supersedes?: string

  createdAt: string
  verifiedAt?: string
}
```

---

# 15. Replay Steps

Keep the replay representation simple.

```typescript
type ReplayStep =
  | NavigateStep
  | ClickStep
  | FillStep
  | SelectStep
  | WaitStep
  | ReadStep
  | AssertStep
```

Example:

```typescript
interface ClickStep {
  type: "click"

  target: {
    semanticDescription: string

    role?: string
    name?: string
    text?: string
    selector?: string
  }
}
```

Prefer resilient semantic locator information.

Do not rely solely on brittle CSS selectors.

---

# 16. Replay Philosophy

A replay is not:

```text
a giant generated script that is assumed to work forever
```

It is:

> **A currently verified implementation of a semantic contract.**

Therefore:

```text
Capability
   │
   ├── replay v1
   ├── replay v2
   └── replay v3 ← active
```

The capability is more stable than any replay.

---

# 17. Exploration Loop

When a capability is unknown:

```text
1. Acquire Solari browser.
2. Navigate to known starting state.
3. Capture observation.
4. Give structured observation to Explorer Gemini.
5. Gemini proposes an action or experiment.
6. Execute it.
7. Capture resulting observation.
8. Store evidence.
9. Continue until semantic operation is understood.
10. Generate candidate replay.
11. Send replay to verification.
```

---

# 18. Observation Model

Do not feed arbitrary giant DOM dumps to the model if avoidable.

Normalize observations.

```typescript
interface Observation {
  id: string
  sessionId: string

  url: string
  title?: string

  pageSummary?: string

  interactables: Interactable[]

  screenshotRef?: string
  snapshotRef?: string

  observedAt: string
}
```

Possible interactables:

```typescript
interface Interactable {
  kind:
    | "link"
    | "button"
    | "input"
    | "select"
    | "form"
    | "table"
    | "other"

  role?: string
  name?: string
  text?: string

  semanticGuess?: string
}
```

---

# 19. Experiments

Exploration should explicitly produce experiments.

```typescript
interface Experiment {
  id: string
  capabilityId?: string

  hypothesis: string

  proposedSteps: ReplayStep[]

  expectedOutcome: Condition[]

  result:
    | "pending"
    | "success"
    | "failure"
    | "inconclusive"

  evidenceIds: string[]
}
```

Example:

```text
Hypothesis:

Clicking "Add to cart" on the selected product
will increment cart count and preserve the product identity.
```

---

# 20. Evidence

Evidence should make the learning process auditable.

Store references to:

* Solari session
* replay/session recording
* screenshot
* before observation
* after observation
* executed experiment
* postcondition results
* failure details

A capability should answer:

```text
Why do we believe this replay works?
```

---

# 21. Verification

A successful exploration run is not enough.

Candidate replay must be independently verified.

For MVP:

```text
3 successful fresh-session verifications
```

is sufficient.

Process:

```text
candidate replay
↓
fresh Solari browser
↓
execute replay
↓
check semantic postconditions
↓
repeat
↓
promote if successful
```

Example:

```text
AddToCart v1

Discovery run:
✓

Independent verification:
✓ run 1
✓ run 2
✓ run 3

Status:
ACTIVE
```

---

# 22. Postconditions

A replay must be judged by semantic success, not merely lack of errors.

For:

```text
AddToCart
```

possible postconditions:

```text
cart count increased
AND
selected product appears in cart
```

For:

```text
BeginCheckout
```

possible result:

```typescript
type BeginCheckoutResult =
  | {
      status: "authentication_required"
    }
  | {
      status: "checkout_started"
    }
```

The demo should intentionally stop at:

```text
authentication_required
```

or equivalent credential boundary.

---

# 23. Tool Publishing

Healthy capabilities should become structured Gemini tools.

Examples:

```text
walmart.search_products
walmart.add_to_cart
walmart.begin_checkout
```

Tool descriptions must expose only semantics.

Example:

```typescript
addToCart({
  query: "Tide Pods",
  quantity: 1
})
```

Gemini should not see:

* selectors
* DOM state
* Playwright
* replay sequence
* implementation version

---

# 24. Compiled Execution

When Gemini invokes:

```text
walmart.add_to_cart(...)
```

the system should:

```text
1. Resolve capability in Worth.
2. Resolve active replay version.
3. Acquire Solari browser.
4. Establish required starting state.
5. Execute deterministic replay.
6. Check postconditions.
7. Return structured output.
8. Record execution metrics.
```

---

# 25. The Failure Model

This version should be simpler than the previous spec.

There is no separate generalized repair subsystem.

Instead:

> **Replay failure sends the capability back into exploratory mode.**

Example:

```text
AddToCart v4
      │
      ▼
replay step fails
      │
      ▼
postcondition fails
      │
      ▼
Worth marks v4 broken
      │
      ▼
Capability = DEGRADED
      │
      ▼
EXPLORATORY MODE
```

---

# 26. Re-Exploration

The explorer should receive the previous replay as useful context.

Example input:

```text
Capability:
AddToCart

Previously successful replay:
v4

Failure:
Expected button matching "Add to cart"
but target was not found.

Current observation:
...

Goal:
Discover a new replay satisfying the exact same semantic contract.
```

The agent does not need to rediscover what `AddToCart` means.

It only needs to rediscover how Walmart currently implements it.

---

# 27. Replay Version Repair

When exploration finds a new working sequence:

```text
AddToCart

v4
│
└── BROKEN
     │
     ▼
exploration
     │
     ▼
candidate v5
     │
     ▼
verification
     │
     ▼
ACTIVE
```

Worth records:

```text
v5 supersedes v4
```

The published tool remains:

```text
walmart.add_to_cart
```

No change to Gemini consumer code.

---

# 28. Replay UI

Replay should be visible in the dashboard.

For each capability show:

```text
AddToCart

Active replay:
v5

Status:
HEALTHY

Steps:
1. Search for product
2. Select matching result
3. Click Add to cart
4. Assert cart count
5. Assert product identity
```

Do not expose unnecessary low-level details by default.

Allow an expanded view for evidence/debugging.

---

# 29. Replay Evidence

Because replay is central to this simpler architecture, make it visually compelling.

Show:

```text
Discovery replay

[View Solari session]

Verification run #1
[View replay]

Verification run #2
[View replay]

Verification run #3
[View replay]
```

If Solari provides recorded browser sessions/replay inspection, surface those directly.

---

# 30. Required Demo Act I — Baseline

Start with no compiled Walmart capabilities.

Show:

```text
Known capabilities: 0
```

Give Gemini:

```text
Go to Walmart, find Tide Pods, add one to the cart,
proceed toward checkout, and stop when credentials are required.
```

Let Gemini operate the Solari browser directly.

Record the whole run.

At the end show baseline metrics.

---

# 31. Required Demo Act II — Compile

Now tell Interface Compiler to learn:

```text
SearchProducts
AddToCart
BeginCheckout
```

or allow it to discover those from the original task.

Show Gemini exploratory reasoning and Solari sessions.

Then show:

```text
SearchProducts       VERIFIED
AddToCart            VERIFIED
BeginCheckout        VERIFIED
```

Each should have an active replay version.

---

# 32. Required Demo Act III — Same Task

Reset state.

Give Consumer Gemini the exact same original instruction.

This time it sees compiled semantic tools.

Show Gemini selecting:

```text
walmart.search_products
walmart.add_to_cart
walmart.begin_checkout
```

The task reaches the same stopping condition.

Show compiled metrics.

---

# 33. Required Demo Act IV — Comparison

Display side-by-side benchmark.

Required:

```text
Model calls
Input tokens
Output tokens
Total tokens
Browser observations
Browser actions
Wall-clock latency
Estimated model cost
```

Also show:

```text
Compilation cost
Break-even calls
```

The headline should be based on real measured data.

Examples of acceptable headline formats:

```text
83% fewer model tokens
```

```text
6.4× faster
```

```text
Break-even after 8 calls
```

Only use values actually measured.

---

# 34. Required Demo Act V — Replay Failure

The ideal demo should show a real naturally occurring replay failure if one occurs.

However, do not depend on Walmart changing during the demo.

For deterministic presentation, intentionally invalidate one replay locally in a way that faithfully simulates stale learned knowledge.

Acceptable examples:

* use an intentionally outdated stored target
* disable one candidate locator
* replay a previously captured stale version
* intentionally corrupt one expected interaction target

Do not alter Walmart.

The point is to demonstrate the system response to stale knowledge.

Show:

```text
AddToCart v4

REPLAY FAILED
```

Then:

```text
Capability:
DEGRADED

Mode:
EXPLORATORY
```

---

# 35. Required Demo Act VI — Relearn

Show Gemini exploratory mode taking over.

It observes the real current Walmart UI.

Finds a valid sequence.

Produces:

```text
AddToCart v5
```

Verify it.

Then:

```text
v4 BROKEN
v5 ACTIVE
```

Tool contract remains:

```text
walmart.add_to_cart
```

Run it successfully again.

---

# 36. Money Shot

The final failure/recovery message should be extremely simple:

```text
Replay failed.

Gemini explored the changed interface.

A new replay was verified.

The tool never changed.
```

Or:

> **The UI implementation changed. The capability didn't.**

---

# 37. Dashboard

Do not build a generalized admin platform.

The dashboard exists to make the system legible in a short demo.

Main areas:

## Application

```text
Walmart
```

## Mode

```text
DIRECT
DISCOVERING
COMPILED
DEGRADED
EXPLORING
VERIFYING
```

## Solari Sessions

Show active browsers:

```text
Explorer #3
Verifier #2
Replay #19
```

## Capabilities

```text
SearchProducts     HEALTHY    v2
AddToCart          HEALTHY    v5
BeginCheckout      HEALTHY    v1
```

## Economics

```text
Compilation cost
Direct cost/call
Compiled cost/call
Break-even
Lifetime savings
```

## Benchmark

Side-by-side direct vs compiled.

---

# 38. Capability Detail Screen

For a selected capability show:

```text
AddToCart

Semantic contract
Input schema
Output schema

Status:
HEALTHY

Active replay:
v5

Confidence:
...

Verified:
3/3

Previous:
v4 BROKEN

Compilation cost:
...

Direct average cost:
...

Replay average cost:
...

Break-even:
...
```

---

# 39. Core Domain Types

Keep them small.

## Application

```typescript
interface Application {
  id: string
  name: string
  baseUrl: string
}
```

## Capability

```typescript
interface Capability {
  id: string
  applicationId: string

  name: string
  description: string

  inputSchema: JsonSchema
  outputSchema: JsonSchema

  preconditions: Condition[]
  postconditions: Condition[]

  status:
    | "discovering"
    | "verifying"
    | "healthy"
    | "degraded"

  activeReplayVersionId?: string
}
```

## ReplayVersion

```typescript
interface ReplayVersion {
  id: string
  capabilityId: string

  version: number
  steps: ReplayStep[]

  status:
    | "candidate"
    | "verifying"
    | "active"
    | "broken"
    | "superseded"

  confidence: number

  discoveredFromExperimentId: string
  supersedes?: string
}
```

## Execution

```typescript
interface Execution {
  id: string
  capabilityId: string
  replayVersionId?: string

  mode:
    | "direct"
    | "compiled"
    | "exploratory"

  status:
    | "running"
    | "success"
    | "failure"

  metrics: ExecutionMetrics
}
```

---

# 40. Metrics Model

```typescript
interface ExecutionMetrics {
  startedAt: string
  endedAt?: string

  wallClockMs?: number

  modelCalls: number

  inputTokens: number
  outputTokens: number

  browserObservations: number
  browserActions: number

  estimatedModelCostUsd: number
}
```

Compilation metrics:

```typescript
interface CompilationMetrics {
  explorationCostUsd: number
  verificationCostUsd: number

  totalCompilationCostUsd: number

  directAverageCostUsd?: number
  compiledAverageCostUsd?: number

  breakEvenCalls?: number
}
```

---

# 41. Worth Integration — Required

Worth must materially power the system.

Required:

* authoritative capability state
* replay-version state
* active replay resolution
* version lineage
* execution results
* health state
* failure → degraded transition
* replay failure → exploratory mode
* candidate → verification → active transition
* metrics aggregation

Strongly preferred:

* reactive/live dashboard updates
* derived break-even calculations
* derived capability health
* lineage queries

Do not use Worth as a decorative database wrapper.

---

# 42. Solari Integration — Required

Use Solari for:

* direct Gemini baseline browser
* exploration browsers
* verification browsers
* deterministic replay browsers

Strongly preferred:

* recorded/replayable browser sessions
* fresh sessions for verification
* parallel exploration if useful

Do not implement another browser infrastructure layer.

---

# 43. Gemini Integration — Required

Create a provider boundary.

```typescript
interface ReasoningModel {
  structuredComplete<TInput, TOutput>(
    input: TInput,
    schema: Schema<TOutput>
  ): Promise<TOutput>
}
```

Implement Gemini first.

Track token usage and cost centrally.

Do not scatter Gemini-specific API logic across the system.

---

# 44. Direct Computer-Use Agent

Implement a simple agent loop:

```text
observe
↓
Gemini decides action
↓
execute
↓
observe
```

Possible actions:

```text
navigate
click
fill
select
scroll
wait
finish
```

The direct baseline must be real.

Do not secretly use compiled replay helpers in baseline mode.

---

# 45. Explorer Agent

Explorer input:

```typescript
interface ExplorerInput {
  application: Application

  objective: string

  currentObservation: Observation

  previousReplay?: ReplayVersion

  failure?: ReplayFailure

  knownCapabilities: CapabilitySummary[]
}
```

Output:

```typescript
interface ExplorerDecision {
  action?: ReplayStep

  semanticObservation?: string

  capabilityHypothesis?: {
    name: string
    description: string
    inputSchema: JsonSchema
    outputSchema: JsonSchema
  }

  done?: boolean
}
```

Keep Gemini outputs structured.

---

# 46. Replay Generation

After successful exploration, convert the successful sequence into a candidate replay.

Remove unnecessary exploratory actions.

Example exploration:

```text
open search
try query
inspect product
go back
try second product
inspect
click add
inspect cart
```

Candidate replay should become:

```text
search known query
select matching result
add to cart
assert cart
```

The replay should be shorter than exploration.

This is the literal compilation step.

---

# 47. Replay Optimization

Optional after MVP.

Gemini can review a successful exploratory trace and ask:

```text
Which actions were necessary?

Which actions were exploratory noise?

Can this replay be shorter while retaining its postconditions?
```

Then verify the optimized replay independently.

This is potentially a very compelling part of the cost story.

---

# 48. SearchProducts Capability

Suggested semantics:

```typescript
searchProducts({
  query: string
}): Promise<{
  products: Array<{
    title: string
    price?: string
    productRef: string
  }>
}>
```

Do not over-engineer product identity.

The MVP only needs enough structure to support the demo.

---

# 49. AddToCart Capability

Suggested:

```typescript
addToCart({
  productRef: string,
  quantity?: number
}): Promise<{
  status: "added"
  cartCount?: number
}>
```

Postconditions:

```text
target product represented in cart
AND
cart state increased/present
```

---

# 50. BeginCheckout Capability

Suggested:

```typescript
beginCheckout(): Promise<
  | {
      status: "authentication_required"
    }
  | {
      status: "checkout_started"
    }
>
```

For the public demo, terminate as soon as authentication or credential entry is requested.

---

# 51. Safety Boundary

The system must never autonomously cross sensitive transaction boundaries.

For this demo:

```text
browse product
search
add to cart
view cart
begin checkout

ALLOWED
```

Then:

```text
login credentials
personal identity
shipping details
payment details
order placement

STOP
```

Make the stopping condition explicit.

---

# 52. Event Model

Emit readable events.

Examples:

```text
direct.started
browser.observed
model.called
browser.action
direct.completed

exploration.started
experiment.executed
replay.proposed

verification.started
verification.succeeded
replay.activated

compiled.started
replay.started
replay.succeeded

replay.failed
capability.degraded
exploration.resumed

replay.superseded
capability.healthy
```

The dashboard should consume these events.

---

# 53. Swarm Workstreams

Parallelize aggressively after contracts stabilize.

## A — Domain

Own:

```text
packages/domain/**
```

Implement types and schemas.

No external dependencies where possible.

---

## B — Solari Adapter

Own:

```text
packages/solari-adapter/**
```

Implement:

```text
createBrowser
navigate
observe
executeStep
captureEvidence
closeBrowser
```

---

## C — Gemini Agent Layer

Own:

```text
packages/explorer/**
```

and model provider.

Implement:

* structured Gemini calls
* direct agent
* explorer
* replay compiler

---

## D — Worth Adapter

Own:

```text
packages/worth-adapter/**
```

Implement:

* capabilities
* replay versions
* health
* lineage
* executions
* metrics
* transitions

---

## E — Replay Engine

Own:

```text
packages/replay/**
```

Implement:

* execute replay
* locator resolution
* postconditions
* failure capture

---

## F — Verifier

Own:

```text
packages/verifier/**
```

Implement fresh-session independent verification.

---

## G — Benchmark

Own:

```text
packages/benchmark/**
```

Track:

* model tokens
* calls
* costs
* browser observations/actions
* latency
* break-even

---

## H — Tool Publisher

Own:

```text
packages/tool-publisher/**
```

Expose active Worth capabilities as Gemini tools.

---

## I — Dashboard

Own:

```text
apps/dashboard/**
```

Build:

* mode
* active Solari sessions
* capability list
* replay history
* benchmark
* economics
* evidence links

---

## J — Integration

Own:

```text
apps/orchestrator/**
scripts/**
```

Implement demo orchestration and end-to-end flow.

---

# 54. Parallelization Shape

After domain contracts:

```text
                 DOMAIN CONTRACTS
                       │
      ┌────────────────┼────────────────┐
      │                │                │
      ▼                ▼                ▼
   Solari            Worth            Gemini
   Adapter           Adapter           Agents
      │                │                │
      ▼                ▼                ▼
   Replay           Dashboard        Explorer
      │                                 │
      └──────────────┬──────────────────┘
                     ▼
                  Integrate
                     │
                     ▼
                  Benchmark
```

Do not serialize work unnecessarily.

---

# 55. Strict Build Priority

Build in this order of product importance:

```text
1. Gemini can operate Walmart through Solari directly.
2. Metrics capture works.
3. Exploration can capture a successful AddToCart trace.
4. Trace can be converted into replay.
5. Replay can execute without Gemini UI reasoning.
6. Worth versions the replay.
7. Fresh-session verification works.
8. Capability becomes a Gemini tool.
9. Same task succeeds in compiled mode.
10. Benchmark comparison works.
11. Replay failure → exploratory mode works.
12. New replay supersedes broken replay.
13. Dashboard polish.
14. Additional capabilities.
```

Anything after 12 is secondary.

---

# 56. MVP Definition of Done

MVP is complete when:

* [ ] repository runs from clean checkout
* [ ] Gemini can directly perform Walmart task through Solari
* [ ] direct-run token/cost/latency metrics are recorded
* [ ] explorer can learn at least `AddToCart`
* [ ] successful exploration becomes a replay candidate
* [ ] Worth stores replay v1
* [ ] replay executes through Solari without Gemini UI reasoning
* [ ] 3 fresh sessions verify the replay
* [ ] capability becomes healthy
* [ ] capability is exposed as Gemini tool
* [ ] Consumer Gemini successfully invokes it
* [ ] compiled-run metrics are recorded
* [ ] baseline vs compiled comparison is displayed
* [ ] break-even cost is calculated
* [ ] intentional stale replay produces failure
* [ ] capability becomes degraded
* [ ] system returns to exploratory mode
* [ ] Gemini discovers replacement replay
* [ ] replacement verifies
* [ ] new replay becomes active
* [ ] semantic tool contract stays unchanged

---

# 57. Excellent Submission Definition

Additional quality:

* [ ] SearchProducts is compiled
* [ ] BeginCheckout is compiled
* [ ] same full task uses all three semantic tools
* [ ] replay/evidence links are visible
* [ ] dashboard updates live
* [ ] replay optimization shortens exploratory traces
* [ ] cost savings clearly shown
* [ ] failure/relearn flow fits in demo video
* [ ] README is immediately understandable
* [ ] setup is one command or nearly one command

---

# 58. Explicit Non-Goals

Do not build:

* OpenClaw integration
* generic MCP support unless trivial
* fake ERP
* universal crawler
* universal RPA framework
* distributed agent operating system
* production identity
* production multi-tenancy
* perfect anti-bot handling
* arbitrary login automation
* credential vault
* payment automation
* generalized workflow designer
* giant orchestration framework
* universal desktop support
* generalized selector-healing engine

This is a proof of the compiler thesis.

---

# 59. README Opening

Suggested:

# Interface Compiler

**Point it at a UI. It learns an API.**

General-purpose agents can operate almost any software, but they repeatedly pay for expensive visual reasoning every time they use it.

Interface Compiler uses Gemini agents on Solari to explore unfamiliar interfaces and learn useful semantic operations.

Successful interactions are compiled into deterministic replays, independently verified, versioned in Worth, and published back to Gemini as stable tools.

If a replay stops working, the capability automatically returns to exploratory mode. Gemini learns a new replay, verifies it, and Worth promotes the new version behind the same semantic contract.

The result:

> **Use intelligence when software is unknown. Stop paying for intelligence after it is understood.**

---

# 60. README Architecture

```text
                        UNKNOWN UI
                            │
                            ▼
                    Gemini Explorer
                            │
                            ▼
                     Solari Browser
                            │
                     experiments
                            │
                            ▼
                   successful trace
                            │
                            ▼
                      compile replay
                            │
                            ▼
                          Worth
                  capability + versions
                            │
                    independent verify
                            │
                            ▼
                    VERIFIED REPLAY
                            │
                            ▼
                      Gemini Tool

                    walmart.add_to_cart
                            │
                            ▼
                       replay only
                            │
                            ▼
                     Solari Browser


                       IF IT FAILS

                    replay failure
                            │
                            ▼
                     Worth degrades
                            │
                            ▼
                   Gemini Explorer
                            │
                            ▼
                    new replay version
```

---

# 61. Demo Narrative

Target:

**90–120 seconds.**

## Scene 1 — Baseline

Show Gemini receiving:

```text
Find Tide Pods on Walmart, add one to the cart,
go toward checkout, and stop when credentials are required.
```

Show repeated Gemini/browser loop.

Finish.

Show measured cost and latency.

---

## Scene 2 — Compile

Show exploration trace becoming:

```text
SearchProducts
AddToCart
BeginCheckout
```

Show replay verification.

```text
AddToCart v1
Verified 3/3
ACTIVE
```

---

## Scene 3 — Same Gemini, Same Task

Reset.

Give exact same prompt.

Now Gemini calls:

```text
walmart.search_products
walmart.add_to_cart
walmart.begin_checkout
```

Stop at credentials.

---

## Scene 4 — Numbers

Show:

```text
DIRECT

$...
... tokens
... sec


COMPILED

$...
... tokens
... sec
```

Then:

```text
Compilation cost: $...
Break-even: ... calls
```

---

## Scene 5 — Failure

Replay an intentionally stale stored version.

```text
AddToCart v1
FAILED
```

Dashboard changes:

```text
DEGRADED
EXPLORATORY MODE
```

---

## Scene 6 — Recovery

Show Gemini inspecting real Walmart again.

New replay:

```text
AddToCart v2

Verified 3/3
ACTIVE
```

Run tool again.

Success.

Final screen:

> **The replay changed. The capability didn't.**

---

# 62. Public Post

Recommended framing:

> **I built a compiler from user interfaces to agent tools.**
>
> Gemini first figures out an unfamiliar UI through Solari. Successful behavior gets compiled into a deterministic replay, independently verified, versioned in Worth, and exposed back to Gemini as a semantic tool.
>
> That means the model doesn't have to repeatedly reason through the same interface.
>
> I benchmarked the same Walmart task both ways: direct computer use vs the compiled capability.
>
> And when a replay fails, the capability simply returns to exploratory mode, learns a new replay, verifies it, and continues behind the same tool contract.

Do not lead with Worth.

Do not lead with browser automation.

Lead with:

> **We stop paying the intelligence tax once the interface is understood.**

---

# 63. Product Thesis in One Sentence

> **Interface Compiler converts expensive repeated computer-use reasoning into cheap versioned replays, bringing intelligence back into the loop only when the underlying interface stops behaving as expected.**

---

# 64. Final Constraint

Whenever an implementation idea appears, ask:

> **Does this strengthen the proof that direct computer use can be compiled into cheaper reusable behavior?**

If not:

**cut it.**
