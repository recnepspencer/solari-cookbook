# Worth adapter

`@interface-compiler/worth-adapter` is the transport boundary to the
authoritative WORTH runtime.

Its only runtime surface is `InterfaceCompilerWorthClient` and narrow ports
derived from that client for the work the Interface Compiler worker actually
performs: application and compiled-plan reads, execution admission and
settlement, identity-bound telemetry publication, and replay recovery. Each
request crosses the checked-in WORTH process boundary; WORTH decides
currentness, authorization, lifecycle transitions, execution ownership,
lineage, evidence, and terminal metrics.

The package intentionally contains no in-memory registry, cache, reducer,
event bus, persistence, replay engine, or projection store. The client owns
only child-process transport and request correlation. It returns typed
unavailable and denied outcomes for operations the demo host cannot perform;
there is no broader facade that the live host does not implement.

The app-specific protocol is `interface-compiler.worth-host.v1`. Capability
and active-replay reads include typed compilation provenance. `synthetic_seed`
means the replay is runnable for this demo but cannot support compilation
economics; `measured` carries the exact WORTH discovery and verification
execution identities required for reporting.

Runtime settlement returns WORTH's terminal execution projection, including
journal-derived model calls, tokens, browser observations/actions, cost,
timestamps, wall clock, and terminal outcome. The client validates protocol
shape at the boundary but never keeps a local authority ledger.
