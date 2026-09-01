# Gemini adapter

The adapter is the only package in this example that imports `@google/genai`. It uses the maintained `GoogleGenAI.models.generateContent` API with JSON structured output and an `AbortSignal`, while exposing the domain `ReasoningModel` contract to the orchestrator.

Credentials are read only from `GEMINI_API_KEY`; the model name is read from `GEMINI_MODEL` unless supplied by the caller. Pricing must be supplied by the caller from an authoritative pricing source so token usage produces an estimate without pretending that a fixture or hardcoded sample was measured. Tests use an injected transport and make no live or paid requests.

The adapter reports candidate output tokens and Gemini thought tokens separately while calculating the estimate from both. The orchestrator forwards the resulting model-called event to Worth; it does not aggregate or persist usage locally. Every call requires the bounded `OperationContext` admitted by the caller's Worth boundary, including its absolute deadline and wall-clock budget, and interrupted or failed provider calls carry an explicit indeterminate effect posture.

```text
npm run typecheck --workspace @interface-compiler/gemini-adapter
npm run test --workspace @interface-compiler/gemini-adapter
```

The SDK's client-side abort signal stops local waiting; it does not guarantee that an already accepted provider request is free of usage. Callers should treat an interrupted request as an indeterminate external effect when reconciling with Worth.
