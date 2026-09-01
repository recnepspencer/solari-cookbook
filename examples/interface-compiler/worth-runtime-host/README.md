# Solari UI API Builder WORTH host

This narrow in-memory host installs the demo's typed WORTH application runtime.
It is intentionally not a general WORTH proxy and exposes only reads plus the
typed replay-recovery operations needed for:

```ts
trades.ingestIncomingTrade({ messageId })
```

The host seeds stale replay v1 for
`capability.trades.ingest-incoming-trade`. During the live recovery drill,
WORTH records v1's failure, accepts v2, retains three fresh-session verifier
receipts, and activates v2 while the public capability remains unchanged.

## Setup

Run `pwsh -File .\scripts\bootstrap.ps1` from the Interface Compiler root.
It clones the source-available WORTH dependency into `.local/worth`, checks out
the tested pinned revision, and keeps the tracked Cargo path unchanged. See
[SETUP.md](../SETUP.md) for Docker and one-command setup.

## Local host

```powershell
cargo run --manifest-path worth-runtime-host/Cargo.toml -- --serve
```

The process uses newline-delimited JSON with protocol
`interface-compiler.worth-host.v1`. It accepts a deterministic demo credential,
not an environment secret. Reads return WORTH-derived projections and typed
query receipts; unsupported operations return typed unavailable results.

Run the host test suite with:

```powershell
cargo test --manifest-path worth-runtime-host/Cargo.toml
```

The demo does not claim persistent storage, autonomous replay discovery, or
production trade posting.
