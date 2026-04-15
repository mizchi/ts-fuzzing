import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { TypeDescriptor } from "./descriptor.js";
export type StandardSchemaLike<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;
type SchemaInput<Schema extends StandardSchemaLike> = StandardSchemaV1.InferInput<Schema>;
type SchemaOutput<Schema extends StandardSchemaLike> = StandardSchemaV1.InferOutput<Schema>;
type NormalizedSchemaResult<Value> = {
    ok: true;
    value: Value;
} | {
    issues: readonly StandardSchemaV1.Issue[] | undefined;
    ok: false;
};
export type SchemaDescriptorSupport<Schema extends StandardSchemaLike = StandardSchemaLike> = {
    descriptor?: TypeDescriptor;
    normalizeSync: (value: unknown) => NormalizedSchemaResult<SchemaOutput<Schema>>;
    schema: Schema;
    validateSync: (value: unknown) => value is SchemaInput<Schema>;
    vendor: string;
};
export declare const schemaSupportFromSchema: <Schema extends StandardSchemaLike>(schema: Schema) => SchemaDescriptorSupport<Schema>;
export {};
//# sourceMappingURL=schema.d.ts.map