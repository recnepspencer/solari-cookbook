# WORTH Query bridge evidence

Status: a narrow WORTH-backed vertical slice is live in this worktree. The
complete `WorthRuntimePort` is still closed. No WORTH or Forge source was
modified.

## Current decision

The Interface Compiler demo now has four real application-specific host paths:

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
   steps and verification fields. The seed is synthetic and unmeasured; it does
   not claim that a Walmart compilation or verification run occurred.
5. `worth-runtime-host/src/protocol.rs` exposes only those products over
   an app-specific newline-delimited process boundary. Runtime-local proof,
   graph handles, and recovery handles never cross it.
6. `packages/worth-adapter/src/worth-query-client.ts` owns only process
   transport and request correlation. `createWorthApplicationReadAdapter`
   exposes the narrow application read, and `CompiledPlanReadPort` exposes only
   capability and active-replay reads. Neither is a `WorthRuntimePort`.

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
line. A live request has protocol
`interface-compiler.worth-host.v1`, operation `read_application`,
`start_execution`, `read_capability`, or `read_active_replay`, the corresponding domain ID, a demo credential, and a
bounded `deadline_ms`. Responses preserve WORTH-derived projections, query
evidence, lifecycle-not-pending, denial, and unavailable outcomes. The
credential is a deterministic demo credential, not an environment secret.

The projection's `revision` is read from the typed application field. It is
not substituted with the query receipt's `basis_version`; the integration
test seeds those values distinctly and asserts both products independently.

The process protocol is intentionally app-specific, not a generic WORTH
serialization protocol. It carries no live recovery handle or authority
handle. The WORTH host keeps those runtime-local; no cross-process replay or
recovery protocol has been invented.

## Live versus unavailable operations

| Interface Compiler operation | Status | Authority |
| --- | --- | --- |
| `readApplication` through `WorthApplicationReadAdapter` | Live | WORTH-installed application schema, admitted principal, bounded query, typed projection and receipt |
| `startExecution` through `WorthStartExecutionAdapter` | Live | WORTH-installed operation admission, invariant projection, effect program, compare-and-commit, execution query projection and receipt |
| `readCapability` through `CompiledPlanReadPort` | Live for the seeded demonstration capability | WORTH-installed capability entity, admitted bounded query, healthy projection and receipt |
| `readActiveReplay` through `CompiledPlanReadPort` | Live for the seeded demonstration capability | WORTH-installed replay selected by the capability's projected active replay identity, admitted bounded query, active projection and receipt |
| `readReplayLineage` | Unavailable | No WORTH replay-lineage projection/query is exposed by this host |
| `readExperiment` | Unavailable | No WORTH experiment projection/query is exposed by this host |
| `readEvidence` | Unavailable | No WORTH evidence projection/query is exposed by this host |
| `readExecution` | Unavailable | The post-transition execution query is not exposed as a standalone read operation |
| `readCompilationMetrics` | Unavailable | No WORTH-owned economics projection/query is exposed by this host |
| `submit` and all other lifecycle helpers | Unavailable | No other typed WORTH mutation/operation contract is exposed |
| `publishEvent` | Unavailable | No typed WORTH event publication contract is installed |
| composite dashboard read | Unavailable | The dashboard still requires its complete read-only projection, which this slice does not fabricate |

The existing `createWorthAdapter` remains the complete-port adapter. It still
requires every `WorthRuntimePort` method and has no production binding. The new
partial client is deliberately not structurally assignable to that interface.
Unknown process operations return an explicit `unavailable/unsupported`
response; they do not fall back to local data.

## Evidence and remaining scope

Rust integration tests exercise the real capability and replay queries and
assert matching identities plus WORTH receipt field counts and released bases.
The TypeScript integration test starts the real binary, reads both projections
through the narrow adapter, and asserts identity matching, receipt evidence,
not-found, mismatch fail-closed, and unsupported-operation boundaries.

Remaining work before the broad adapter can open includes approved typed WORTH
contracts for replay lineage, experiment/evidence/execution/metrics
projections, every other lifecycle/effect command, and event publication;
faithful process/client mappings for those contracts; and the corresponding
currentness, idempotency, cancellation, effect-uncertainty, recovery, and
evidence tests. Until each method is implemented through WORTH, it remains
typed unavailable. No local emulation is permitted.

Test-only WORTH fixtures and the existing TypeScript test doubles remain test
evidence only. They do not provide production authority.
