export const createSvelteRender = (options = {}) => {
    return {
        async render(component, props) {
            const { render } = await import("svelte/server");
            const context = typeof options.context === "function" ? options.context(props) : options.context;
            render(component, {
                context,
                props: props,
            });
        },
    };
};
//# sourceMappingURL=svelte.js.map