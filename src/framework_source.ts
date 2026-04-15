import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

const EXTRACTED_PROPS_TYPE_NAME = "__PropsFuzzingExtracted";

type PreparedSource = {
  propsTypeName?: string;
  sourcePath: string;
  virtualPath?: string;
  virtualSourceText?: string;
};

type ScriptBlock = {
  attrs: string;
  content: string;
};

type VuePropsExtraction =
  | {
      kind: "runtime";
      expressionText: string;
    }
  | {
      kind: "type";
      typeText: string;
    };

const leadingCommentText = (sourceText: string, node: ts.Node) => {
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  return ranges
    .map((range) => sourceText.slice(range.pos, range.end))
    .join("\n")
    .trim();
};

const toVirtualPath = (sourcePath: string, suffix: string) => {
  return path.join(path.dirname(sourcePath), `${path.basename(sourcePath)}${suffix}`);
};

const createVirtualSource = (
  sourcePath: string,
  sourceText: string,
  propsTypeName = EXTRACTED_PROPS_TYPE_NAME,
): PreparedSource => {
  return {
    propsTypeName,
    sourcePath,
    virtualPath: toVirtualPath(sourcePath, ".props-fuzzing.ts"),
    virtualSourceText: sourceText,
  };
};

const extractSvelteScripts = (sourceText: string) => {
  const blocks: ScriptBlock[] = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(sourceText)) !== null) {
    blocks.push({
      attrs: match[1] ?? "",
      content: match[2] ?? "",
    });
  }
  const moduleBlock = blocks.find((block) => /\bcontext\s*=\s*["']module["']/.test(block.attrs));
  const instanceBlock = blocks.find((block) => !/\bcontext\s*=\s*["']module["']/.test(block.attrs));
  return {
    instanceScript: instanceBlock?.content.trim() ?? "",
    moduleScript: moduleBlock?.content.trim() ?? "",
  };
};

const findSvelteRunesPropsType = (sourceFile: ts.SourceFile) => {
  let extracted: string | undefined;

  const visit = (node: ts.Node) => {
    if (extracted) {
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
      const call = node.initializer;
      if (ts.isIdentifier(call.expression) && call.expression.text === "$props") {
        if (node.type) {
          extracted = node.type.getText(sourceFile);
          return;
        }
        if (call.typeArguments?.[0]) {
          extracted = call.typeArguments[0].getText(sourceFile);
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return extracted;
};

const createSvelteExportedPropsType = (sourceFile: ts.SourceFile) => {
  const entries: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const isExported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported || (statement.declarationList.flags & ts.NodeFlags.Let) === 0) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }
      const comment = leadingCommentText(sourceFile.text, statement);
      const optional = declaration.initializer ? "?" : "";
      const commentText = comment ? `${comment}\n` : "";
      entries.push(`${commentText}${declaration.name.text}${optional}: typeof ${declaration.name.text};`);
    }
  }

  if (entries.length === 0) {
    return undefined;
  }

  return `{\n${entries.map((entry) => `  ${entry}`).join("\n")}\n}`;
};

const createSvelteVirtualSource = (sourcePath: string) => {
  const sourceText = fs.readFileSync(sourcePath, "utf8");
  const { instanceScript, moduleScript } = extractSvelteScripts(sourceText);
  if (!instanceScript) {
    return undefined;
  }

  const scriptSource = ts.createSourceFile(
    `${sourcePath}.svelte.ts`,
    instanceScript,
    ts.ScriptTarget.ES2024,
    true,
    ts.ScriptKind.TS,
  );

  const extractedType = findSvelteRunesPropsType(scriptSource) ?? createSvelteExportedPropsType(scriptSource);
  if (!extractedType) {
    return undefined;
  }

  const modulePrefix = moduleScript ? `${moduleScript}\n\n` : "";
  return createVirtualSource(
    sourcePath,
    `${modulePrefix}declare function $props<T>(): T;\n\n${instanceScript}\n\nexport type ${EXTRACTED_PROPS_TYPE_NAME} = ${extractedType};\n`,
  );
};

const findCallByName = (node: ts.Node, name: string) => {
  if (!ts.isCallExpression(node)) {
    return undefined;
  }
  return ts.isIdentifier(node.expression) && node.expression.text === name ? node : undefined;
};

const unwrapVueDefinePropsCall = (expression: ts.Expression): ts.CallExpression | undefined => {
  const direct = findCallByName(expression, "defineProps");
  if (direct) {
    return direct;
  }
  const wrapped = findCallByName(expression, "withDefaults");
  if (!wrapped) {
    return undefined;
  }
  const first = wrapped.arguments[0];
  return first ? unwrapVueDefinePropsCall(first) : undefined;
};

const findVueSetupProps = (sourceFile: ts.SourceFile): VuePropsExtraction | undefined => {
  let extracted: VuePropsExtraction | undefined;

  const visit = (node: ts.Node) => {
    if (extracted) {
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const definePropsCall = unwrapVueDefinePropsCall(node.initializer);
      if (definePropsCall?.typeArguments?.[0]) {
        extracted = {
          kind: "type",
          typeText: definePropsCall.typeArguments[0].getText(sourceFile),
        };
        return;
      }
      if (definePropsCall?.arguments[0]) {
        extracted = {
          kind: "runtime",
          expressionText: definePropsCall.arguments[0].getText(sourceFile),
        };
        return;
      }
    }
    if (ts.isExpressionStatement(node)) {
      const definePropsCall = unwrapVueDefinePropsCall(node.expression);
      if (definePropsCall?.typeArguments?.[0]) {
        extracted = {
          kind: "type",
          typeText: definePropsCall.typeArguments[0].getText(sourceFile),
        };
        return;
      }
      if (definePropsCall?.arguments[0]) {
        extracted = {
          kind: "runtime",
          expressionText: definePropsCall.arguments[0].getText(sourceFile),
        };
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return extracted;
};

const findVueRuntimeProps = (sourceFile: ts.SourceFile) => {
  let extracted: string | undefined;

  const getPropsProperty = (objectLiteral: ts.ObjectLiteralExpression) => {
    return objectLiteral.properties.find((property) => {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        return false;
      }
      const name = property.name;
      return (
        (ts.isIdentifier(name) && name.text === "props") ||
        (ts.isStringLiteral(name) && name.text === "props")
      );
    });
  };

  const visit = (node: ts.Node) => {
    if (extracted) {
      return;
    }
    if (ts.isExportAssignment(node)) {
      let componentOptions: ts.ObjectLiteralExpression | undefined;
      if (ts.isObjectLiteralExpression(node.expression)) {
        componentOptions = node.expression;
      } else if (
        ts.isCallExpression(node.expression) &&
        node.expression.arguments[0] &&
        ts.isObjectLiteralExpression(node.expression.arguments[0])
      ) {
        componentOptions = node.expression.arguments[0];
      }

      if (componentOptions) {
        const propsProperty = getPropsProperty(componentOptions);
        if (propsProperty && ts.isPropertyAssignment(propsProperty)) {
          extracted = propsProperty.initializer.getText(sourceFile);
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return extracted;
};

const createVueVirtualSource = (sourcePath: string) => {
  const compiler = require("vue/compiler-sfc") as typeof import("vue/compiler-sfc");
  const sourceText = fs.readFileSync(sourcePath, "utf8");
  const { descriptor } = compiler.parse(sourceText, {
    filename: sourcePath,
  });

  const scriptContent = descriptor.script?.content.trim() ?? "";
  const scriptSetupContent = descriptor.scriptSetup?.content.trim() ?? "";
  const combinedSource = [scriptContent, scriptSetupContent].filter(Boolean).join("\n\n");

  if (scriptSetupContent) {
    const setupSource = ts.createSourceFile(
      `${sourcePath}.vue.ts`,
      scriptSetupContent,
      ts.ScriptTarget.ES2024,
      true,
      ts.ScriptKind.TS,
    );
    const setupProps = findVueSetupProps(setupSource);
    if (setupProps?.kind === "type") {
      return createVirtualSource(
        sourcePath,
        `${combinedSource}\n\ndeclare function defineProps<T>(): T;\ndeclare function defineProps<T>(props: T): T;\ndeclare function withDefaults<T, D>(props: T, defaults: D): T;\n\nexport type ${EXTRACTED_PROPS_TYPE_NAME} = ${setupProps.typeText};\n`,
      );
    }
    if (setupProps?.kind === "runtime") {
      return createVirtualSource(
        sourcePath,
        `${combinedSource}\n\nimport type { ExtractPublicPropTypes } from "vue";\ndeclare function defineProps<T>(): T;\ndeclare function defineProps<T extends object>(props: T): ExtractPublicPropTypes<T>;\ndeclare function withDefaults<T, D>(props: T, defaults: D): T;\nconst __propsFuzzingOptions = (${setupProps.expressionText}) as const;\nexport type ${EXTRACTED_PROPS_TYPE_NAME} = ExtractPublicPropTypes<typeof __propsFuzzingOptions>;\n`,
      );
    }
  }

  if (scriptContent) {
    const runtimeSource = ts.createSourceFile(
      `${sourcePath}.vue.ts`,
      scriptContent,
      ts.ScriptTarget.ES2024,
      true,
      ts.ScriptKind.TS,
    );
    const runtimeProps = findVueRuntimeProps(runtimeSource);
    if (runtimeProps) {
      return createVirtualSource(
        sourcePath,
        `${scriptContent}\n\nimport type { ExtractPublicPropTypes } from "vue";\nconst __propsFuzzingOptions = (${runtimeProps}) as const;\nexport type ${EXTRACTED_PROPS_TYPE_NAME} = ExtractPublicPropTypes<typeof __propsFuzzingOptions>;\n`,
      );
    }
  }

  return undefined;
};

export const prepareFrameworkSource = (sourcePath: string): PreparedSource | undefined => {
  if (sourcePath.endsWith(".vue")) {
    return createVueVirtualSource(sourcePath);
  }
  if (sourcePath.endsWith(".svelte")) {
    return createSvelteVirtualSource(sourcePath);
  }
  return undefined;
};
