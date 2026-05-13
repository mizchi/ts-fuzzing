#!/usr/bin/env node
// Pack the current package into a tarball, install it into a temp project,
// and verify every published entrypoint imports cleanly with valid types.
//
// Failures here surface broken export maps, missing declaration files, or
// renamed subpath entrypoints before they ship.

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ts-fuzzing-smoke-"));

const ENTRYPOINTS = [
  { specifier: "ts-fuzzing", named: ["fuzzValues", "ValueFuzzError"] },
  { specifier: "ts-fuzzing/react", named: ["createReactDomRender"] },
  { specifier: "ts-fuzzing/vue", named: ["createVueDomRender"] },
  { specifier: "ts-fuzzing/svelte", named: ["createSvelteRender"] },
  { specifier: "ts-fuzzing/security", named: ["xssPayloads", "xssCorpus"] },
];

const log = (message) => console.log(`[smoke] ${message}`);
const run = (command, options = {}) => {
  execSync(command, { stdio: "inherit", encoding: "utf8", ...options });
};

const cleanup = () => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
};

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

try {
  log(`temp dir: ${tempRoot}`);

  log("building dist/");
  run("pnpm build", { cwd: repoRoot });

  log("packing tarball");
  const packOutput = execSync("pnpm pack --pack-destination .", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const tarball = packOutput.split(/\r?\n/).pop();
  if (!tarball || !tarball.endsWith(".tgz")) {
    throw new Error(`unexpected pnpm pack output: ${packOutput}`);
  }
  const tarballPath = path.resolve(repoRoot, tarball);
  log(`tarball: ${tarballPath}`);

  fs.writeFileSync(
    path.join(tempRoot, "package.json"),
    JSON.stringify({ name: "ts-fuzzing-smoke", private: true, type: "module" }, null, 2),
  );

  log("installing tarball into temp project");
  run(`npm install --no-audit --no-fund --silent ${JSON.stringify(tarballPath)}`, {
    cwd: tempRoot,
  });
  // peer optional deps for the framework adapters
  run("npm install --no-audit --no-fund --silent react@^19.0.0 react-dom@^19.0.0 vue@^3.5.0 svelte@^5.0.0", {
    cwd: tempRoot,
  });

  for (const { specifier, named } of ENTRYPOINTS) {
    log(`importing ${specifier}`);
    const script = `import { ${named.join(", ")} } from "${specifier}";\n` +
      named.map((symbol) => `if (typeof ${symbol} === "undefined") { throw new Error("missing ${symbol} from ${specifier}"); }`).join("\n");
    const scriptPath = path.join(tempRoot, `check-${specifier.replace(/[^a-zA-Z0-9]+/g, "_")}.mjs`);
    fs.writeFileSync(scriptPath, script);
    run(`node ${JSON.stringify(scriptPath)}`, { cwd: tempRoot });
  }

  log("verifying declaration files for every entrypoint");
  const nodeModules = path.join(tempRoot, "node_modules", "ts-fuzzing");
  for (const { specifier } of ENTRYPOINTS) {
    const sub = specifier.replace(/^ts-fuzzing\/?/, "");
    const declarationPath = path.join(
      nodeModules,
      "dist",
      sub === "" ? "index.d.ts" : `${sub}.d.ts`,
    );
    if (!fs.existsSync(declarationPath)) {
      throw new Error(`missing declaration file: ${declarationPath}`);
    }
  }

  log("ok");
  fs.rmSync(tarballPath, { force: true });
} catch (error) {
  console.error("[smoke] failed:", error?.message ?? error);
  process.exit(1);
}
