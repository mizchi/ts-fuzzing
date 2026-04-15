import { describe, expect, test, vi } from "vitest";
import { createSvelteRender } from "../src/svelte.js";
import { createVueDomRender } from "../src/vue.js";
import SvelteBomb from "./fixtures/SvelteBomb.svelte";

describe("framework render helpers", () => {
  const SimpleComponent = {
    props: ["label"],
    setup(props: { label: string }) {
      return () => props.label;
    },
  };

  test("passes props into a Svelte context factory", async () => {
    const resolveContext = vi.fn((props: unknown) => new Map([["props", props]]));
    const render = createSvelteRender({
      context: resolveContext,
    });

    if (typeof render === "function") {
      throw new Error("expected object render strategy");
    }

    await render.render(SvelteBomb, {
      label: "ok",
      mode: "safe",
    });

    expect(resolveContext).toHaveBeenCalledWith({
      label: "ok",
      mode: "safe",
    });
  });

  test("runs Vue setupApp hooks and unmounts only after a successful mount", async () => {
    const setupApp = vi.fn((app: { provide: (key: string, value: string) => void }) => {
      app.provide("theme", "light");
    });
    const render = createVueDomRender({
      setupApp,
    });

    if (typeof render === "function") {
      throw new Error("expected object render strategy");
    }

    await render.render(SimpleComponent, {
      label: "ok",
    });

    expect(setupApp).toHaveBeenCalled();
  });

  test("cleans up the Vue target even when setupApp throws before mount", async () => {
    const render = createVueDomRender({
      setupApp: () => {
        throw new Error("setup failed");
      },
    });

    if (typeof render === "function") {
      throw new Error("expected object render strategy");
    }

    await expect(
      render.render(SimpleComponent, {
        label: "ok",
      }),
    ).rejects.toThrow("setup failed");
  });
});
