import { JSDOM } from "jsdom";
const installDomGlobals = (dom) => {
    const { window } = dom;
    const bindings = {
        window,
        self: window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        Element: window.Element,
        Node: window.Node,
        Text: window.Text,
        Event: window.Event,
        CustomEvent: window.CustomEvent,
        EventTarget: window.EventTarget,
        MutationObserver: window.MutationObserver,
        DocumentFragment: window.DocumentFragment,
        SVGElement: window.SVGElement,
        ShadowRoot: window.ShadowRoot,
        getComputedStyle: window.getComputedStyle.bind(window),
        requestAnimationFrame: window.requestAnimationFrame?.bind(window) ??
            ((callback) => setTimeout(() => callback(Date.now()), 0)),
        cancelAnimationFrame: window.cancelAnimationFrame?.bind(window) ??
            ((id) => clearTimeout(id)),
    };
    for (const [key, value] of Object.entries(bindings)) {
        Object.defineProperty(globalThis, key, {
            configurable: true,
            value,
            writable: true,
        });
    }
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
        configurable: true,
        value: true,
        writable: true,
    });
};
export const createIsolatedDom = (options = {}) => {
    const dom = new JSDOM(options.html ?? "<!doctype html><html><body></body></html>", {
        url: options.url ?? "http://localhost/",
    });
    installDomGlobals(dom);
    return dom;
};
//# sourceMappingURL=jsdom.js.map