import type { ComponentRenderStrategy } from "./fuzz.js";
export type VueAppLike = {
    config: unknown;
    component(name: string, component: unknown): unknown;
    directive(name: string, directive?: unknown): unknown;
    mount(target: Element | string): unknown;
    provide(key: unknown, value: unknown): unknown;
    unmount(): void;
    use(plugin: unknown, ...options: unknown[]): unknown;
};
export type VueDomRenderOptions<Props = unknown> = {
    html?: string;
    setupApp?: (app: VueAppLike, props: Props) => void;
    url?: string;
};
export declare const createVueDomRender: <Component = unknown, Props = unknown>(options?: VueDomRenderOptions<Props>) => ComponentRenderStrategy<Component, Props>;
//# sourceMappingURL=vue.d.ts.map