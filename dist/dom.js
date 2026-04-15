import { cleanup, render as rtlRender } from "@testing-library/react";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { analyzePropsDescriptor } from "./analyzer.js";
const normalizePath = (sourcePath) => {
    return sourcePath instanceof URL ? fileURLToPath(sourcePath) : sourcePath;
};
const isObjectDescriptor = (descriptor) => {
    return descriptor.kind === "object";
};
const omitProperties = (descriptor, keys) => {
    return {
        kind: "object",
        properties: descriptor.properties.filter((property) => !keys.has(property.key)),
    };
};
const providerDescriptor = (provider) => {
    const descriptor = analyzePropsDescriptor({
        exportName: provider.exportName,
        propsTypeName: provider.propsTypeName,
        sourcePath: normalizePath(provider.sourcePath),
    });
    if (!isObjectDescriptor(descriptor)) {
        throw new Error(`provider props must be an object: ${provider.key}`);
    }
    const fixedKeys = new Set(["children", ...Object.keys(provider.fixedProps ?? {})]);
    return {
        key: provider.key,
        optional: false,
        value: omitProperties(descriptor, fixedKeys),
    };
};
const buildInputDescriptor = (componentPropsDescriptor, providers) => {
    if (!providers || providers.length === 0) {
        return componentPropsDescriptor;
    }
    return {
        kind: "object",
        properties: [
            {
                key: "props",
                optional: false,
                value: componentPropsDescriptor,
            },
            {
                key: "providers",
                optional: false,
                value: {
                    kind: "object",
                    properties: providers.map((provider) => providerDescriptor(provider)),
                },
            },
        ],
    };
};
const installDomGlobals = (dom) => {
    const { window } = dom;
    const bindings = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        Element: window.Element,
        Node: window.Node,
        Text: window.Text,
        Event: window.Event,
        EventTarget: window.EventTarget,
        MutationObserver: window.MutationObserver,
        DocumentFragment: window.DocumentFragment,
        SVGElement: window.SVGElement,
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
export const createDomRender = (options = {}) => {
    const dom = new JSDOM(options.html ?? "<!doctype html><html><body></body></html>", {
        url: options.url ?? "http://localhost/",
    });
    installDomGlobals(dom);
    return {
        describeInput(componentPropsDescriptor) {
            return buildInputDescriptor(componentPropsDescriptor, options.providers);
        },
        async render(component, props) {
            cleanup();
            const input = props;
            const componentProps = options.providers && options.providers.length > 0 && typeof input === "object" && input !== null && "props" in input
                ? input.props
                : input;
            const providerValues = options.providers && options.providers.length > 0 && typeof input === "object" && input !== null && "providers" in input
                ? input.providers
                : undefined;
            let tree = createElement(component, componentProps);
            if (options.providers && options.providers.length > 0) {
                for (const provider of [...options.providers].reverse()) {
                    const generatedProps = providerValues?.[provider.key] ?? {};
                    tree = createElement(provider.component, {
                        ...generatedProps,
                        ...provider.fixedProps,
                        children: tree,
                    });
                }
            }
            if (options.wrapper) {
                tree = createElement(options.wrapper, undefined, tree);
            }
            const result = rtlRender(tree);
            result.unmount();
            cleanup();
        },
    };
};
//# sourceMappingURL=dom.js.map