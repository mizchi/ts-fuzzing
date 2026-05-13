export const run = (value) => {
  if (typeof value !== "object" || value === null) return;
  // intentionally lossy — used by the CLI smoke test to verify the trace
};
