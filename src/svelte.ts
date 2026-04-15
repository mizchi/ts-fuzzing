import type { ComponentRenderStrategy } from "./component_fuzz.js";

export type SvelteRenderOptions = {
  context?: Map<any, any> | ((props: unknown) => Map<any, any> | undefined);
};

export const createSvelteRender = <Component = unknown, Props = unknown>(
  options: SvelteRenderOptions = {},
): ComponentRenderStrategy<Component, Props> => {
  return {
    async render(component, props) {
      const { render } = await import("svelte/server");
      const context =
        typeof options.context === "function" ? options.context(props) : options.context;

      render(component as any, {
        context,
        props: props as any,
      });
    },
  };
};
