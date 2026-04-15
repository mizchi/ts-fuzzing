import { cleanup, render as rtlRender } from "@testing-library/react";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import React, { createElement, type ReactNode } from "react";
import { analyzePropsDescriptor } from "./analyzer.js";
import type { ObjectDescriptor, PropertyDescriptor, TypeDescriptor } from "./descriptor.js";
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

const installDomGlobals = (dom: JSDOM) => {
  const { window } = dom;
  const bindings: Record<string, unknown> = {
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
    requestAnimationFrame:
      window.requestAnimationFrame?.bind(window) ??
      ((callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0)),
    cancelAnimationFrame:
      window.cancelAnimationFrame?.bind(window) ??
      ((id: number) => clearTimeout(id)),
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

export const createDomRender = <Props = any>(
  options: DomRenderOptions = {},
): ReactComponentRenderStrategy<Props> => {
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
      const input = props as DomRenderInput<Props>;
      const componentProps =
        options.providers && options.providers.length > 0 && typeof input === "object" && input !== null && "props" in input
          ? input.props
          : (input as Props);
      const providerValues =
        options.providers && options.providers.length > 0 && typeof input === "object" && input !== null && "providers" in input
          ? input.providers
          : undefined;

      let tree = createElement(component as React.ComponentType<any>, componentProps as any);
      if (options.providers && options.providers.length > 0) {
        for (const provider of [...options.providers].reverse()) {
          const generatedProps = providerValues?.[provider.key] ?? {};
          tree = createElement(provider.component as React.ComponentType<any>, {
            ...generatedProps,
            ...provider.fixedProps,
            children: tree,
          });
        }
      }

      if (options.wrapper) {
        tree = createElement(options.wrapper as React.ComponentType<any>, undefined, tree);
      }

      const result = rtlRender(tree);
      result.unmount();
      cleanup();
    },
  };
};
