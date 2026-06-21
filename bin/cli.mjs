#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [, , command, ...args] = process.argv;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { name: packageName, version: packageVersion } = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);

const oxlintConfigPath = path.join(packageRoot, "oxlint", "strict.json");
const oxfmtConfigPath = path.join(packageRoot, "oxfmt", "strict.json");
const ignoredTargets = new Set([
  ".agents",
  ".angular",
  ".cache",
  ".eslintcache",
  ".expo",
  ".git",
  ".idea",
  ".next",
  ".nx",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".vscode",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static",
  "target",
  "temp",
  "tmp",
  "vendor",
]);

function detectPackageManager(cwd) {
  if (exists(cwd, "bun.lock") || exists(cwd, "bun.lockb")) {
    return "bun";
  }
  if (exists(cwd, "pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (exists(cwd, "yarn.lock")) {
    return "yarn";
  }
  return "npm";
}

function exists(cwd, fileName) {
  return fs.existsSync(path.join(cwd, fileName));
}

function findDependencyCommand(packageId) {
  let cursor = packageRoot;
  const relativeBinPath = path.join(packageId, "bin", packageId);

  while (true) {
    const binPath = path.join(cursor, "node_modules", relativeBinPath);
    if (fs.existsSync(binPath)) {
      return {
        args: [binPath],
        command: process.execPath,
        shell: false,
      };
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return {
        args: [],
        command: packageId,
        shell: process.platform === "win32",
      };
    }
    cursor = parent;
  }
}

function getExistingIgnoreFiles(cwd) {
  return [".gitignore", ".prettierignore"].filter((fileName) => exists(cwd, fileName));
}

function getLocalOxlintConfigPath(cwd) {
  return [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.json", "oxlint.config.jsonc"]
    .map((fileName) => path.join(cwd, fileName))
    .find((filePath) => fs.existsSync(filePath));
}

function getLocalOxfmtConfigPath(cwd) {
  return [
    ".oxfmtrc.json",
    ".oxfmtrc.jsonc",
    "oxfmt.config.json",
    "oxfmt.config.jsonc",
    "oxfmt.config.js",
    "oxfmt.config.mjs",
    "oxfmt.config.cjs",
    "oxfmt.config.ts",
  ]
    .map((fileName) => path.join(cwd, fileName))
    .find((filePath) => fs.existsSync(filePath));
}

function getTargetPaths(cwd) {
  const targets = fs
    .readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => !ignoredTargets.has(entry.name))
    .map((entry) => entry.name);

  return targets.length > 0 ? targets : ["."];
}

function initProject() {
  const cwd = process.cwd();
  const force = args.includes("--force");
  const manifestPath = path.join(cwd, "package.json");
  const manifest = readManifest(manifestPath);
  if (!manifest) {
    return 1;
  }

  manifest.scripts = objectValue(manifest.scripts);
  manifest.devDependencies = objectValue(manifest.devDependencies);

  const summary = updateScripts(manifest, force);
  const dependencyChanged = updateSelfDependency(manifest);

  if (!summary.changed && !dependencyChanged) {
    process.stdout.write(
      "No changes applied. Use --force to overwrite existing lint/format scripts.\n",
    );
    return 0;
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  printInitSummary(summary);

  return dependencyChanged ? installSelf(cwd) : 0;
}

function installSelf(cwd) {
  const manager = detectPackageManager(cwd);
  const dependency = `${packageName}@${packageVersion}`;
  const installCommands = {
    bun: ["bun", ["add", "-d", dependency]],
    npm: ["npm", ["i", "-D", dependency]],
    pnpm: ["pnpm", ["add", "-D", dependency]],
    yarn: ["yarn", ["add", "-D", dependency]],
  };
  const [installCommand, installArgs] = installCommands[manager];

  process.stdout.write(`Installing ${dependency} with ${manager}...\n`);
  return runProcess(installCommand, installArgs, cwd, process.platform === "win32");
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function printHelp() {
  process.stdout.write(
    ["Usage:", "  ironoxlint init [--force]", "  ironoxlint lint", "  ironoxlint format", ""].join(
      "\n",
    ),
  );
}

function printInitSummary({ created, overwritten, skipped }) {
  process.stdout.write("Updated package.json scripts.\n");
  printList("Created", created);
  printList("Overwritten", overwritten);
  printList("Skipped", skipped);
}

function printList(label, values) {
  if (values.length > 0) {
    process.stdout.write(`${label}: ${values.join(", ")}\n`);
  }
}

function readManifest(filePath) {
  if (!fs.existsSync(filePath)) {
    process.stderr.write(
      "No package.json found in current directory. Run this command at your project root.\n",
    );
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    process.stderr.write("Could not parse package.json. Fix JSON syntax and retry.\n");
    return null;
  }
}

function runCommand(mode) {
  const cwd = process.cwd();
  const oxlintCommand = findDependencyCommand("oxlint");
  const oxfmtCommand = findDependencyCommand("oxfmt");

  const lintExit = runOxlint(cwd, oxlintCommand, mode === "format" ? ["--fix"] : []);
  if (lintExit !== 0) {
    return lintExit;
  }

  if (mode === "lint") {
    return 0;
  }

  return runTool(oxfmtCommand, getOxfmtArgs(cwd), cwd);
}

function runTool(toolCommand, toolArgs, cwd) {
  return runProcess(
    toolCommand.command,
    [...toolCommand.args, ...toolArgs],
    cwd,
    toolCommand.shell,
  );
}

function runOxlint(cwd, oxlintCommand, modeArgs) {
  const { configPath, cleanup } = resolveOxlintConfig(cwd);

  try {
    return runTool(oxlintCommand, getOxlintArgs(cwd, configPath, modeArgs), cwd);
  } finally {
    cleanup();
  }
}

function runProcess(processCommand, processArgs, cwd, shell) {
  const result = spawnSync(processCommand, processArgs, {
    cwd,
    shell,
    stdio: "inherit",
  });
  return typeof result.status === "number" ? result.status : 1;
}

function getOxfmtArgs(cwd) {
  const configPath = getLocalOxfmtConfigPath(cwd) ?? oxfmtConfigPath;
  const args = [...getTargetPaths(cwd), "-c", configPath];

  for (const ignoreFile of getExistingIgnoreFiles(cwd)) {
    args.push("--ignore-path", ignoreFile);
  }

  return args;
}

function getOxlintArgs(cwd, configPath, modeArgs) {
  const args = [...getTargetPaths(cwd), "-c", configPath, ...modeArgs];
  const [ignoreFile] = getExistingIgnoreFiles(cwd);

  if (ignoreFile) {
    args.push("--ignore-path", ignoreFile);
  }

  return args;
}

function resolveOxlintConfig(cwd) {
  const localConfigPath = getLocalOxlintConfigPath(cwd);
  if (!localConfigPath) {
    return { configPath: oxlintConfigPath, cleanup: () => {} };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ironoxlint-"));
  const configPath = path.join(tempDir, "oxlint.config.json");
  const toConfigPath = (filePath) => path.resolve(filePath).split(path.sep).join("/");

  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      { extends: [toConfigPath(oxlintConfigPath), toConfigPath(localConfigPath)] },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    configPath,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

function updateScripts(manifest, force) {
  const summary = { changed: false, created: [], overwritten: [], skipped: [] };

  for (const [key, value] of [
    ["lint", `${packageName} lint`],
    ["format", `${packageName} format`],
  ]) {
    const current = manifest.scripts[key];

    if (typeof current === "undefined") {
      manifest.scripts[key] = value;
      summary.created.push(key);
      summary.changed = true;
    } else if (current === value || !force) {
      summary.skipped.push(key);
    } else {
      manifest.scripts[key] = value;
      summary.overwritten.push(key);
      summary.changed = true;
    }
  }

  return summary;
}

function updateSelfDependency(manifest) {
  const requiredVersion = `^${packageVersion}`;
  if (manifest.devDependencies[packageName] === requiredVersion) {
    return false;
  }

  manifest.devDependencies[packageName] = requiredVersion;
  return true;
}

if (command === "init") {
  process.exit(initProject());
}
if (command === "lint" || command === "format") {
  process.exit(runCommand(command));
}

printHelp();
process.exit(1);
