// A deliberately permissive escape function used to demonstrate XSS corpus fuzzing.
// The implementation below leaks tags in some cases, which the example test catches.
export const escapeHtml = (input: string): string => {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
};
