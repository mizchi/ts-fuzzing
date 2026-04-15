import { createIsolatedDom } from "./jsdom.js";
export const createVueDomRender = (options = {}) => {
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
                render: () => h(component, props),
            });
            options.setupApp?.(app, props);
            let mounted = false;
            try {
                app.mount(target);
                mounted = true;
                await nextTick();
            }
            finally {
                if (mounted) {
                    app.unmount();
                }
                target.remove();
            }
        },
    };
};
//# sourceMappingURL=vue.js.map