import { JSDOM } from "jsdom";
export type SharedDomOptions = {
    html?: string;
    url?: string;
};
export declare const createIsolatedDom: (options?: SharedDomOptions) => JSDOM;
//# sourceMappingURL=jsdom.d.ts.map