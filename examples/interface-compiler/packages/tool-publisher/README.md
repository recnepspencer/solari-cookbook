# Tool Publisher

`@interface-compiler/tool-publisher` derives safe Gemini tool definitions from
read-only projections issued by Worth. Worth remains authoritative for
capability authorization, health, active replay identity, and version lineage.
This package has no lifecycle store or publication ledger.

## Setup

From `examples/interface-compiler`:

```text
npm install
npm run typecheck --workspace @interface-compiler/tool-publisher
npm test --workspace @interface-compiler/tool-publisher
```

The Interface Compiler runtime supplies `WorthPublicationQuery`, whose Worth
Query implementation is authoritative for capability eligibility and current
lineage. A downstream integration may implement `ToolPublicationSink`; it
receives an immutable Worth-bound identity envelope plus a semantic-only
definition, and only that definition may be sent to Gemini. The publisher
calls Worth Query for every preparation or discovery request, gates only the
immutable projection it receives, and reports delivery outcomes from the
sink. It does not report provider cost, latency, or other measurements that it
did not observe.

Published descriptions and examples are semantic-only. Selectors, DOM and
automation details, replay details, credentials, and other forbidden metadata
are rejected before a sink is called.
