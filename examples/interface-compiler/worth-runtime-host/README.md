# Interface Compiler WORTH Query host

This is a real, deliberately narrow WORTH Query host. It installs and
publishes a typed Interface Compiler application runtime through the public
`worth-query-host::facade`, admits the demo credential and principal mapping,
and executes one bounded application query against WORTH's in-memory
relational graph.

The host requires the complete matching checkout at:

```text
C:\forge_workspace\worktree_2\workspaces\worth-query
```

That path is a Cargo dependency only; this worktree does not modify Forge
source. The full boundary evidence is in
[WORTH_BRIDGE_EVIDENCE.md](../WORTH_BRIDGE_EVIDENCE.md).

## Run the process host

From the repository root:

```powershell
cargo run --manifest-path examples/interface-compiler/worth-runtime-host/Cargo.toml -- --serve
```

The process accepts newline-delimited JSON and emits one response per line.
For example:

```json
{"protocol":"interface-compiler.worth-host.v1","request_id":"demo-1","operation":"read_application","application_id":"application.interface-compiler","credential":"interface-compiler-demo","deadline_ms":5000}
```

The live response contains the WORTH-derived `worth_application` projection and
query receipt evidence. Unsupported operations return a typed
`unavailable/unsupported` response. Invalid credentials return a typed
authentication denial.

## TypeScript client

Use the app-specific client from `@interface-compiler/worth-adapter`:

```ts
import {
  createWorthApplicationReadAdapter,
  InterfaceCompilerWorthClient,
} from "@interface-compiler/worth-adapter"

const client = new InterfaceCompilerWorthClient({
  process: {
    command: "cargo",
    args: ["run", "--quiet", "--manifest-path", "examples/interface-compiler/worth-runtime-host/Cargo.toml", "--", "--serve"],
  },
  credential: "interface-compiler-demo",
})
const worth = createWorthApplicationReadAdapter(client)
const result = await worth.readApplication(applicationId, context)
await client.close()
```

The client retains only child-process transport and request correlation. It
does not cache projections, run a reducer, own lifecycle/replay/evidence
state, or serialize WORTH recovery handles. The returned read result includes a
typed `found`, `not_found`, `denied`, `unavailable`, `cancelled`, or `timed_out`
outcome.

This is not a complete `WorthRuntimePort` implementation. The existing broad
`createWorthAdapter` remains closed until every read, mutation, lifecycle,
metrics, and event method is faithfully implemented through WORTH. No
TypeScript fallback or test runtime is supplied.
