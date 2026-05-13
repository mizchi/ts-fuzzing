import { describe, expect, test } from "vitest";
import {
  analyzeTypeDescriptor,
  fuzzValues,
  resolveFuzzData,
  type TypeAdapters,
} from "../src/index.js";

const sourcePath = new URL("./fixtures/Decimal.ts", import.meta.url).pathname;

describe("typeAdapters extension point", () => {
  test("without an adapter, Decimal expands into a large object descriptor", () => {
    const descriptor = analyzeTypeDescriptor({
      sourcePath,
      typeName: "DecimalSlot",
    });
    expect(descriptor.kind).toBe("object");
    if (descriptor.kind !== "object") return;
    const amount = descriptor.properties.find((property) => property.key === "amount");
    expect(amount?.value.kind).toBe("object");
  });

  test("an adapter replaces the descriptor for matching symbol names", () => {
    const adapters: TypeAdapters = {
      Decimal: { kind: "number", integer: false, constraints: { min: 0, max: 1000 } },
    };
    const descriptor = analyzeTypeDescriptor({
      sourcePath,
      typeName: "DecimalSlot",
      typeAdapters: adapters,
    });
    expect(descriptor.kind).toBe("object");
    if (descriptor.kind !== "object") return;
    const amount = descriptor.properties.find((property) => property.key === "amount");
    expect(amount?.value).toMatchObject({ kind: "number", integer: false });
  });

  test("adapters propagate through resolveFuzzData / fuzzValues", async () => {
    const adapters: TypeAdapters = {
      Decimal: () => ({ kind: "string", constraints: { minLength: 1, maxLength: 4 } }),
    };
    const resolved = resolveFuzzData({
      sourcePath,
      typeName: "DecimalSlot",
      typeAdapters: adapters,
    });
    expect(resolved.valueDescriptor.kind).toBe("object");

    let saw = 0;
    await fuzzValues<{ amount: unknown; label: string }>({
      sourcePath,
      typeName: "DecimalSlot",
      typeAdapters: adapters,
      numRuns: 10,
      seed: 1,
      run({ amount }) {
        if (typeof amount === "string") {
          saw += 1;
        }
      },
    });
    expect(saw).toBe(10);
  });
});
