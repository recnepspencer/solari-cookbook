# Worth adapter

`@interface-compiler/worth-adapter` is the stateless TypeScript boundary to
the authoritative WORTH runtime.

The package exposes `createWorthAdapter(binding)`. The supplied
`WorthQueryHostFacadeBinding` must identify the public
`worth-query-host::facade` boundary and contain a `WorthRuntimePort` implemented
by an integration host. Reads return WORTH-owned projections, including the
aggregate compilation-metrics projection; commands and event publication are
forwarded to WORTH, where currentness, authorization, lifecycle transitions,
execution ownership, lineage, evidence, and durable event state remain
authoritative. The adapter does not calculate break-even or lifetime economics
from local observations; those values are returned only when WORTH has an
authoritative measured projection for them.

This package intentionally contains no in-memory registry, cache, reducer,
event bus, persistence, replay engine, or projection store. It also does not
invent an HTTP, RPC, or process protocol. The `boundary` field is integration
routing metadata, not an attestation token: a marker-only object is not a valid
production binding. At present no production binding is checked in; the
Interface Compiler host seam therefore fails closed when it is launched. See
[the bridge evidence](../../WORTH_BRIDGE_EVIDENCE.md) for the exact blocker and
required prerequisites.

A future app-specific typed host can implement the port without changing its
consumers, provided it enters WORTH through the supported public facade and
preserves the shared typed outcomes. The command helpers are convenience names
for the shared `WorthCommand` union. They do not apply transitions locally.
Helpers for existing replay, verification, capability, and execution records
require the expected current entity revision; callers must obtain that revision
from a WORTH projection and provide an `OperationContext` with bounded
admission. Replay failure and verification outcomes remain WORTH decisions, and
consumers receive the resulting typed submission or read projection.
