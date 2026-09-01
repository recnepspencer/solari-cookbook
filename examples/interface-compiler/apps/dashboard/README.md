# Interface Compiler operator dashboard

This is a small, read-only operator view for Interface Compiler. Worth Query
is the Interface Compiler runtime authority; this app renders only the
immutable projections returned by that query. It does not connect to Solari,
Gemini, or Worth internals directly, and it does not contain a local ledger,
verification authority, or demo records.

## Setup

From this directory:

```bash
npm install
npm run dev
```

The app can also be checked with:

```bash
npm run typecheck
npm run build
npm test
```

The browser entry point looks for the read-only
`window.interfaceCompilerWorthQuery` runtime query. Until Worth Query is
connected, the page intentionally shows an unavailable state. A query result
must distinguish ready, cancelled, timed-out, stale, unavailable, and failed
reads. Missing or failed evidence is rendered as such; it is never
reconstructed from copied identifiers.

Replay lifecycle, verification posture and counters, discovery failure
context, evidence status, and economics are all query-provided facts. The
dashboard may sort and select records for display, but it does not promote a
candidate, repair a failure, decide that evidence is sufficient, or aggregate
an authoritative ledger.

Only numbers returned in Worth projections are shown as measured economics or
benchmark metrics. The dashboard performs presentation-only derivation, such
as selecting a capability and counting visible rows; it does not calculate or
persist authoritative economics and it has no command path.

No credentials or `.env` values are required by this package.
