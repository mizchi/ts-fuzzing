import React, { type ReactNode } from "react";
import type { ReactComponentRenderStrategy } from "./fuzz.js";
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
        children?: ReactNode;
    }>;
};
export declare const createDomRender: <Props = any>(options?: DomRenderOptions) => ReactComponentRenderStrategy<Props>;
export {};
//# sourceMappingURL=dom.d.ts.map