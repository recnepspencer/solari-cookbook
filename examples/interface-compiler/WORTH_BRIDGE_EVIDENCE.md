# WORTH Query bridge evidence

Status: the requested live bridge is intentionally unavailable in this
worktree. The checked-in host is a fail-closed seam; it is not a demo runtime.
No WORTH or Forge source was modified.

## Decision

The installed WORTH source supports a real, typed, application-specific host in
Rust. Its public host facade is not a generic TypeScript runtime port and does
not expose a ready-made process, JSON/RPC, or Node endpoint.

The Interface Compiler adapter currently exposes one broad TypeScript
`WorthRuntimePort`: application, capability, replay, experiment, evidence,
execution, and metrics reads; every lifecycle and execution command; and event
publication. The repository does not declare the WORTH application schema,
typed query definitions, typed operation definitions, principal binding, or a
transport product that could map that complete contract to WORTH. A small
pre-seeded Rust query or a newly invented line protocol would therefore be an
app-specific partial API, not a contract-preserving bridge. A TypeScript store,
test backend, or marker-only binding would create the forbidden competing
authority.

The only honest implementation available without expanding the supported WORTH
surface is consequently a fail-closed seam. When the real host is absent, the
Rust executable exits nonzero without stdout and the TypeScript adapter has no
fallback state to return.

The fact that the facade can host some typed application in Rust does not by
itself make it a viable implementation of this adapter. Adding an
Interface-Compiler-specific schema, all of the adapter's query/operation
definitions, and an ad hoc process protocol would establish a new integration
contract. The current repository supplies none of those authorities or
approval-bearing mappings. Implementing only a convenient subset while making
the remaining adapter methods look live would weaken the existing contract;
inventing local records or a marker handshake would violate it. The guard keeps
that boundary explicit until those missing supported inputs exist.

## Public-facade evidence inspected

The installed checkout is `C:\forge_workspace\forge\workspaces\worth-query`.
The current `crates/worth-query/docs/AI_README.md` was read in full before this
decision. The relevant current guidance is:

- `AI_README.md:725` defines query authoring as typed application intent, not a
  string query language.
- `AI_README.md:1152` assigns encoding a published product for another process
  to a transport adapter; the host facade itself is not that transport.
- `crates/worth-query-host/src/facade.rs:3-23` re-exports typed admission,
  declaration, installation, runtime/primary-graph, and publication surfaces;
  it does not define a serialized process protocol.
- `crates/worth-query-host/tests/application_runtime_surface.rs:98-149`
  demonstrates the real public path: install a typed package, prepare the
  primary graph, bind a principal and entity, publish the application runtime,
  and resolve an entity. It is an application-specific Rust integration test,
  not a generic adapter endpoint.
- `crates/worth-query/docs/foundations/ordinary-application-front-door.md:19,48,70`
  requires descriptive transport code, recommends domain-native methods, and
  assigns application installation/admission/progression/publication to Query.
  Its recovery guidance also keeps live recovery handles runtime-local.

The adjacent installed `worth-query-bank-world` source was checked as a
possible example. Its `bank-server` and `bank-http-adapter` are bank-specific
domain and HTTP integrations, not a reusable Interface Compiler transport.
The WORTH test-only `in_memory_test_runtime` and `public_bridge_runtime`
fixtures were excluded: they are test support and do not provide a supported
production host boundary.

## Installed-source build evidence

Before choosing the seam, these checks were attempted in the installed WORTH
checkout:

```powershell
Set-Location C:\forge_workspace\forge\workspaces\worth-query
cargo metadata --no-deps --format-version 1
cargo check -p worth-query-host
cargo test -p worth-query-host --test application_runtime_surface -- --nocapture
cargo test -p worth-query-host --test canonical_graph_progression -- --nocapture
```

Each command stops before compiling a package because the workspace declares
this dependency in `Cargo.toml:45`:

```text
worth-schema-graph = { path = "../../cad/workspaces/worth-contracts/crates/worth-schema-graph" }
```

The declared checkout is absent:

```text
C:\forge_workspace\forge\cad\workspaces\worth-contracts\crates\worth-schema-graph\Cargo.toml
```

The resulting Cargo error is:

```text
error: failed to load manifest for workspace member
...\crates\worth-query
referenced by workspace ...\Cargo.toml
failed to load manifest for dependency `worth-schema-graph`
failed to read
C:\forge_workspace\forge\cad\workspaces\worth-contracts\crates\worth-schema-graph\Cargo.toml
The system cannot find the path specified. (os error 3)
```

This is an environment prerequisite, not evidence that the public facade is
itself incapable of hosting an application. It does prevent this worktree from
compiling against the installed facade today. No path dependency was added to
this worktree because it would leave the checked-in host tied to an unavailable
external checkout.

## Current launch sequence and fail-closed behavior

From the repository root, run:

```powershell
cargo run --manifest-path examples/interface-compiler/worth-runtime-host/Cargo.toml
```

Expected result:

- stdout is empty;
- stderr reports that no supported executable or serialized
  `worth-query-host` transport is configured;
- process exit status is `78`;
- no application, capability, replay, evidence, execution, event, or
  projection state is created.

There is no current TypeScript host-client launch command because no supported
process protocol exists to connect. `createWorthAdapter` accepts only an
explicit injected binding and rejects an absent, malformed, or incomplete
binding. Once an actual host supplies the complete port, adapter calls and
their `OperationContext` values are forwarded unchanged; host denials,
currentness conflicts, cancellation, timeouts, effect uncertainty, and
recovery postures remain typed rather than being flattened locally.

## Prerequisites for a genuine future bridge

All of the following are required before opening the seam:

1. Restore a matching `worth-contracts` checkout at the installed path above,
   or provide a supported dependency configuration, then make the public host
   examples and focused Rust checks pass.
2. Define an Interface Compiler application package on WORTH's typed public
   surface: schema and entities, principal/authentication mapping, one typed
   query or domain-native read for each supported adapter projection, and typed
   operations for each lifecycle/effect/publication command. The mapping must
   state revision/currentness, admission, idempotency, commit uncertainty,
   external-effect, and recovery behavior; it cannot be inferred from a marker
   or a report.
3. Specify an approved cross-language transport or binding for those typed
   products. The transport may encode WORTH-owned results, but it must not
   become a second authority or serialize live recovery handles as authority.
4. Implement the app-specific host/client using only the supported
   `worth-query-host::facade` APIs, then construct the existing adapter binding
   from that real client. Unsupported operations must remain explicit typed
   failures rather than local emulation.

## Live versus test-only

| Surface | Status | Authority claim |
| --- | --- | --- |
| `worth-runtime-host` in this worktree | Live executable guard only | Starts no runtime and owns no state |
| `packages/worth-adapter` | Live stateless contract/forwarder | Requires an externally supplied real host; has no fallback |
| `packages/worth-adapter/test` runtime objects | Test-only doubles | Verify forwarding and validation, never production authority |
| Installed WORTH host examples | Real typed examples/tests, external to this worktree | Not connected; currently blocked by the missing dependency checkout |
| WORTH `in_memory_test_runtime` / bridge fixtures | Test-only | Explicitly not used as a production bridge |
| Interface Compiler dashboard | No live WORTH binding | Must remain unavailable rather than infer projections |
