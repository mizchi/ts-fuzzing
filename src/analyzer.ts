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

type AnalyzeOptions = {
  exportName?: string;
  propsTypeName?: string;
  sourcePath: string;
};

type Context = {
  checker: ts.TypeChecker;
  pending: Set<number>;
  seen: Map<number, TypeDescriptor>;
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

const getConstraints = (declaration: ts.Declaration | undefined): FuzzConstraints | undefined => {
  if (!declaration) {
    return undefined;
  }
  const jsDocs = ((declaration as ts.Node & { jsDoc?: ts.JSDoc[] }).jsDoc ?? [])
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
    typeText.includes("ReactNode")
  );
};

const describeType = (
  type: ts.Type,
  declaration: ts.Declaration | undefined,
  context: Context,
): TypeDescriptor => {
  const typeId = asTypeId(type);
  const constraints = getConstraints(declaration);
  const hasLocalConstraints = Boolean(constraints && Object.keys(constraints).length > 0);
  const cached = context.seen.get(typeId);
  if (cached && !hasLocalConstraints) {
    return cached;
  }

  if (typeId !== 0 && context.pending.has(typeId) && !hasLocalConstraints) {
    return { kind: "unknown" };
  }

  if (typeId !== 0 && !hasLocalConstraints) {
    context.pending.add(typeId);
  }

  const typeText = context.checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation);
  let descriptor: TypeDescriptor;

  if (isReactNodeType(typeText)) {
    descriptor = { kind: "react-node" };
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
  } else if (type.isUnion()) {
    descriptor = {
      kind: "union",
      options: type.types.map((candidate) => describeType(candidate, declaration, context)),
    };
  } else if (type.isIntersection()) {
    const parts = type.types.map((candidate) => describeType(candidate, declaration, context));
    const objects = parts.filter((part): part is ObjectDescriptor => part.kind === "object");
    descriptor =
      objects.length === parts.length ? mergeObjectDescriptors(objects) : { kind: "unknown" };
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
          const filteredPropertyType =
            propertyIsOptional && propertyType.isUnion()
              ? propertyType.types.filter(
                  (candidate) => (candidate.flags & ts.TypeFlags.Undefined) === 0,
                )
              : undefined;
          return {
            key: property.getName(),
            optional: propertyIsOptional,
            value:
              filteredPropertyType && filteredPropertyType.length > 1
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

  if (typeId !== 0 && !hasLocalConstraints) {
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

const findPropsType = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  options: AnalyzeOptions,
) => {
  if (options.propsTypeName) {
    const typeSymbol = findExportSymbol(checker, sourceFile, options.propsTypeName);
    return checker.getDeclaredTypeOfSymbol(typeSymbol);
  }

  if (!options.exportName) {
    throw new Error("exportName or propsTypeName is required");
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
    `component props could not be inferred: ${options.exportName}. pass propsTypeName for non-React components`,
  );
};

export const analyzePropsDescriptor = (options: AnalyzeOptions): TypeDescriptor => {
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
  const propsType = findPropsType(checker, sourceFile, {
    ...options,
    propsTypeName: preparedSource?.propsTypeName ?? options.propsTypeName,
    sourcePath: programSourcePath,
  });
  return describeType(propsType, sourceFile, {
    checker,
    pending: new Set<number>(),
    seen: new Map<number, TypeDescriptor>(),
  });
};
