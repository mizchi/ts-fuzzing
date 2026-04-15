import type { ComponentRenderStrategy } from "./fuzz.js";
import { createIsolatedDom } from "./happy_dom.js";

export type VueAppLike = {
  config: unknown;
  component(name: string, component: unknown): unknown;
  directive(name: string, directive?: unknown): unknown;
  mount(target: Element | string): unknown;
  provide(key: unknown, value: unknown): unknown;
  unmount(): void;
  use(plugin: unknown, ...options: unknown[]): unknown;
};

export type VueDomRenderOptions<Props = unknown> = {
  html?: string;
  setupApp?: (app: VueAppLike, props: Props) => void;
  url?: string;
};

export const createVueDomRender = <Component = unknown, Props = unknown>(
  options: VueDomRenderOptions<Props> = {},
): ComponentRenderStrategy<Component, Props> => {
  const dom = createIsolatedDom({
    html: options.html,
    url: options.url,
  });

  return {
    async render(component, props) {
      const { createApp, h, nextTick } = await import("vue");
      const target = dom.window.document.createElement("div");
      dom.window.document.body.append(target);
      const app = createApp({
        render: () => h(component as any, props as any),
      });

      options.setupApp?.(app as unknown as VueAppLike, props as Props);

      let mounted = false;
      try {
        app.mount(target as unknown as Element);
        mounted = true;
        await nextTick();
      } finally {
        if (mounted) {
          app.unmount();
        }
        target.remove();
      }
    },
  };
};
