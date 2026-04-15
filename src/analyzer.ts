import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
  FuzzConstraints,
  ObjectDescriptor,
  PropertyDescriptor,
  TypeDescriptor,
} from "./descriptor.js";
import { prepareFrameworkSource } from "./framework_source.js";

type AnalyzeTypeOptions = {
  exportName?: string;
  typeName?: string;
  sourcePath: string;
};

type Context = {
  checker: ts.TypeChecker;
  pending: Set<number>;
  seen: Map<number, TypeDescriptor>;
  substitutions?: Map<number, ts.Type>;
  warnings: Set<string>;
};

export type AnalyzeTypeResult = {
  descriptor: TypeDescriptor;
  warnings: string[];
};

const DEFAULT_CONFIG_OPTIONS: ts.CompilerOptions = {
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2024,
};

const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[]) => {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  });
};

const findNearestTsconfig = (startDir: string): string | undefined => {
  let currentDir = startDir;
  for (;;) {
    const candidate = path.join(currentDir, "tsconfig.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
};

const parseConfig = (sourcePath: string) => {
  const tsconfigPath = findNearestTsconfig(path.dirname(sourcePath));
  if (!tsconfigPath) {
    return {
      fileNames: [sourcePath],
      options: DEFAULT_CONFIG_OPTIONS,
    };
  }

  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(formatDiagnostics([diagnostic]));
    },
  };

  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, host);
  if (!parsed) {
    throw new Error(`failed to parse tsconfig: ${tsconfigPath}`);
  }

  const fileNames = parsed.fileNames.includes(sourcePath)
    ? parsed.fileNames
    : [...parsed.fileNames, sourcePath];

  return {
    fileNames,
    options: {
      ...DEFAULT_CONFIG_OPTIONS,
      ...parsed.options,
    },
  };
};

const createProgram = (
  fileNames: string[],
  compilerOptions: ts.CompilerOptions,
  virtualFile:
    | {
        path: string;
        sourceText: string;
      }
    | undefined,
) => {
  if (!virtualFile) {
    return ts.createProgram({
      options: compilerOptions,
      rootNames: fileNames,
    });
  }

  const host = ts.createCompilerHost(compilerOptions, true);
  const normalizedVirtualPath = path.resolve(virtualFile.path);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);

  host.fileExists = (fileName) => {
    if (path.resolve(fileName) === normalizedVirtualPath) {
      return true;
    }
    return originalFileExists(fileName);
  };

  host.readFile = (fileName) => {
    if (path.resolve(fileName) === normalizedVirtualPath) {
      return virtualFile.sourceText;
    }
    return originalReadFile(fileName);
  };

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (path.resolve(fileName) === normalizedVirtualPath) {
      return ts.createSourceFile(fileName, virtualFile.sourceText, languageVersion, true, ts.ScriptKind.TS);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  return ts.createProgram({
    host,
    options: compilerOptions,
    rootNames: fileNames,
  });
};

const resolveSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol) => {
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    return checker.getAliasedSymbol(symbol);
  }
  return symbol;
};

const isOptionalSymbol = (symbol: ts.Symbol) => {
  return (symbol.flags & ts.SymbolFlags.Optional) !== 0;
};

const extractConstraintsFromText = (text: string): FuzzConstraints | undefined => {
  const matches = text.matchAll(/@fuzz\.(\w+)\s+([^\s*]+)/g);
  const constraints: FuzzConstraints = {};
  for (const match of matches) {
    const key = match[1];
    const value = match[2];
    switch (key) {
      case "min":
      case "max":
      case "minItems":
      case "maxItems":
      case "minLength":
      case "maxLength": {
        constraints[key] = Number(value);
        break;
      }
      case "pattern": {
        constraints.pattern = value;
        break;
      }
      default: {
        break;
      }
    }
  }
  return Object.keys(constraints).length > 0 ? constraints : undefined;
};

const getConstraints = (node: ts.Node | undefined): FuzzConstraints | undefined => {
  if (!node) {
    return undefined;
  }
  const jsDocs = ((node as ts.Node & { jsDoc?: ts.JSDoc[] }).jsDoc ?? [])
    .map((doc) => doc.getFullText())
    .join("\n");
  const commentText = jsDocs || "";
  return extractConstraintsFromText(commentText);
};

const mergeConstraints = (
  left: FuzzConstraints | undefined,
  right: FuzzConstraints | undefined,
): FuzzConstraints | undefined => {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return {
    ...left,
    ...right,
  };
};

const asTypeId = (type: ts.Type) => {
  return (type as ts.Type & { id?: number }).id ?? 0;
};

const mergeObjectDescriptors = (objects: ObjectDescriptor[]): ObjectDescriptor => {
  const properties = new Map<string, PropertyDescriptor>();
  for (const object of objects) {
    for (const property of object.properties) {
      const current = properties.get(property.key);
      if (!current) {
        properties.set(property.key, property);
        continue;
      }
      properties.set(property.key, {
        key: property.key,
        optional: current.optional && property.optional,
        value: property.value,
      });
    }
  }
  return {
    kind: "object",
    properties: [...properties.values()],
  };
};

const isReactNodeType = (typeText: string) => {
  return (
    typeText === "ReactNode" ||
    typeText.endsWith(".ReactNode") ||
    typeText.includes("ReactNode") ||
    typeText.includes("AwaitedReactNode") ||
    typeText.includes("ReactPortal") ||
    (typeText.includes("ReactElement") && typeText.includes("JSXElementConstructor"))
  );
};

const getTypeSymbolName = (type: ts.Type) => {
  const aliasSymbol = (type as ts.Type & { aliasSymbol?: ts.Symbol }).aliasSymbol;
  return aliasSymbol?.getName() ?? type.symbol?.getName();
};

const warnGenericFallback = (
  context: Context,
  typeName: string,
  reason: "unconstrained" | "nongeneralizable",
  constraintText?: string,
) => {
  if (reason === "unconstrained") {
    context.warnings.add(
      `[ts-fuzzing] generic type parameter "${typeName}" is unconstrained; falling back to unknown values`,
    );
    return;
  }
  context.warnings.add(
    constraintText
      ? `[ts-fuzzing] generic type parameter "${typeName}" could not be generalized from constraint "${constraintText}"; falling back to unknown values`
      : `[ts-fuzzing] generic type parameter "${typeName}" could not be generalized; falling back to unknown values`,
  );
};

const warnConditionalFallback = (
  context: Context,
  typeName: string,
  reason:
    | "unconstrained"
    | "unsupported-infer"
    | "unsupported-check"
    | "unsupported-extends"
    | "nongeneralizable",
) => {
  switch (reason) {
    case "unconstrained":
      context.warnings.add(
        `[ts-fuzzing] conditional type "${typeName}" could not be generalized because its checked type is unconstrained; falling back to unknown values`,
      );
      return;
    case "unsupported-infer":
      context.warnings.add(
        `[ts-fuzzing] conditional type "${typeName}" uses infer and cannot be generalized safely; falling back to unknown values`,
      );
      return;
    case "unsupported-check":
      context.warnings.add(
        `[ts-fuzzing] conditional type "${typeName}" could not be generalized from its checked type; falling back to unknown values`,
      );
      return;
    case "unsupported-extends":
      context.warnings.add(
        `[ts-fuzzing] conditional type "${typeName}" could not be generalized from its extends clause; falling back to unknown values`,
      );
      return;
    case "nongeneralizable":
      context.warnings.add(
        `[ts-fuzzing] conditional type "${typeName}" could not be generalized from its branches; falling back to unknown values`,
      );
      return;
  }
};

const hasTypeSubstitutions = (context: Context) =>
  Boolean(context.substitutions && context.substitutions.size > 0);

const withSubstitutions = (
  context: Context,
  entries: Array<[number, ts.Type]>,
): Context => {
  const substitutions = new Map(context.substitutions ?? []);
  for (const [typeId, type] of entries) {
    substitutions.set(typeId, type);
  }
  return {
    checker: context.checker,
    pending: new Set<number>(),
    seen: new Map<number, TypeDescriptor>(),
    substitutions,
    warnings: context.warnings,
  };
};

const resolveTypeSubstitution = (type: ts.Type, context: Context): ts.Type | undefined => {
  if (!context.substitutions || context.substitutions.size === 0) {
    return undefined;
  }

  const direct = context.substitutions.get(asTypeId(type));
  if (direct) {
    return direct;
  }

  const baseType = (type as ts.Type & { baseType?: ts.Type }).baseType;
  if (baseType) {
    const mapped = context.substitutions.get(asTypeId(baseType));
    if (mapped) {
      return mapped;
    }
  }

  return undefined;
};

type ExtractedFuzzMarker = {
  name: string;
  tag: string;
  value: string | number | boolean | undefined;
};

const warnFuzzMarker = (context: Context, message: string) => {
  context.warnings.add(`[ts-fuzzing] ${message}`);
};

const isTsFuzzingMarkerDeclaration = (declaration: ts.Declaration | undefined) => {
  const namedDeclaration = declaration as ts.NamedDeclaration | undefined;
  const name = namedDeclaration?.name;
  if (!name) {
    return false;
  }
  return (
    ts.isComputedPropertyName(name) &&
    ts.isIdentifier(name.expression) &&
    name.expression.text === "TS_FUZZING_HINT"
  );
};

const literalValueFromType = (
  type: ts.Type,
  declaration: ts.Node | undefined,
  checker: ts.TypeChecker,
) => {
  if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
    return (type as ts.StringLiteralType).value;
  }
  if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
    return (type as ts.NumberLiteralType).value;
  }
  if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
    return checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation) === "true";
  }
  return undefined;
};

const stripUndefinedFromOptionalType = (type: ts.Type) => {
  if (!type.isUnion()) {
    return type;
  }
  const filtered = type.types.filter(
    (candidate) => (candidate.flags & ts.TypeFlags.Undefined) === 0,
  );
  return filtered.length === 1 ? filtered[0] : type;
};

const extractTsFuzzingMarker = (
  type: ts.Type,
  declaration: ts.Node | undefined,
  context: Context,
): ExtractedFuzzMarker | undefined => {
  for (const property of context.checker.getPropertiesOfType(type)) {
    const propertyDeclaration = property.valueDeclaration ?? property.getDeclarations()?.[0];
    if (!isTsFuzzingMarkerDeclaration(propertyDeclaration)) {
      continue;
    }

    const propertyType = stripUndefinedFromOptionalType(context.checker.getTypeOfSymbolAtLocation(
      property,
      propertyDeclaration ?? declaration ?? propertyDeclaration!,
    ));
    const tagSymbol = propertyType.getProperty("tag");
    const valueSymbol = propertyType.getProperty("value");
    if (!tagSymbol) {
      continue;
    }

    const tagDeclaration = tagSymbol.valueDeclaration ?? tagSymbol.getDeclarations()?.[0];
    const tagType = context.checker.getTypeOfSymbolAtLocation(
      tagSymbol,
      tagDeclaration ?? propertyDeclaration ?? declaration ?? propertyDeclaration!,
    );
    const tagValue = literalValueFromType(
      tagType,
      tagDeclaration ?? propertyDeclaration,
      context.checker,
    );
    if (typeof tagValue !== "string") {
      continue;
    }

    const valueDeclaration = valueSymbol?.valueDeclaration ?? valueSymbol?.getDeclarations()?.[0];
    const valueType =
      valueSymbol &&
      context.checker.getTypeOfSymbolAtLocation(
        valueSymbol,
        valueDeclaration ?? propertyDeclaration ?? declaration ?? propertyDeclaration!,
      );

    return {
      name: (type as ts.Type & { aliasSymbol?: ts.Symbol }).aliasSymbol?.getName() ?? type.symbol?.getName() ?? tagValue,
      tag: tagValue,
      value:
        valueType && valueSymbol
          ? literalValueFromType(valueType, valueDeclaration ?? propertyDeclaration, context.checker)
          : undefined,
    };
  }

  return undefined;
};

const markerBaseKind = (marker: ExtractedFuzzMarker) => {
  switch (marker.tag) {
    case "pattern":
    case "minLength":
    case "maxLength":
      return "string";
    case "int":
    case "float":
    case "min":
    case "max":
      return "number";
    case "minItems":
    case "maxItems":
      return "array";
    default:
      return undefined;
  }
};

const inferDescriptorFromMarkers = (
  markers: ExtractedFuzzMarker[],
  context: Context,
): TypeDescriptor => {
  const baseKinds = [...new Set(markers.map(markerBaseKind).filter(Boolean))];
  if (baseKinds.length !== 1) {
    warnFuzzMarker(
      context,
      `fuzz markers "${markers.map((marker) => marker.name).join(", ")}" require incompatible base types; falling back to unknown values`,
    );
    return { kind: "unknown" };
  }

  switch (baseKinds[0]) {
    case "string":
      return { kind: "string" };
    case "number":
      return { kind: "number", integer: false };
    case "array":
      return { kind: "array", item: { kind: "unknown" } };
    default:
      return { kind: "unknown" };
  }
};

const withConstraint = (
  descriptor: TypeDescriptor,
  nextConstraints: FuzzConstraints,
): TypeDescriptor => {
  if (descriptor.kind === "string" || descriptor.kind === "number" || descriptor.kind === "array") {
    return {
      ...descriptor,
      constraints: mergeConstraints(descriptor.constraints, nextConstraints),
    };
  }
  return descriptor;
};

const applyMarkerToDescriptor = (
  descriptor: TypeDescriptor,
  marker: ExtractedFuzzMarker,
  context: Context,
): TypeDescriptor => {
  switch (marker.tag) {
    case "pattern":
      if (descriptor.kind !== "string" || typeof marker.value !== "string") {
        break;
      }
      return withConstraint(descriptor, { pattern: marker.value });
    case "int":
      if (descriptor.kind !== "number") {
        break;
      }
      return {
        ...descriptor,
        integer: true,
      };
    case "float":
      if (descriptor.kind !== "number") {
        break;
      }
      return {
        ...descriptor,
        integer: false,
      };
    case "min":
      if (descriptor.kind !== "number" || typeof marker.value !== "number") {
        break;
      }
      return withConstraint(descriptor, { min: marker.value });
    case "max":
      if (descriptor.kind !== "number" || typeof marker.value !== "number") {
        break;
      }
      return withConstraint(descriptor, { max: marker.value });
    case "minLength":
      if (descriptor.kind !== "string" || typeof marker.value !== "number") {
        break;
      }
      return withConstraint(descriptor, { minLength: marker.value });
    case "maxLength":
      if (descriptor.kind !== "string" || typeof marker.value !== "number") {
        break;
      }
      return withConstraint(descriptor, { maxLength: marker.value });
    case "minItems":
      if (descriptor.kind !== "array" || typeof marker.value !== "number") {
        break;
      }
      return withConstraint(descriptor, { minItems: marker.value });
    case "maxItems":
      if (descriptor.kind !== "array" || typeof marker.value !== "number") {
        break;
      }
      return withConstraint(descriptor, { maxItems: marker.value });
    default:
      warnFuzzMarker(context, `unknown fuzz marker "${marker.tag}" on "${marker.name}" was ignored`);
      return descriptor;
  }

  warnFuzzMarker(
    context,
    `fuzz marker "${marker.name}" is incompatible with base type "${descriptor.kind}"; falling back to unknown values`,
  );
  return { kind: "unknown" };
};

const applyMarkersToDescriptor = (
  descriptor: TypeDescriptor,
  markers: ExtractedFuzzMarker[],
  context: Context,
): TypeDescriptor => {
  let current = descriptor;
  for (const marker of markers) {
    current = applyMarkerToDescriptor(current, marker, context);
    if (current.kind === "unknown") {
      return current;
    }
  }
  return current;
};

type ConditionalTypeRoot = {
  checkType?: ts.Type;
  extendsType?: ts.Type;
  inferTypeParameters?: ts.Type[];
  isDistributive?: boolean;
  node?: ts.ConditionalTypeNode;
};

type InternalConditionalType = ts.Type & {
  root?: ConditionalTypeRoot;
  checkType?: ts.Type;
  extendsType?: ts.Type;
};

const describeConditionalType = (
  type: InternalConditionalType,
  declaration: ts.Node | undefined,
  context: Context,
): TypeDescriptor => {
  const typeName = type.aliasSymbol?.getName() ?? context.checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation);
  const root = type.root;
  if (!root?.node) {
    warnConditionalFallback(context, typeName, "nongeneralizable");
    return { kind: "unknown" };
  }

  if (root.inferTypeParameters && root.inferTypeParameters.length > 0) {
    warnConditionalFallback(context, typeName, "unsupported-infer");
    return { kind: "unknown" };
  }

  const checkType = root.checkType ?? type.checkType;
  const extendsType = root.extendsType ?? type.extendsType;
  if (!checkType || !extendsType) {
    warnConditionalFallback(context, typeName, "nongeneralizable");
    return { kind: "unknown" };
  }

  const constraint = context.checker.getBaseConstraintOfType(checkType);
  if (
    !constraint ||
    constraint === checkType ||
    (constraint.flags & ts.TypeFlags.Any) !== 0 ||
    (constraint.flags & ts.TypeFlags.Unknown) !== 0
  ) {
    warnConditionalFallback(context, typeName, "unconstrained");
    return { kind: "unknown" };
  }

  const branchCandidates =
    root.isDistributive && constraint.isUnion() ? constraint.types : [constraint];
  const conditionalSymbolId = asTypeId(checkType);
  const descriptors = branchCandidates.map((candidate) => {
    const branchNode = context.checker.isTypeAssignableTo(candidate, extendsType)
      ? root.node!.trueType
      : root.node!.falseType;
    const branchType = context.checker.getTypeFromTypeNode(branchNode);
    const branchContext = withSubstitutions(context, [[conditionalSymbolId, candidate]]);
    return describeType(branchType, branchNode, branchContext);
  });

  const knownDescriptors = descriptors.filter((descriptor) => descriptor.kind !== "unknown");
  if (knownDescriptors.length === 0) {
    warnConditionalFallback(context, typeName, "nongeneralizable");
    return { kind: "unknown" };
  }

  if (knownDescriptors.length === 1) {
    return knownDescriptors[0];
  }

  return {
    kind: "union",
    options: knownDescriptors,
  };
};

const describeIntersectionType = (
  type: ts.IntersectionType,
  declaration: ts.Node | undefined,
  context: Context,
): TypeDescriptor => {
  const markers: ExtractedFuzzMarker[] = [];
  const nonMarkerTypes: ts.Type[] = [];

  for (const candidate of type.types) {
    const marker = extractTsFuzzingMarker(candidate, declaration, context);
    if (marker) {
      markers.push(marker);
      continue;
    }
    nonMarkerTypes.push(candidate);
  }

  if (markers.length === 0) {
    const parts = type.types.map((candidate) => describeType(candidate, declaration, context));
    const objects = parts.filter((part): part is ObjectDescriptor => part.kind === "object");
    return objects.length === parts.length
      ? mergeObjectDescriptors(objects)
      : parts.length === 1
      ? parts[0]
      : { kind: "unknown" };
  }

  let baseDescriptor: TypeDescriptor;
  if (nonMarkerTypes.length === 0) {
    warnFuzzMarker(
      context,
      `fuzz marker "${markers.map((marker) => marker.name).join(" & ")}" should be intersected with an explicit base type like string & UUID; inferring a base descriptor for fuzzing`,
    );
    baseDescriptor = inferDescriptorFromMarkers(markers, context);
  } else if (nonMarkerTypes.length === 1) {
    baseDescriptor = describeType(nonMarkerTypes[0], declaration, context);
  } else {
    const parts = nonMarkerTypes.map((candidate) => describeType(candidate, declaration, context));
    const objects = parts.filter((part): part is ObjectDescriptor => part.kind === "object");
    baseDescriptor =
      objects.length === parts.length ? mergeObjectDescriptors(objects) : { kind: "unknown" };
  }

  return applyMarkersToDescriptor(baseDescriptor, markers, context);
};

const describeType = (
  type: ts.Type,
  declaration: ts.Node | undefined,
  context: Context,
): TypeDescriptor => {
  const substituted = resolveTypeSubstitution(type, context);
  if (substituted) {
    return describeType(substituted, declaration, context);
  }

  const typeId = asTypeId(type);
  const constraints = getConstraints(declaration);
  const hasLocalConstraints = Boolean(constraints && Object.keys(constraints).length > 0);
  const useCache = !hasLocalConstraints && !hasTypeSubstitutions(context);
  const cached = useCache ? context.seen.get(typeId) : undefined;
  if (cached && !hasLocalConstraints) {
    return cached;
  }

  if (typeId !== 0 && context.pending.has(typeId) && useCache) {
    return { kind: "unknown" };
  }

  if (typeId !== 0 && useCache) {
    context.pending.add(typeId);
  }

  const typeText = context.checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation);
  const typeSymbolName = getTypeSymbolName(type);
  let descriptor: TypeDescriptor;

  if (isReactNodeType(typeText) || typeSymbolName === "ReactNode") {
    descriptor = { kind: "react-node" };
  } else if (typeSymbolName === "URL" || typeText === "URL") {
    descriptor = { kind: "url" };
  } else if (typeSymbolName === "Map" || typeSymbolName === "ReadonlyMap") {
    const [keyType, valueType] = context.checker.getTypeArguments(type as ts.TypeReference);
    descriptor = {
      kind: "map",
      key: keyType ? describeType(keyType, declaration, context) : { kind: "unknown" },
      value: valueType ? describeType(valueType, declaration, context) : { kind: "unknown" },
    };
  } else if (typeSymbolName === "Set" || typeSymbolName === "ReadonlySet") {
    const [itemType] = context.checker.getTypeArguments(type as ts.TypeReference);
    descriptor = {
      kind: "set",
      item: itemType ? describeType(itemType, declaration, context) : { kind: "unknown" },
    };
  } else if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    const typeName = type.symbol?.getName() ?? typeText;
    const constraint = context.checker.getBaseConstraintOfType(type);
    if (
      !constraint ||
      constraint === type ||
      (constraint.flags & ts.TypeFlags.Any) !== 0 ||
      (constraint.flags & ts.TypeFlags.Unknown) !== 0
    ) {
      warnGenericFallback(context, typeName, "unconstrained");
      descriptor = { kind: "unknown" };
    } else {
      descriptor = describeType(constraint, declaration, context);
      if (descriptor.kind === "unknown") {
        warnGenericFallback(context, typeName, "nongeneralizable", context.checker.typeToString(constraint, declaration, ts.TypeFormatFlags.NoTruncation));
      }
    }
  } else if ((type.flags & ts.TypeFlags.StringLike) !== 0) {
    if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
      descriptor = {
        kind: "literal",
        value: (type as ts.StringLiteralType).value,
      };
    } else {
      descriptor = { kind: "string", constraints };
    }
  } else if ((type.flags & ts.TypeFlags.NumberLike) !== 0) {
    if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
      descriptor = {
        kind: "literal",
        value: (type as ts.NumberLiteralType).value,
      };
    } else {
      descriptor = { kind: "number", integer: false, constraints };
    }
  } else if ((type.flags & ts.TypeFlags.BooleanLike) !== 0) {
    if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
      descriptor = {
        kind: "literal",
        value: typeText === "true",
      };
    } else {
      descriptor = { kind: "boolean" };
    }
  } else if ((type.flags & ts.TypeFlags.Null) !== 0) {
    descriptor = { kind: "null" };
  } else if ((type.flags & ts.TypeFlags.Undefined) !== 0) {
    descriptor = { kind: "undefined" };
  } else if ((type.flags & ts.TypeFlags.Any) !== 0 || (type.flags & ts.TypeFlags.Unknown) !== 0) {
    descriptor = { kind: "unknown" };
  } else if ((type.flags & ts.TypeFlags.Conditional) !== 0) {
    descriptor = describeConditionalType(type as InternalConditionalType, declaration, context);
  } else if (type.isUnion()) {
    descriptor = {
      kind: "union",
      options: type.types.map((candidate) => describeType(candidate, declaration, context)),
    };
  } else if (type.isIntersection()) {
    descriptor = describeIntersectionType(type, declaration, context);
  } else if (context.checker.isTupleType(type)) {
    const tupleElements = (type as ts.TupleTypeReference).typeArguments ?? [];
    descriptor = {
      kind: "tuple",
      items: tupleElements.map((candidate) => describeType(candidate, declaration, context)),
    };
  } else if (context.checker.isArrayType(type)) {
    const itemType = context.checker.getTypeArguments(type as ts.TypeReference)[0];
    descriptor = {
      kind: "array",
      item: itemType ? describeType(itemType, declaration, context) : { kind: "unknown" },
      constraints,
    };
  } else if (extractTsFuzzingMarker(type, declaration, context)) {
    const marker = extractTsFuzzingMarker(type, declaration, context)!;
    warnFuzzMarker(
      context,
      `fuzz marker "${marker.name}" should be intersected with an explicit base type like string & UUID; inferring a base descriptor for fuzzing`,
    );
    descriptor = applyMarkersToDescriptor(
      inferDescriptorFromMarkers([marker], context),
      [marker],
      context,
    );
  } else if (type.getCallSignatures().length > 0) {
    descriptor = { kind: "function" };
  } else {
    const properties = context.checker.getPropertiesOfType(type);
    if (properties.length > 0) {
      descriptor = {
        kind: "object",
        properties: properties.map((property) => {
          const propertyDeclaration = property.valueDeclaration ?? property.getDeclarations()?.[0];
          const location = propertyDeclaration ?? declaration;
          if (!location) {
            return {
              key: property.getName(),
              optional: isOptionalSymbol(property),
              value: { kind: "unknown" },
            };
          }
          const propertyType = context.checker.getTypeOfSymbolAtLocation(property, location);
          const propertyIsOptional = isOptionalSymbol(property);
          const propertyTypeText = context.checker.typeToString(
            propertyType,
            propertyDeclaration,
            ts.TypeFormatFlags.NoTruncation,
          );
          const preserveWholeType =
            propertyIsOptional &&
            (isReactNodeType(propertyTypeText) || getTypeSymbolName(propertyType) === "ReactNode");
          const filteredPropertyType =
            propertyIsOptional && propertyType.isUnion() && !preserveWholeType
              ? propertyType.types.filter(
                  (candidate) => (candidate.flags & ts.TypeFlags.Undefined) === 0,
                )
              : undefined;
          return {
            key: property.getName(),
            optional: propertyIsOptional,
            value:
              preserveWholeType
                ? describeType(propertyType, propertyDeclaration, context)
                : filteredPropertyType && filteredPropertyType.length > 1
                ? {
                    kind: "union",
                    options: filteredPropertyType.map((candidate) =>
                      describeType(candidate, propertyDeclaration, context),
                    ),
                  }
                : describeType(
                    filteredPropertyType?.[0] ?? propertyType,
                    propertyDeclaration,
                    context,
                  ),
          };
        }),
      };
    } else if (typeText === "Date") {
      descriptor = { kind: "string", constraints: mergeConstraints(constraints, { pattern: ".+" }) };
    } else {
      descriptor = { kind: "unknown" };
    }
  }

  if (descriptor.kind === "string" && constraints) {
    descriptor = {
      ...descriptor,
      constraints: mergeConstraints(descriptor.constraints, constraints),
    };
  }
  if (descriptor.kind === "number" && constraints) {
    descriptor = {
      ...descriptor,
      constraints: mergeConstraints(descriptor.constraints, constraints),
    };
  }
  if (descriptor.kind === "array" && constraints) {
    descriptor = {
      ...descriptor,
      constraints: mergeConstraints(descriptor.constraints, constraints),
    };
  }

  if (typeId !== 0 && useCache) {
    context.pending.delete(typeId);
    context.seen.set(typeId, descriptor);
  }
  return descriptor;
};

const findExportSymbol = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  exportName: string,
) => {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error(`module symbol not found: ${sourceFile.fileName}`);
  }
  const exports = checker.getExportsOfModule(moduleSymbol);
  const symbol = exports.find((candidate) => candidate.getName() === exportName);
  if (!symbol) {
    throw new Error(`export not found: ${exportName}`);
  }
  return resolveSymbol(checker, symbol);
};

const findTargetType = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  options: AnalyzeTypeOptions,
) => {
  if (options.typeName) {
    const typeSymbol = findExportSymbol(checker, sourceFile, options.typeName);
    return checker.getDeclaredTypeOfSymbol(typeSymbol);
  }

  if (!options.exportName) {
    throw new Error("exportName or typeName is required");
  }

  const componentSymbol = findExportSymbol(checker, sourceFile, options.exportName);
  const declaration = componentSymbol.valueDeclaration ?? componentSymbol.getDeclarations()?.[0];
  if (!declaration) {
    throw new Error(`declaration not found: ${options.exportName}`);
  }

  const componentType = checker.getTypeOfSymbolAtLocation(componentSymbol, declaration);
  const callSignature = componentType.getCallSignatures()[0];
  const callPropsSymbol = callSignature?.getParameters()[0];
  if (callPropsSymbol) {
    const propsDeclaration =
      callPropsSymbol.valueDeclaration ?? callPropsSymbol.getDeclarations()?.[0] ?? declaration;
    return checker.getTypeOfSymbolAtLocation(callPropsSymbol, propsDeclaration);
  }

  const directPropsSymbol = componentType.getProperty("$props");
  if (directPropsSymbol) {
    const propsDeclaration =
      directPropsSymbol.valueDeclaration ?? directPropsSymbol.getDeclarations()?.[0] ?? declaration;
    return checker.getTypeOfSymbolAtLocation(directPropsSymbol, propsDeclaration);
  }

  const constructSignature = componentType.getConstructSignatures()[0];
  if (constructSignature) {
    const instanceType = constructSignature.getReturnType();
    const instancePropsSymbol = instanceType.getProperty("$props");
    if (instancePropsSymbol) {
      const propsDeclaration =
        instancePropsSymbol.valueDeclaration ??
        instancePropsSymbol.getDeclarations()?.[0] ??
        declaration;
      return checker.getTypeOfSymbolAtLocation(instancePropsSymbol, propsDeclaration);
    }

    const constructorOptionsSymbol = constructSignature.getParameters()[0];
    if (constructorOptionsSymbol) {
      const optionsDeclaration =
        constructorOptionsSymbol.valueDeclaration ??
        constructorOptionsSymbol.getDeclarations()?.[0] ??
        declaration;
      const constructorOptionsType = checker.getTypeOfSymbolAtLocation(
        constructorOptionsSymbol,
        optionsDeclaration,
      );
      const propsSymbol = constructorOptionsType.getProperty("props");
      if (propsSymbol) {
        const propsDeclaration =
          propsSymbol.valueDeclaration ?? propsSymbol.getDeclarations()?.[0] ?? optionsDeclaration;
        return checker.getTypeOfSymbolAtLocation(propsSymbol, propsDeclaration);
      }
    }
  }

  if (callSignature && !callPropsSymbol) {
    return checker.getNeverType();
  }

  throw new Error(
    `type could not be inferred from export: ${options.exportName}. pass typeName for non-callable exports`,
  );
};

export const analyzeTypeInfo = (options: AnalyzeTypeOptions): AnalyzeTypeResult => {
  const sourcePath = path.resolve(options.sourcePath);
  const preparedSource = prepareFrameworkSource(sourcePath);
  const programSourcePath = preparedSource?.virtualPath ?? sourcePath;
  const { fileNames, options: compilerOptions } = parseConfig(programSourcePath);
  const rootNames = fileNames.includes(programSourcePath)
    ? fileNames
    : [...fileNames, programSourcePath];
  const program = createProgram(rootNames, compilerOptions, preparedSource?.virtualPath && preparedSource.virtualSourceText
    ? {
        path: preparedSource.virtualPath,
        sourceText: preparedSource.virtualSourceText,
      }
    : undefined);

  const diagnostics = ts.getPreEmitDiagnostics(program);
  const hardErrors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (hardErrors.length > 0) {
    throw new Error(formatDiagnostics(hardErrors));
  }

  const sourceFile = program.getSourceFile(programSourcePath);
  if (!sourceFile) {
    throw new Error(`source file not found: ${programSourcePath}`);
  }

  const checker = program.getTypeChecker();
  const targetType = findTargetType(checker, sourceFile, {
    ...options,
    typeName: preparedSource?.typeName ?? options.typeName,
    sourcePath: programSourcePath,
  });
  const context: Context = {
    checker,
    pending: new Set<number>(),
    seen: new Map<number, TypeDescriptor>(),
    warnings: new Set<string>(),
  };
  return {
    descriptor: describeType(targetType, sourceFile, context),
    warnings: [...context.warnings],
  };
};

export const analyzeTypeDescriptor = (options: AnalyzeTypeOptions): TypeDescriptor => {
  return analyzeTypeInfo(options).descriptor;
};

export const analyzePropsDescriptor = (options: {
  exportName?: string;
  typeName?: string;
  sourcePath: string;
}): TypeDescriptor => {
  try {
    return analyzeTypeDescriptor({
      exportName: options.exportName,
      typeName: options.typeName,
      sourcePath: options.sourcePath,
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    throw new Error(
      error.message
        .replace("exportName or typeName is required", "exportName or typeName is required")
        .replace(
          /^type could not be inferred from export: (.+)\. pass typeName for non-callable exports$/,
          "component input type could not be inferred: $1. pass typeName for non-callable exports",
        ),
      { cause: error.cause },
    );
  }
};

export const analyzeTypeWarnings = (options: AnalyzeTypeOptions): string[] => {
  return analyzeTypeInfo(options).warnings;
};
