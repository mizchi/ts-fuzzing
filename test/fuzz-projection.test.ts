import { describe, expect, expectTypeOf, test } from "vitest";
import { pickPaths, rebuildFrom, type ProjectFuzz } from "../src/index.js";

type TextNode = {
  uuid: string;
  value: {
    uuid: string;
    text: string;
    classes: string[];
    style?: {
      bold: boolean;
      color: string;
    };
  };
  parent: {
    uuid: string;
  };
};

const fullNode: TextNode = {
  uuid: "root",
  value: {
    uuid: "value-uuid",
    text: "hello",
    classes: ["a", "b"],
    style: { bold: false, color: "black" },
  },
  parent: { uuid: "parent" },
};

describe("ProjectFuzz", () => {
  test("derives a flat projection type from selected paths", () => {
    type Projected = ProjectFuzz<TextNode, "value.uuid" | "value.text" | "value.classes">;

    const value: Projected = {
      value: {
        uuid: "u",
        text: "t",
        classes: ["x"],
      },
    };
    expectTypeOf(value.value.uuid).toEqualTypeOf<string>();
    expectTypeOf(value.value.text).toEqualTypeOf<string>();
    expectTypeOf(value.value.classes).toEqualTypeOf<string[]>();
  });
});

describe("pickPaths runtime helper", () => {
  test("returns only the selected paths", () => {
    const projection = pickPaths(fullNode, ["value.uuid", "value.text", "parent.uuid"] as const);
    expect(projection).toEqual({
      value: { uuid: "value-uuid", text: "hello" },
      parent: { uuid: "parent" },
    });
  });
});

describe("rebuildFrom runtime helper", () => {
  test("merges projection into defaults at the specified paths", () => {
    const projection = {
      value: { uuid: "PROJ", text: "PROJ-TEXT" },
    };
    const reconstructed = rebuildFrom(projection, fullNode, [
      "value.uuid",
      "value.text",
    ]);
    expect(reconstructed.value.uuid).toBe("PROJ");
    expect(reconstructed.value.text).toBe("PROJ-TEXT");
    // unrelated fields preserved from defaults
    expect(reconstructed.value.classes).toEqual(["a", "b"]);
    expect(reconstructed.parent.uuid).toBe("parent");
    expect(reconstructed.uuid).toBe("root");
    // does not mutate the source
    expect(fullNode.value.uuid).toBe("value-uuid");
  });

  test("survives a missing projection path by keeping the default", () => {
    const reconstructed = rebuildFrom({}, fullNode, ["value.text"]);
    expect(reconstructed.value.text).toBe("hello");
  });
});
