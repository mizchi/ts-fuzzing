import { fileURLToPath } from "node:url";
import {
  fuzzValues,
  quickCheckValues,
  sampleBoundaryValues,
  sampleValues,
} from "../../src/index.js";
import { collectAsync } from "../helpers/collect_async.js";
import {
  createReactDomRender,
  fuzzReactComponent,
  quickCheckReactComponent,
} from "../../src/react.js";

type SafeButtonProps = {
  count?: number;
  label: string;
  variant: "ghost" | "primary";
};

const safeButtonPath = fileURLToPath(new URL("../fixtures/SafeButton.tsx", import.meta.url));

async function verifySourceBackedTyping() {
  const sampled = await collectAsync(sampleValues<SafeButtonProps>({
    sourcePath: safeButtonPath,
    typeName: "SafeButtonProps",
    numRuns: 2,
  }));
  sampled[0]?.label satisfies string;
  sampled[0]?.variant satisfies "ghost" | "primary";

  const boundary = await collectAsync(sampleBoundaryValues<SafeButtonProps>({
    sourcePath: safeButtonPath,
    typeName: "SafeButtonProps",
    maxCases: 4,
  }));
  boundary[0]?.label satisfies string;

  await fuzzValues<SafeButtonProps>({
    sourcePath: safeButtonPath,
    typeName: "SafeButtonProps",
    run(value) {
      value.label satisfies string;
      value.variant satisfies "ghost" | "primary";
    },
  });

  await quickCheckValues<SafeButtonProps>({
    sourcePath: safeButtonPath,
    typeName: "SafeButtonProps",
    run(value) {
      value.label satisfies string;
    },
  });
}

async function verifyReactSubpathTyping() {
  await fuzzReactComponent<SafeButtonProps>({
    component: (() => null) as any,
    sourcePath: safeButtonPath,
    exportName: "SafeButton",
    render: createReactDomRender(),
  });

  await quickCheckReactComponent<SafeButtonProps>({
    component: (() => null) as any,
    sourcePath: safeButtonPath,
    exportName: "SafeButton",
    render: createReactDomRender(),
  });
}

// @ts-expect-error React adapters live under ../../src/react.js
import { fuzzReactComponent as rootFuzzReactComponent } from "../../src/index.js";
// @ts-expect-error createDomRender was removed in favor of createReactDomRender
import { createDomRender } from "../../src/react.js";
void rootFuzzReactComponent;
void createDomRender;

// @ts-expect-error propsTypeName was removed in favor of typeName
sampleValues({ sourcePath: safeButtonPath, propsTypeName: "SafeButtonProps", numRuns: 2 });

void verifySourceBackedTyping;
void verifyReactSubpathTyping;
