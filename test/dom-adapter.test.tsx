import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { createReactDomRender } from "../src/dom.js";
import { SafeButton } from "./fixtures/SafeButton.js";
import { PrimitiveProvider } from "./fixtures/PrimitiveProvider.js";
import { ThemeLabel, ThemeProvider } from "./fixtures/ThemeLabel.js";

describe("DOM adapter", () => {
  test("describes provider-composed input and renders directly", async () => {
    const strategy = createReactDomRender({
      providers: [
        {
          key: "themeProvider",
          component: ThemeProvider,
          sourcePath: new URL("./fixtures/ThemeLabel.tsx", import.meta.url),
          exportName: "ThemeProvider",
          fixedProps: {},
        },
      ],
      wrapper: ({ children }) => <div data-wrapper="yes">{children}</div>,
    });

    expect(typeof strategy).toBe("object");
    if (typeof strategy === "function" || !strategy.describeInput) {
      throw new Error("expected object render strategy");
    }

    const descriptor = strategy.describeInput({
      kind: "object",
      properties: [{ key: "label", optional: false, value: { kind: "string" } }],
    });
    expect(descriptor.kind).toBe("object");
    if (descriptor.kind !== "object") {
      throw new Error("expected object descriptor");
    }
    const properties = Object.fromEntries(descriptor.properties.map((property) => [property.key, property]));
    expect(properties.props?.optional).toBe(false);
    expect(properties.providers?.optional).toBe(false);

    await strategy.render(ThemeLabel, {
      props: { label: "ok" },
      providers: {
        themeProvider: { theme: "light" },
      },
    });
  });

  test("returns the original descriptor when no providers are configured", () => {
    const strategy = createReactDomRender();
    expect(typeof strategy).toBe("object");
    if (typeof strategy === "function" || !strategy.describeInput) {
      throw new Error("expected object render strategy");
    }

    const descriptor = {
      kind: "object" as const,
      properties: [{ key: "label", optional: false, value: { kind: "string" as const } }],
    };
    expect(strategy.describeInput(descriptor)).toEqual(descriptor);
  });

  test("uses empty provider values when providers are configured but the input is plain props", async () => {
    const strategy = createReactDomRender({
      providers: [
        {
          key: "themeProvider",
          component: ThemeProvider,
          sourcePath: fileURLToPath(new URL("./fixtures/ThemeLabel.tsx", import.meta.url)),
          exportName: "ThemeProvider",
          fixedProps: { theme: "light" },
        },
      ],
    });

    if (typeof strategy === "function") {
      throw new Error("expected object render strategy");
    }

    await expect(strategy.render(ThemeLabel, { label: "ok" })).resolves.toBeUndefined();
  });

  test("accepts typeName for provider type lookup", () => {
    const strategy = createReactDomRender({
      providers: [
        {
          key: "themeProvider",
          component: ThemeProvider,
          sourcePath: new URL("./fixtures/ThemeLabel.tsx", import.meta.url),
          typeName: "ThemeProviderProps",
        },
      ],
    });

    if (typeof strategy === "function" || !strategy.describeInput) {
      throw new Error("expected object render strategy");
    }

    const descriptor = strategy.describeInput({
      kind: "object",
      properties: [{ key: "label", optional: false, value: { kind: "string" } }],
    });
    expect(descriptor.kind).toBe("object");
    if (descriptor.kind !== "object") {
      throw new Error("expected object descriptor");
    }
    const providersProperty = descriptor.properties.find((property) => property.key === "providers");
    expect(providersProperty?.value).toMatchObject({
      kind: "object",
      properties: [
        {
          key: "themeProvider",
          value: {
            kind: "object",
          },
        },
      ],
    });
  });

  test("rejects provider descriptors that are not object-shaped", () => {
    const strategy = createReactDomRender({
      providers: [
        {
          key: "primitiveProvider",
          component: PrimitiveProvider,
          sourcePath: new URL("./fixtures/PrimitiveProvider.tsx", import.meta.url),
          exportName: "PrimitiveProvider",
        },
      ],
    });

    if (typeof strategy === "function" || !strategy.describeInput) {
      throw new Error("expected object render strategy");
    }
    const describeInput = strategy.describeInput;

    expect(() =>
      describeInput({
        kind: "object",
        properties: [{ key: "label", optional: false, value: { kind: "string" } }],
      }),
    ).toThrow("provider props must be an object: primitiveProvider");
  });

  test("falls back to react-dom/test-utils act when React.act is unavailable", async () => {
    vi.resetModules();
    const fallbackAct = vi.fn(async (callback: () => unknown | Promise<unknown>) => {
      await callback();
    });

    vi.doMock("react", async () => {
      const actual = await vi.importActual<typeof import("react")>("react");
      return {
        ...actual,
        act: undefined,
      };
    });
    vi.doMock("react-dom/test-utils", () => ({
      act: fallbackAct,
    }));

    try {
      const { createReactDomRender: createMockedDomRender } = await import("../src/dom.js");
      const strategy = createMockedDomRender({
        wrapper: ({ children }) => <ThemeProvider theme="light">{children}</ThemeProvider>,
      });
      if (typeof strategy === "function") {
        throw new Error("expected object render strategy");
      }

      await strategy.render(SafeButton, {
        label: "ok",
        variant: "primary",
      });
      expect(fallbackAct).toHaveBeenCalled();
    } finally {
      vi.doUnmock("react");
      vi.doUnmock("react-dom/test-utils");
      vi.resetModules();
    }
  });
});
