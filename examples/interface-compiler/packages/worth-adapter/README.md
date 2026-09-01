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
event bus, persistence, replay engine, or projection store. The complete-port
`WorthQueryHostFacadeBinding` remains closed unless an integration supplies all
of `WorthRuntimePort`; its `boundary` field is routing metadata, not an
attestation token, and a marker-only object is not a valid production binding.

The package also exposes the separate app-specific
`InterfaceCompilerWorthClient`, `createWorthApplicationReadAdapter`, and
`createWorthStartExecutionAdapter`. That client crosses the checked-in demo's
explicit process boundary and supports only the WORTH-backed `readApplication`
and `startExecution` vertical slices, plus the narrow
`WorthExecutionSettlementPort` for execution completion and concrete domain
event publication. It returns typed
unavailable/denied outcomes for the boundary without pretending to implement
the complete port. The client owns only process transport and request
correlation; it has no local authority or WORTH recovery-handle serialization.
See [the bridge evidence](../../WORTH_BRIDGE_EVIDENCE.md) for the exact
live/unavailable surface and remaining prerequisites.

A future app-specific typed host can implement the port without changing its
consumers, provided it enters WORTH through the supported public facade and
preserves the shared typed outcomes. The command helpers are convenience names
for the shared `WorthCommand` union. They do not apply transitions locally.
Helpers for existing replay, verification, capability, and execution records
require the expected current entity revision; callers must obtain that revision
from a WORTH projection and provide an `OperationContext` with bounded
admission. Replay failure and verification outcomes remain WORTH decisions, and
consumers receive the resulting typed submission or read projection.
