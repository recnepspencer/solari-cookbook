# WORTH Query demo host seam

Status: unavailable by design. This binary is a fail-closed guard, not a
WORTH runtime, an in-memory store, or a transport.

Run it from the repository root:

```powershell
cargo run --manifest-path examples/interface-compiler/worth-runtime-host/Cargo.toml
```

The command must produce no stdout, print an availability diagnostic to stderr,
and exit with status `78`. It starts no state machine and emits no protocol
messages. A caller must not treat the diagnostic as a successful host response.

There is currently no checked-in production process binding for
`@interface-compiler/worth-adapter`. That package accepts a binding only when an
integration host supplies the complete `WorthRuntimePort` through the public
`worth-query-host::facade` boundary; it has no local fallback. The boundary
literal is routing metadata, not proof that an arbitrary object is backed by
WORTH. Test doubles belong only in adapter tests.

The reason this seam remains closed, the public-facade evidence, the failed
installed-source checks, and the exact prerequisites for a future typed host
are recorded in [WORTH_BRIDGE_EVIDENCE.md](../WORTH_BRIDGE_EVIDENCE.md).
