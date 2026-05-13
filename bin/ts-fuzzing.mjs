#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const usage = `Usage: ts-fuzzing <command> [options]

Commands:
  replay [error.json]    Replay a previously failing seed against its target.

Replay options:
  --seed <n>             Seed to replay (required unless error.json provided).
  --source <path>        Path to the .ts file that declares the input type.
  --type <name>          Name of the exported type to use as the input shape.
  --runner <path>        Path to the runner module to execute per iteration.
  --symbol <name>        Named export of the runner module to call (default: "run").
  --num-runs <n>         Number of iterations to replay (default: 100).
  --stop-on-first        Stop at the first failure instead of running every iteration.
  --json                 Print the report as JSON instead of human-readable text.

The optional error.json file may contain { seed, sourcePath, typeName, value, runner, symbol }.
Command-line flags override values from the file.
`;

const parseArgs = (argv) => {
  const args = { positional: [], stopOnFirstFailure: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--seed":
        args.seed = Number(argv[++index]);
        break;
      case "--source":
        args.sourcePath = argv[++index];
        break;
      case "--type":
        args.typeName = argv[++index];
        break;
      case "--runner":
        args.runner = argv[++index];
        break;
      case "--symbol":
        args.symbol = argv[++index];
        break;
      case "--num-runs":
        args.numRuns = Number(argv[++index]);
        break;
      case "--stop-on-first":
        args.stopOnFirstFailure = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (token.startsWith("--")) {
          throw new Error(`unknown flag: ${token}`);
        }
        args.positional.push(token);
        break;
    }
  }
  return args;
};

const importModule = async (specifier) => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const absolute = path.resolve(process.cwd(), specifier);
    return import(pathToFileURL(absolute).href);
  }
  return import(specifier);
};

const resolveRunner = async (runnerPath, symbol) => {
  const module = await importModule(runnerPath);
  const exportName = symbol ?? "run";
  const candidate = module[exportName];
  if (typeof candidate === "function") {
    return candidate;
  }
  if (typeof module.default === "function") {
    return module.default;
  }
  throw new Error(`runner module ${runnerPath} has no callable export "${exportName}" or default`);
};

const loadErrorFile = (filePath) => {
  const absolute = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(absolute, "utf8");
  return JSON.parse(raw);
};

const formatTrace = (report) => {
  const lines = [];
  lines.push(`seed=${report.seed}  iterations=${report.iterations.length}  failures=${report.failures.length}`);
  for (const failure of report.failures) {
    lines.push(`  [#${failure.iteration}] FAIL  value=${JSON.stringify(failure.value)}`);
    if (failure.cause) {
      const message = failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
      lines.push(`           cause=${message}`);
    }
  }
  return lines.join("\n");
};

const main = async () => {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "-h" || command === "--help") {
    process.stdout.write(usage);
    process.exit(command ? 0 : 1);
  }

  if (command !== "replay") {
    process.stderr.write(`unknown command: ${command}\n${usage}`);
    process.exit(1);
  }

  const args = parseArgs(rest);
  if (args.help) {
    process.stdout.write(usage);
    process.exit(0);
  }

  let fileData = {};
  if (args.positional.length > 0) {
    fileData = loadErrorFile(args.positional[0]);
  }

  const seed = args.seed ?? fileData.seed;
  const sourcePath = args.sourcePath ?? fileData.sourcePath;
  const typeName = args.typeName ?? fileData.typeName;
  const runnerPath = args.runner ?? fileData.runner;
  const symbol = args.symbol ?? fileData.symbol;
  const numRuns = args.numRuns ?? fileData.numRuns;

  if (typeof seed !== "number" || Number.isNaN(seed)) {
    throw new Error("missing --seed");
  }
  if (!sourcePath) {
    throw new Error("missing --source");
  }
  if (!typeName) {
    throw new Error("missing --type");
  }
  if (!runnerPath) {
    throw new Error("missing --runner");
  }

  const run = await resolveRunner(runnerPath, symbol);
  const { replayValues } = await import("ts-fuzzing");

  const report = await replayValues({
    sourcePath: path.resolve(process.cwd(), sourcePath),
    typeName,
    seed,
    numRuns,
    stopOnFirstFailure: args.stopOnFirstFailure,
    run,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatTrace(report)}\n`);
  }

  process.exit(report.failures.length > 0 ? 1 : 0);
};

main().catch((error) => {
  process.stderr.write(`[ts-fuzzing] ${error?.message ?? error}\n`);
  process.exit(1);
});
