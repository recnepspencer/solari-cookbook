# Worth adapter

`@interface-compiler/worth-adapter` is the stateless TypeScript boundary to
the authoritative Worth runtime.

The package exposes `createWorthAdapter(binding)`. The supplied
`WorthQueryHostFacadeBinding` must identify the public
`worth-query-host::facade` boundary and contain a `WorthRuntimePort` implemented
by the integration host. Reads return
Worth-owned projections, including the aggregate compilation-metrics
projection; commands and event publication are forwarded to Worth, where
currentness, authorization, lifecycle transitions, execution ownership,
lineage, evidence, and durable event state remain authoritative. The adapter
does not calculate break-even or lifetime economics from local observations;
those values are returned only when Worth has an authoritative measured
projection for them.

This package intentionally contains no in-memory registry, cache, reducer,
event bus, persistence, replay engine, or projection store. It also does not
invent an HTTP or process protocol that the Interface Compiler cookbook has
not specified. A future transport binding can implement the port without
changing consumers of the adapter.

The command helpers are convenience names for the shared `WorthCommand` union.
They do not apply transitions locally. Helpers for existing replay,
verification, capability, and execution records require the expected current
entity revision; callers must obtain that revision from a Worth projection and
provide an `OperationContext` with bounded admission. In particular, replay
failure and verification outcomes remain Worth decisions, and consumers
receive the resulting typed submission or read projection.
