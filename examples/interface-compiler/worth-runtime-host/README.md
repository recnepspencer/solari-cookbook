# Worth Query demo-runtime host

This is the runnable Rust artifact for the Interface Compiler demo. Run it
with:

```bash
cargo run --manifest-path worth-runtime-host/Cargo.toml
```

The artifact is deliberately a small in-memory host manifest because this
workspace has no executable Node binding to the actual Rust
`worth-query-host::facade`. It records the exact demo claim: Worth Query is the
runtime authority, backing is process-local, and a full runtime restart is not
covered.

It does not implement Worth state, lifecycle, replay, evidence, health,
projections, or a transport. It also does not manufacture command outcomes.
The TypeScript adapter accepts a runtime only through an explicit
`worth-query-host::facade` bridge binding and rejects absent or unmarked
bindings; there is no TypeScript authority fallback.
