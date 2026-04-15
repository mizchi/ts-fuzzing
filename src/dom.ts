import { fileURLToPath } from "node:url";
import type * as React from "react";
import { analyzePropsDescriptor } from "./analyzer.js";
import type { ObjectDescriptor, PropertyDescriptor, TypeDescriptor } from "./descriptor.js";
import type { ComponentRenderStrategy } from "./fuzz.js";
import { createIsolatedDom } from "./happy_dom.js";

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

type DomRenderInput<Props> =
  | Props
  | {
      props: Props;
      providers: Record<string, Record<string, unknown>>;
    };

const normalizePath = (sourcePath: string | URL) => {
  return sourcePath instanceof URL ? fileURLToPath(sourcePath) : sourcePath;
};

const isObjectDescriptor = (descriptor: TypeDescriptor): descriptor is ObjectDescriptor => {
  return descriptor.kind === "object";
};

const omitProperties = (descriptor: ObjectDescriptor, keys: Set<string>): ObjectDescriptor => {
  return {
    kind: "object",
    properties: descriptor.properties.filter((property) => !keys.has(property.key)),
  };
};

const providerDescriptor = (provider: DomRenderProvider): PropertyDescriptor => {
  const descriptor = analyzePropsDescriptor({
    exportName: provider.exportName,
    propsTypeName: provider.propsTypeName,
    sourcePath: normalizePath(provider.sourcePath),
  });
  if (!isObjectDescriptor(descriptor)) {
    throw new Error(`provider props must be an object: ${provider.key}`);
  }
  const fixedKeys = new Set<string>(["children", ...Object.keys(provider.fixedProps ?? {})]);
  return {
    key: provider.key,
    optional: false,
    value: omitProperties(descriptor, fixedKeys),
  };
};

const buildInputDescriptor = (
  componentPropsDescriptor: TypeDescriptor,
  providers: DomRenderProvider[] | undefined,
): TypeDescriptor => {
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

export const createDomRender = <Props = any>(
  options: DomRenderOptions = {},
): ComponentRenderStrategy<React.ComponentType<Props>, Props> => {
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

      const input = props as DomRenderInput<Props>;
      const componentProps =
        options.providers && options.providers.length > 0 && typeof input === "object" && input !== null && "props" in input
          ? input.props
          : (input as Props);
      const providerValues =
        options.providers && options.providers.length > 0 && typeof input === "object" && input !== null && "providers" in input
          ? input.providers
          : undefined;

      let tree = ReactModule.createElement(component as React.ComponentType<any>, componentProps as any);
      if (options.providers && options.providers.length > 0) {
        for (const provider of [...options.providers].reverse()) {
          const generatedProps = providerValues?.[provider.key] ?? {};
          tree = ReactModule.createElement(provider.component as React.ComponentType<any>, {
            ...generatedProps,
            ...provider.fixedProps,
            children: tree,
          });
        }
      }

      if (options.wrapper) {
        tree = ReactModule.createElement(options.wrapper as React.ComponentType<any>, undefined, tree);
      }

      const target = dom.window.document.createElement("div");
      dom.window.document.body.append(target);
      const root = ReactDomClient.createRoot(target as unknown as Element);

      try {
        await act(async () => {
          root.render(tree);
        });
      } finally {
        try {
          await act(async () => {
            root.unmount();
          });
        } finally {
          target.remove();
        }
      }
    },
  };
};

export const createReactDomRender = createDomRender;
