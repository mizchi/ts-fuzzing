# Architecture Notes

## Generic core

`ts-fuzzing` is organized around a generic value pipeline:

1. `src/analyzer.ts`
   Extracts a `TypeDescriptor` from exported TypeScript types or exported callables.
2. `src/descriptor.ts`
   Defines the internal `TypeDescriptor` / `ObjectDescriptor` / `FuzzConstraints` shapes.
3. `src/fuzz_data.ts`
   Resolves descriptors from TypeScript or schema sources and samples random or boundary values.
4. `src/arbitrary.ts` / `src/boundary.ts`
   Build fast-check arbitraries and boundary value sets from a resolved descriptor.
5. `src/input_fuzz.ts`
   Runs property-based fuzzing, boundary-focused quick-checks, and lightweight coverage-guided fuzzing against arbitrary callbacks.

This makes the core usable without any UI framework.

## Public entrypoints

The package ships four subpath entrypoints in addition to the root:

- `ts-fuzzing` — generic value pipeline (`fuzzValues`, `quickCheckValues`, `fuzzValuesGuided`, `fuzzValuesMulti`, the invariant helpers, the corpus / mutation helpers, the replay / repro helpers, and the shared marker types).
- `ts-fuzzing/react` — React adapter (`fuzzReactComponent`, `createReactDomRender`, `quickCheckReactComponent`).
- `ts-fuzzing/vue` — Vue renderer (`createVueDomRender`).
- `ts-fuzzing/svelte` — Svelte renderer (`createSvelteRender`).
- `ts-fuzzing/security` — curated security corpora (`xssPayloads`, `xssCorpus`, `xssPayloadsByCategory`, and the `XssPayload` marker type).

## UI adapters

- `src/react_fuzz.ts` exposes React-focused helpers such as `fuzzReactComponent`
- `src/component_fuzz.ts` adapts generic value runners to component render strategies
- `src/dom.ts`, `src/vue.ts`, and `src/svelte.ts` provide framework renderers on top of the generic component API

The component APIs are adapters over the generic value fuzzing layer, not the other way around. Component fuzzing reuses the same descriptor / schema pipeline; only the runner wrapper differs.

## Type and schema sources

- exported TypeScript types are addressed through `typeName` (the legacy alias `propsTypeName` is no longer supported)
- callable exports can still be inferred through `exportName`
- marker types exported from `ts-fuzzing` such as `UUID`, `Int`, and `Pattern<...>` are treated as fuzzing-only hints and merged into the base descriptor when written as intersections like `string & UUID`
- security marker types exported from `ts-fuzzing/security` (currently `XssPayload`) plug into the same `Pattern<...>` mechanism and draw from curated corpora in `src/security_corpus.ts`
- unresolved generic parameters use their `extends` constraint when it can be generalized into a descriptor
- unresolved conditional types are generalized only when their checked type has a usable `extends` constraint and the branches do not depend on `infer`; `infer`-heavy conditionals still fall back to `unknown`
- nongeneralizable generics fall back to `unknown` and surface runtime warnings; nested generic instantiations with unresolved parameters share the same fallback
- common external runtime types such as `ReactNode`, `URL`, `Map`, and `Set` are normalized before generic object expansion
- DOM / Web API host types — `Blob`, `File`, `FormData`, `Headers`, `URLSearchParams`, `AbortSignal`, `Request`, `Response`, `Event` — are normalized into a dedicated `host` descriptor and produce real runtime instances via `src/host_types.ts`
- imported validator instance types from `zod` / `valibot` are detected as schema-backed and prefer the schema path; using them as plain TypeScript types may expand into large object descriptors and is intentionally not encouraged
- `zod` and `valibot` can describe values directly
- generic `Standard Schema` integration is used as a validation and normalization overlay when no direct descriptor is available

## DOM environment

The DOM runner uses `happy-dom`. It installs the minimum globals required by the React, Vue, and Svelte adapters while keeping the environment isolated inside the renderer factory. The same factory powers `createReactDomRender`, `createVueDomRender`, and `createSvelteRender`. The legacy `createDomRender` alias has been removed in favor of the framework-specific factories.

## Guided mode

Coverage-guided fuzzing is intentionally lightweight. It uses `node:inspector` precise coverage and a small in-memory or optionally persisted corpus instead of compiler instrumentation. After each iteration the coverage delta is compared against everything previously seen for `sourcePath`; inputs that unlock new V8 basic blocks are kept and mutated to seed the next candidate. This keeps setup friction low (no source maps, no extra build step) while still surfacing inputs that hit rare branches.

## Failure reporting

Fuzzing failures throw a single error shape per surface area:

- `ValueFuzzError` for generic value runs, with `failingValue`, `seed`, optional `report` (`GuidedCoverageReport` / `QuickCheckReport`), and accumulated `warnings`
- `ComponentFuzzError` for component runs, mirroring the value error but carrying the failing component input rather than `failingValue`
- `StatefulFuzzError` for command-sequence runs, with a `failingTrace`
- `ReactComponentFuzzError` for the React adapter

The legacy `failingProps` field has been replaced everywhere by `failingValue` / `failingInput` on the corresponding error. `renderReproTest` / `writeReproTest` turn a caught error into a standalone repro test.

## Known limitations

- generic type parameters that cannot be generalized from `extends` fall back to `unknown`
- conditional types that depend on `infer` fall back to `unknown` with a warning
- deeply nested imported validator instance types may expand before the schema overlay can take over — prefer the schema source in those cases
- DOM / Web API host types beyond the normalized set are expanded as plain objects
