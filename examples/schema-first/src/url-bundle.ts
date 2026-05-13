import * as z from "zod";

export const urlBundleSchema = z.object({
  items: z.array(z.string().min(1).max(16)).max(8),
});

export type UrlBundle = z.infer<typeof urlBundleSchema>;

export const empty: UrlBundle = { items: [] };

export const merge = (a: UrlBundle, b: UrlBundle): UrlBundle => ({
  items: dedupe([...a.items, ...b.items]),
});

const dedupe = (items: readonly string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
};

export const encode = (bundle: UrlBundle) => JSON.stringify(bundle);
export const decode = (text: string): UrlBundle => urlBundleSchema.parse(JSON.parse(text));
