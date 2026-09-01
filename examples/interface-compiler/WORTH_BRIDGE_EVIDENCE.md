# WORTH Query bridge evidence

Status: a narrow WORTH-backed execution and replay-recovery vertical slice is
live in this worktree. The complete `WorthRuntimePort` is still closed. No
WORTH or Forge source was modified.

## Current decision

The Interface Compiler demo now has these real application-specific host
paths:

1. `worth-runtime-host/src/application.rs` declares a typed WORTH application
   schema, principal binding, and `read_application` query.
2. `worth-runtime-host/src/host.rs` installs and publishes that schema through
   `worth_query_host::facade`, admits the demo authentication adapter, resolves
   the authenticated principal, admits and executes the bounded one-shot query,
   and returns the typed projection plus WORTH query receipt evidence.
3. The same host owns `start_execution` through WORTH typed operation admission,
   invariant projection, effect programming, compare-and-commit, and a separate
   typed execution query.
4. The installed schema also owns one healthy demonstration capability and its
   active replay. Separate typed WORTH queries project both, including replay
   steps, lifecycle, lineage, failure, and verification fields. The seed is
   synthetic and unmeasured; it does not claim that a Walmart compilation or
   verification run occurred.
5. Four typed recovery operations degrade a replay only from its settled WORTH
   execution failure, accept a concrete explored replacement, retain concrete
   verifier-boundary receipts, and activate the replacement after three
   distinct successful receipts carrying fresh-session claims. Each operation
   uses WORTH admission, invariant decisions, expected revisions, effects,
   compare-and-commit, and post-commit queries.
6. `worth-runtime-host/src/protocol.rs` exposes only those products over
   an app-specific newline-delimited process boundary. Runtime-local proof,
   graph handles, and recovery handles never cross it.
7. `packages/worth-adapter/src/worth-query-client.ts` owns only process
   transport and request correlation. `createWorthApplicationReadAdapter`
   exposes the narrow application read, `CompiledPlanReadPort` exposes only
   capability and active-replay reads, and `ReplayRecoveryPort` exposes only
   the four typed recovery commands. None is a `WorthRuntimePort`.
8. `apps/orchestrator/src/recovery.ts` is a stateless coordinator. It accepts a
   WORTH degradation projection and a concrete replacement value, then threads
   only WORTH-returned revisions through verification and activation. It has no
   local lifecycle repository or reducer.

The demo's backing is WORTH's in-memory relational graph. It is not a
TypeScript store, test runtime, marker-only binding, local reducer, replay
authority, evidence authority, or dashboard projection authority.

## Public-facade evidence

The complete checkout used for this integration is:

```text
C:\forge_workspace\worktree_2\workspaces\worth-query
```

Its full `crates/worth-query/docs/AI_README.md` and the public
`worth-query-host` facade/readiness and application-runtime examples were read
before implementation. The relevant public progression is:

- install a validated portable application package;
- bind the installed typed schema and principal binding;
- prepare the public primary graph;
- bind an external principal mapping and application entity fields;
- publish `WorthQueryPrimaryGraphApplicationRuntime`;
- authenticate through an admitted adapter;
- resolve the principal and entity;
- admit and execute the installed typed one-shot application query;
- return its typed projection and access receipt.

The host imports WORTH only as `worth_query_host::facade::{admission,
declaration, domain, primary_graph, runtime}`. It does not call a raw graph,
executor, test-only runtime, or lower-level WORTH package.

## Old versus viable checkout

The earlier evidence was collected against this old checkout:

```text
C:\forge_workspace\forge\workspaces\worth-query
```

That checkout is incomplete in this environment. Its workspace references

```text
../../cad/workspaces/worth-contracts/crates/worth-schema-graph
```

but the matching dependency manifest is absent under
`C:\forge_workspace\forge`. Its metadata/check/test attempts stop at Cargo
manifest loading; that is not evidence against the host facade.

The viable complete checkout is the `worktree_2` path above. It contains the
matching `cad/worth-contracts` dependency, and this check succeeds there:

```powershell
Set-Location C:\forge_workspace\worktree_2\workspaces\worth-query
cargo check -p worth-query-host
```

The demo Cargo manifest intentionally points to that exact complete checkout.
It does not copy or patch Forge source. If that external checkout is moved,
the demo dependency must be updated to another complete, matching checkout.

## Launch and protocol

From the repository root:

```powershell
cargo run --manifest-path examples/interface-compiler/worth-runtime-host/Cargo.toml -- --serve
```

The process reads one JSON request per line and emits one JSON response per
line. A live request has protocol `interface-compiler.worth-host.v1`, a typed
application/read/execution/event/recovery operation, the operation's concrete
domain values and expected revisions, a demo credential, and a bounded
`deadline_ms`. The recovery operations are `degrade_replay`,
`accept_replacement_candidate`, `record_replacement_verification`, and
`activate_replacement`. Responses preserve WORTH-derived projections, query
evidence, commits, stale revisions, lifecycle/admission denials, and unavailable
outcomes. The credential is a deterministic demo credential, not an
environment secret.

The projection's `revision` is read from the typed application field. It is
not substituted with the query receipt's `basis_version`; the integration
test seeds those values distinctly and asserts both products independently.

The process protocol is intentionally app-specific, not a generic WORTH
serialization protocol. Recovery requests carry typed immutable values and
optimistic revisions, never a live recovery or authority handle. The WORTH host
keeps all runtime handles and lifecycle decisions local to the facade.

## Live versus unavailable operations

| Interface Compiler operation | Status | Authority |
| --- | --- | --- |
| `readApplication` through `WorthApplicationReadAdapter` | Live | WORTH-installed application schema, admitted principal, bounded query, typed projection and receipt |
| `startExecution` through `WorthStartExecutionAdapter` | Live | WORTH-installed operation admission, invariant projection, effect program, compare-and-commit, execution query projection and receipt |
| `admitExecution` through `WorthExecutionRuntimePort` | Live for arbitrary caller-issued direct or compiled identities | WORTH validates identity/mode/capability/replay eligibility, creates the execution and identity-bound journal in one admitted commit, and returns the running projection plus query receipt |
| `completeExecution` through `WorthExecutionSettlementPort` | Live for the seeded started demo execution | WORTH-installed completion operation, expected-revision/lifecycle denial, effect commit, authoritative execution projection and query receipt |
| `settleExecution` through `WorthExecutionRuntimePort` | Live for admitted arbitrary executions | WORTH expected-revision/lifecycle settlement and terminal projection including WORTH-projected telemetry counters, cost, timestamps, wall clock, and outcome |
| `publish` through `WorthExecutionSettlementPort` | Live for concrete Interface Compiler v1 events | WORTH-owned application journal, typed publication operation, idempotent retention, journal query and receipt |
| execution telemetry `publish` through `WorthExecutionRuntimePort` | Live | Model calls/tokens/cost and browser observations/actions are retained in the execution's WORTH-owned journal and re-projected at settlement; Node holds no metrics ledger |
| `readCapability` through `CompiledPlanReadPort` | Live for the seeded demonstration capability | WORTH-installed capability entity, admitted bounded query, healthy projection and receipt |
| `readActiveReplay` through `CompiledPlanReadPort` | Live for a healthy seeded demonstration capability | WORTH-installed replay selected by the capability's projected active replay identity, admitted bounded query, active/verified invariants and receipt; degraded/verifying capabilities fail closed |
| `degradeReplay` through `ReplayRecoveryPort` | Live | WORTH requires a terminal failed compiled execution for the exact capability/replay and derives failure/broken time from that settled projection before atomically degrading capability and replay |
| `acceptReplacementCandidate` through `ReplayRecoveryPort` | Live | WORTH validates concrete replacement steps, version, experiment lineage, supersession, and expected revisions before creating the verifying replay and moving the same capability to verification |
| `recordReplacementVerification` through `ReplayRecoveryPort` | Live | WORTH validates and retains an identity-bound verifier receipt, including its explicit fresh-session claim, and denies stale, foreign, duplicate, or chronologically invalid input |
| `activateReplacement` through `ReplayRecoveryPort` | Live | WORTH requires three distinct successful retained receipts with fresh-session claims, then atomically restores the same capability to healthy and changes its active replay pointer to the verified replacement; it does not independently attest the external verifier session |
| `readReplayLineage` | Unavailable | No WORTH replay-lineage projection/query is exposed by this host |
| `readExperiment` | Unavailable | No WORTH experiment projection/query is exposed by this host |
| `readEvidence` | Unavailable | Verification receipts are retained and projected with their replay, but no standalone WORTH evidence query is exposed by this host |
| `readExecution` | Unavailable | Running and terminal projections are exposed only as admission/settlement handoffs, not as a standalone query |
| `readCompilationMetrics` | Unavailable | No WORTH-owned economics projection/query is exposed by this host |
| generic replay publication/evidence `submit` | Unavailable | The host exposes only the four admitted application-specific recovery operations; it does not simulate the broad generic command surface |
| composite dashboard read | Unavailable | The dashboard still requires its complete read-only projection, which this slice does not fabricate |

The existing `createWorthAdapter` remains the complete-port adapter. It still
requires every `WorthRuntimePort` method and has no production binding. The new
partial client is deliberately not structurally assignable to that interface.
Unknown process operations return an explicit `unavailable/unsupported`
response; they do not fall back to local data.

## Evidence and remaining scope

Rust integration tests exercise the complete recovery sequence on the real
host: execution failure settlement, degradation/exploration, concrete
replacement acceptance, three verifier receipts with fresh-session claims, and
activation with an unchanged capability identity and changed active replay.
They also prove denial of nonterminal and foreign execution inputs, stale
revisions, duplicate sessions, and insufficient verification. Existing read
tests continue to assert matching identities, exact projection evidence counts,
and released query bases.

The TypeScript adapter integration test starts the real Rust binary and crosses
the process boundary for that same sequence. Orchestrator tests prove that a
compiled failure cannot finalize without WORTH degradation and that the
replacement coordinator threads only WORTH-issued revisions, stops on stale or
denied outcomes, and never maintains lifecycle state.

Remaining work before the broad adapter can open includes approved typed WORTH
contracts for replay lineage, experiment/evidence, standalone execution/benchmark
reads, generic replay publication/evidence submission, and every other
lifecycle/effect command; faithful process/client mappings for those contracts;
and the corresponding currentness, idempotency, cancellation,
effect-uncertainty, and evidence tests. Until each method is implemented through
WORTH, it remains typed unavailable. No local emulation is permitted.

The event journal and execution facts use WORTH's in-memory backing for this
demo. Per-execution journal facts are the sole authority for measured execution
metrics, but they are not a generic event bus or durable recovery service. No
Gemini, Solari, Walmart, paid, or other network request is made by this slice.

Test-only WORTH fixtures and the existing TypeScript test doubles remain test
evidence only. They do not provide production authority.
