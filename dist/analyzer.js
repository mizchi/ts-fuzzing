import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const DEFAULT_CONFIG_OPTIONS = {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
};
const formatDiagnostics = (diagnostics) => {
    return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => "\n",
    });
};
const findNearestTsconfig = (startDir) => {
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
const parseConfig = (sourcePath) => {
    const tsconfigPath = findNearestTsconfig(path.dirname(sourcePath));
    if (!tsconfigPath) {
        return {
            fileNames: [sourcePath],
            options: DEFAULT_CONFIG_OPTIONS,
        };
    }
    const host = {
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
const resolveSymbol = (checker, symbol) => {
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
        return checker.getAliasedSymbol(symbol);
    }
    return symbol;
};
const isOptionalSymbol = (symbol) => {
    return (symbol.flags & ts.SymbolFlags.Optional) !== 0;
};
const extractConstraintsFromText = (text) => {
    const matches = text.matchAll(/@fuzz\.(\w+)\s+([^\s*]+)/g);
    const constraints = {};
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
const getConstraints = (declaration) => {
    if (!declaration) {
        return undefined;
    }
    const jsDocs = (declaration.jsDoc ?? [])
        .map((doc) => doc.getFullText())
        .join("\n");
    const commentText = jsDocs || "";
    return extractConstraintsFromText(commentText);
};
const mergeConstraints = (left, right) => {
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
const asTypeId = (type) => {
    return type.id ?? 0;
};
const mergeObjectDescriptors = (objects) => {
    const properties = new Map();
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
const isReactNodeType = (typeText) => {
    return (typeText === "ReactNode" ||
        typeText.endsWith(".ReactNode") ||
        typeText.includes("ReactNode"));
};
const describeType = (type, declaration, context) => {
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
    let descriptor;
    if (isReactNodeType(typeText)) {
        descriptor = { kind: "react-node" };
    }
    else if ((type.flags & ts.TypeFlags.StringLike) !== 0) {
        if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
            descriptor = {
                kind: "literal",
                value: type.value,
            };
        }
        else {
            descriptor = { kind: "string", constraints };
        }
    }
    else if ((type.flags & ts.TypeFlags.NumberLike) !== 0) {
        if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
            descriptor = {
                kind: "literal",
                value: type.value,
            };
        }
        else {
            descriptor = { kind: "number", integer: false, constraints };
        }
    }
    else if ((type.flags & ts.TypeFlags.BooleanLike) !== 0) {
        if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
            descriptor = {
                kind: "literal",
                value: typeText === "true",
            };
        }
        else {
            descriptor = { kind: "boolean" };
        }
    }
    else if ((type.flags & ts.TypeFlags.Null) !== 0) {
        descriptor = { kind: "null" };
    }
    else if ((type.flags & ts.TypeFlags.Undefined) !== 0) {
        descriptor = { kind: "undefined" };
    }
    else if ((type.flags & ts.TypeFlags.Any) !== 0 || (type.flags & ts.TypeFlags.Unknown) !== 0) {
        descriptor = { kind: "unknown" };
    }
    else if (type.isUnion()) {
        descriptor = {
            kind: "union",
            options: type.types.map((candidate) => describeType(candidate, declaration, context)),
        };
    }
    else if (type.isIntersection()) {
        const parts = type.types.map((candidate) => describeType(candidate, declaration, context));
        const objects = parts.filter((part) => part.kind === "object");
        descriptor =
            objects.length === parts.length ? mergeObjectDescriptors(objects) : { kind: "unknown" };
    }
    else if (context.checker.isTupleType(type)) {
        const tupleElements = type.typeArguments ?? [];
        descriptor = {
            kind: "tuple",
            items: tupleElements.map((candidate) => describeType(candidate, declaration, context)),
        };
    }
    else if (context.checker.isArrayType(type)) {
        const itemType = context.checker.getTypeArguments(type)[0];
        descriptor = {
            kind: "array",
            item: itemType ? describeType(itemType, declaration, context) : { kind: "unknown" },
            constraints,
        };
    }
    else if (type.getCallSignatures().length > 0) {
        descriptor = { kind: "function" };
    }
    else {
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
                    const filteredPropertyType = propertyIsOptional && propertyType.isUnion()
                        ? propertyType.types.filter((candidate) => (candidate.flags & ts.TypeFlags.Undefined) === 0)
                        : undefined;
                    return {
                        key: property.getName(),
                        optional: propertyIsOptional,
                        value: filteredPropertyType && filteredPropertyType.length > 1
                            ? {
                                kind: "union",
                                options: filteredPropertyType.map((candidate) => describeType(candidate, propertyDeclaration, context)),
                            }
                            : describeType(filteredPropertyType?.[0] ?? propertyType, propertyDeclaration, context),
                    };
                }),
            };
        }
        else if (typeText === "Date") {
            descriptor = { kind: "string", constraints: mergeConstraints(constraints, { pattern: ".+" }) };
        }
        else {
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
const findExportSymbol = (checker, sourceFile, exportName) => {
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
const findPropsType = (checker, sourceFile, options) => {
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
    const signature = componentType.getCallSignatures()[0];
    if (!signature) {
        throw new Error(`component is not callable: ${options.exportName}`);
    }
    const propsSymbol = signature.getParameters()[0];
    if (!propsSymbol) {
        return checker.getNeverType();
    }
    const propsDeclaration = propsSymbol.valueDeclaration ?? propsSymbol.getDeclarations()?.[0] ?? declaration;
    return checker.getTypeOfSymbolAtLocation(propsSymbol, propsDeclaration);
};
export const analyzePropsDescriptor = (options) => {
    const sourcePath = path.resolve(options.sourcePath);
    const { fileNames, options: compilerOptions } = parseConfig(sourcePath);
    const program = ts.createProgram({
        options: compilerOptions,
        rootNames: fileNames,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const hardErrors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    if (hardErrors.length > 0) {
        throw new Error(formatDiagnostics(hardErrors));
    }
    const sourceFile = program.getSourceFile(sourcePath);
    if (!sourceFile) {
        throw new Error(`source file not found: ${sourcePath}`);
    }
    const checker = program.getTypeChecker();
    const propsType = findPropsType(checker, sourceFile, options);
    return describeType(propsType, sourceFile, {
        checker,
        pending: new Set(),
        seen: new Map(),
    });
};
//# sourceMappingURL=analyzer.js.map