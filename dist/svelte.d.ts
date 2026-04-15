import type { ComponentRenderStrategy } from "./fuzz.js";
export type SvelteRenderOptions = {
    context?: Map<any, any> | ((props: unknown) => Map<any, any> | undefined);
};
export declare const createSvelteRender: <Component = unknown, Props = unknown>(options?: SvelteRenderOptions) => ComponentRenderStrategy<Component, Props>;
//# sourceMappingURL=svelte.d.ts.map