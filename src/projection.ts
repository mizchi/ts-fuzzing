// Shape projection: derive a narrow fuzz input type by selecting a list of
// dot-paths from a deeply nested target type.
//
// The type-level helper preserves the original type's resolved shape — when a
// field changes upstream, the projection follows. The runtime helper rebuilds
// a full value from a projection plus defaults.

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

type GetByPath<T, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? GetByPath<T[Head], Rest>
    : never
  : Path extends keyof T
    ? T[Path]
    : never;

type SetByPath<Path extends string, Value> = Path extends `${infer Head}.${infer Rest}`
  ? { [K in Head]: SetByPath<Rest, Value> }
  : { [K in Path]: Value };

type ProjectOne<T, Path extends string> = SetByPath<Path, GetByPath<T, Path>>;

export type ProjectFuzz<T, Paths extends string> = UnionToIntersection<
  Paths extends string ? ProjectOne<T, Paths> : never
>;

// Runtime helpers

const readPath = (source: unknown, path: string): unknown => {
  const segments = path.split(".");
  let current: unknown = source;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const writePath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const segments = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const existing = cursor[segment];
    if (existing === null || existing === undefined || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
};

export const pickPaths = <T, Paths extends readonly string[]>(
  source: T,
  paths: Paths,
): Pick<T, never> extends never ? unknown : unknown => {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    writePath(result, path, readPath(source, path));
  }
  return result as Pick<T, never> extends never ? unknown : unknown;
};

const deepClone = <T>(value: T): T => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(deepClone) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = deepClone(entry);
  }
  return result as T;
};

export const rebuildFrom = <Target, Projection extends Partial<Record<string, unknown>>>(
  projection: Projection,
  defaults: Target,
  paths: readonly string[],
): Target => {
  const next = deepClone(defaults);
  for (const path of paths) {
    const value = readPath(projection, path);
    if (value !== undefined) {
      writePath(next as unknown as Record<string, unknown>, path, value);
    }
  }
  return next;
};
