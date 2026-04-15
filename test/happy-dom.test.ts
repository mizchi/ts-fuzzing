import { describe, expect, test } from "vitest";
import { createIsolatedDom } from "../src/happy_dom.js";

describe("createIsolatedDom", () => {
  test("installs DOM globals and animation frame helpers", async () => {
    const dom = createIsolatedDom({
      html: "<!doctype html><html><body><div id='app'></div></body></html>",
      url: "http://example.test/demo",
    });

    expect(globalThis.window).toBe(dom.window);
    expect(globalThis.document.getElementById("app")).not.toBeNull();
    expect(globalThis.location.href).toBe("http://example.test/demo");
    expect((globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT).toBe(true);

    await new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame((timestamp) => {
        expect(typeof timestamp).toBe("number");
        resolve();
      });
    });

    const timerId = globalThis.requestAnimationFrame(() => {
      throw new Error("cancelAnimationFrame should cancel this callback");
    });
    globalThis.cancelAnimationFrame(timerId);
  });
});
