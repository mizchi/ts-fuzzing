import fc from "fast-check";
import { arbitraryFromDescriptor } from "./arbitrary.js";
import {
  emitFuzzWarnings,
  normalizeFuzzValue,
  resolveFuzzData,
  resolveInputDescriptor,
  type SchemaOptions,
  type SourceOptions,
} from "./fuzz_data.js";
import type { StandardSchemaLike } from "./schema.js";

export type ClassifyFn<Input> = (value: Input) => string | string[] | undefined;

export type StatisticsBucket = {
  count: number;
  label: string;
  ratio: number;
};

export type StatisticsReport = {
  buckets: ReadonlyArray<StatisticsBucket>;
  iterations: number;
  warnings: string[];
};

export type StatisticsOptions<
  Input = unknown,
  Schema extends StandardSchemaLike = StandardSchemaLike,
> = SourceOptions &
  SchemaOptions<Schema> & {
    classify: ClassifyFn<Input>;
    numRuns?: number;
    seed?: number;
  };

const recordLabels = (
  buckets: Map<string, number>,
  classification: string | string[] | undefined,
) => {
  if (classification === undefined) {
    return;
  }
  const labels = Array.isArray(classification) ? classification : [classification];
  for (const label of labels) {
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }
};

export const collectStatistics = async <Input = unknown>(
  options: StatisticsOptions<Input>,
): Promise<StatisticsReport> => {
  const resolved = resolveFuzzData(options);
  emitFuzzWarnings(resolved.warnings);
  const descriptor = resolveInputDescriptor(resolved.valueDescriptor, undefined);
  const baseArbitrary = arbitraryFromDescriptor(descriptor);
  const arbitrary = (
    resolved.schemaSupport
      ? baseArbitrary.filter((value) => resolved.schemaSupport!.normalizeSync(value).ok)
      : baseArbitrary
  ) as fc.Arbitrary<unknown>;

  const numRuns = options.numRuns ?? 100;
  const samples = fc.sample(arbitrary, {
    numRuns,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  });

  const buckets = new Map<string, number>();
  let iterations = 0;

  for (const candidate of samples) {
    const normalized = normalizeFuzzValue(candidate, resolved.schemaSupport);
    if (!normalized.ok) {
      continue;
    }
    iterations += 1;
    recordLabels(buckets, options.classify(normalized.value as Input));
  }

  const total = iterations || 1;
  const sorted = [...buckets.entries()]
    .map(([label, count]) => ({ count, label, ratio: count / total }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    buckets: sorted,
    iterations,
    warnings: resolved.warnings,
  };
};

export const formatStatistics = (report: StatisticsReport): string => {
  if (report.buckets.length === 0) {
    return `(no labels classified across ${report.iterations} samples)`;
  }
  const total = report.iterations;
  const widthCount = String(total).length;
  const widthLabel = report.buckets.reduce(
    (max, bucket) => Math.max(max, bucket.label.length),
    0,
  );
  const lines = report.buckets.map((bucket) => {
    const percent = (bucket.ratio * 100).toFixed(1).padStart(5);
    const count = String(bucket.count).padStart(widthCount);
    return `${percent}%  [${count}/${total}]  ${bucket.label.padEnd(widthLabel)}`;
  });
  return lines.join("\n");
};
