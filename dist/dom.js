import { fileURLToPath } from "node:url";
import { analyzePropsDescriptor } from "./analyzer.js";
import { createIsolatedDom } from "./jsdom.js";
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
const resolveAct = async () => {
    const ReactModule = await import("react");
    if ("act" in ReactModule && typeof ReactModule.act === "function") {
        return ReactModule.act;
    }
    const ReactTestUtils = await import("react-dom/test-utils");
    return ReactTestUtils.act;
};
export const createDomRender = (options = {}) => {
    const dom = createIsolatedDom({
        html: options.html,
        url: options.url,
    });
    return {
        describeInput(componentPropsDescriptor) {
            return buildInputDescriptor(componentPropsDescriptor, options.providers);
        },
        async render(component, props) {
            const ReactModule = await import("react");
            const ReactDomClient = await import("react-dom/client");
            const act = await resolveAct();
            const input = props;
            const componentProps = options.providers && options.providers.length > 0 && typeof input === "object" && input !== null && "props" in input
                ? input.props
                : input;
            const providerValues = options.providers && options.providers.length > 0 && typeof input === "object" && input !== null && "providers" in input
                ? input.providers
                : undefined;
            let tree = ReactModule.createElement(component, componentProps);
            if (options.providers && options.providers.length > 0) {
                for (const provider of [...options.providers].reverse()) {
                    const generatedProps = providerValues?.[provider.key] ?? {};
                    tree = ReactModule.createElement(provider.component, {
                        ...generatedProps,
                        ...provider.fixedProps,
                        children: tree,
                    });
                }
            }
            if (options.wrapper) {
                tree = ReactModule.createElement(options.wrapper, undefined, tree);
            }
            const target = dom.window.document.createElement("div");
            dom.window.document.body.append(target);
            const root = ReactDomClient.createRoot(target);
            try {
                await act(async () => {
                    root.render(tree);
                });
            }
            finally {
                try {
                    await act(async () => {
                        root.unmount();
                    });
                }
                finally {
                    target.remove();
                }
            }
        },
    };
};
export const createReactDomRender = createDomRender;
//# sourceMappingURL=dom.js.map