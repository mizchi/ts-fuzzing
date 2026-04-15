import type * as React from "react";
import type { ComponentRenderStrategy } from "./fuzz.js";
type SourceOptions = {
    sourcePath: string | URL;
    exportName?: string;
    propsTypeName?: string;
};
export type DomRenderProvider = SourceOptions & {
    component: React.ComponentType<any>;
    fixedProps?: Record<string, unknown>;
    key: string;
};
export type DomRenderOptions = {
    html?: string;
    providers?: DomRenderProvider[];
    url?: string;
    wrapper?: React.ComponentType<{
        children?: React.ReactNode;
    }>;
};
export declare const createDomRender: <Props = any>(options?: DomRenderOptions) => ComponentRenderStrategy<React.ComponentType<Props>, Props>;
export declare const createReactDomRender: <Props = any>(options?: DomRenderOptions) => ComponentRenderStrategy<React.ComponentType<Props>, Props>;
export {};
//# sourceMappingURL=dom.d.ts.map