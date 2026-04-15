import { Window } from "happy-dom";

export type SharedDomOptions = {
  html?: string;
  url?: string;
};

const installDomGlobals = (window: Window) => {
  const bindings: Record<string, unknown> = {
    window,
    self: window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Text: window.Text,
    Comment: window.Comment,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    EventTarget: window.EventTarget,
    MutationObserver: window.MutationObserver,
    Document: window.Document,
    DocumentFragment: window.DocumentFragment,
    SVGElement: window.SVGElement,
    ShadowRoot: window.ShadowRoot,
    DOMParser: window.DOMParser,
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

export const createIsolatedDom = (options: SharedDomOptions = {}) => {
  const window = new Window({
    url: options.url ?? "http://localhost/",
  });
  window.document.write(options.html ?? "<!doctype html><html><body></body></html>");
  installDomGlobals(window);
  return { window };
};
