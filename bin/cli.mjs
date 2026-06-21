#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [, , command, ...rest] = process.argv;

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const selfManifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageName = selfManifest.name;
const packageVersion = selfManifest.version;
const oxlintConfigPath = path.join(packageRoot, "oxlint", "strict-react.json");
const oxfmtConfigPath = path.join(packageRoot, "oxfmt", "strict.json");
const localOxlintConfigNames = [
  ".oxlintrc.json",
  ".oxlintrc.jsonc",
  "oxlint.config.json",
  "oxlint.config.jsonc",
];
const defaultIgnoredNames = new Set([
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

const lintScript = `${packageName} lint`;
const formatScript = `${packageName} format`;

function applyScriptUpdates(manifest, force) {
  const updates = [
    ["lint", lintScript],
    ["format", formatScript],
  ];
  const created = [];
  const overwritten = [];
  const skipped = [];

  for (const [key, value] of updates) {
    const current = manifest.scripts[key];

    if (typeof current === "undefined") {
      manifest.scripts[key] = value;
      created.push(key);
      continue;
    }

    if (current === value) {
      skipped.push(key);
      continue;
    }

    if (!force) {
      skipped.push(key);
      continue;
    }

    manifest.scripts[key] = value;
    overwritten.push(key);
  }

  return { created, overwritten, skipped };
}

function detectPackageManager(cwd) {
  if (fs.existsSync(path.join(cwd, "bun.lock")) || fs.existsSync(path.join(cwd, "bun.lockb"))) {
    return "bun";
  }
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

function ensureObjectProperty(target, key) {
  if (!target[key] || typeof target[key] !== "object") {
    target[key] = {};
  }
}

function findDependencyBin(packageId) {
  let cursor = packageRoot;
  const relativeBinPath = path.join(packageId, "bin", packageId);

  while (true) {
    const candidate = path.join(cursor, "node_modules", relativeBinPath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  process.stderr.write(
    `Could not resolve ${packageId} binary from ${packageName}. Reinstall dependencies and retry.\n`,
  );
  return null;
}

function initProject(args) {
  const cwd = process.cwd();
  const force = args.includes("--force");
  const cwdPackageJson = path.join(cwd, "package.json");
  const manifest = parseManifestFile(cwdPackageJson);
  if (!manifest) {
    return 1;
  }

  ensureObjectProperty(manifest, "scripts");
  ensureObjectProperty(manifest, "devDependencies");

  const { created, overwritten, skipped } = applyScriptUpdates(manifest, force);
  const dependencyChanged = updateSelfDependency(manifest);

  if (created.length === 0 && overwritten.length === 0 && !dependencyChanged) {
    process.stdout.write(
      "No changes applied. Use --force to overwrite existing lint/format scripts.\n",
    );
    return 0;
  }

  fs.writeFileSync(cwdPackageJson, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  printInitSummary(created, overwritten, skipped);

  if (!dependencyChanged) {
    return 0;
  }

  return installSelf(cwd);
}

function installSelf(cwd) {
  const manager = detectPackageManager(cwd);
  let command = "";
  let args = [];

  if (manager === "bun") {
    command = "bun";
    args = ["add", "-d", `${packageName}@${packageVersion}`];
  } else if (manager === "pnpm") {
    command = "pnpm";
    args = ["add", "-D", `${packageName}@${packageVersion}`];
  } else if (manager === "yarn") {
    command = "yarn";
    args = ["add", "-D", `${packageName}@${packageVersion}`];
  } else {
    command = "npm";
    args = ["i", "-D", `${packageName}@${packageVersion}`];
  }

  process.stdout.write(`Installing ${packageName}@${packageVersion} with ${manager}...\n`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return typeof result.status === "number" ? result.status : 1;
}

function parseManifestFile(filePath) {
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

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  ironoxlint init [--force]",
      "  ironoxlint lint",
      "  ironoxlint format",
      "",
      "Examples:",
      "  ironoxlint init",
      "  ironoxlint init --force",
      "  ironoxlint lint",
      "  ironoxlint format",
      "",
    ].join("\n"),
  );
}

function printInitSummary(created, overwritten, skipped) {
  process.stdout.write("Updated package.json scripts.\n");
  if (created.length > 0) {
    process.stdout.write(`Created: ${created.join(", ")}\n`);
  }
  if (overwritten.length > 0) {
    process.stdout.write(`Overwritten: ${overwritten.join(", ")}\n`);
  }
  if (skipped.length > 0) {
    process.stdout.write(`Skipped: ${skipped.join(", ")}\n`);
  }
}

function getExistingIgnoreFiles(cwd) {
  const candidates = [".gitignore", ".prettierignore"];
  return candidates.filter((fileName) => fs.existsSync(path.join(cwd, fileName)));
}

function getLocalOxlintConfigPath(cwd) {
  for (const configName of localOxlintConfigNames) {
    const configPath = path.join(cwd, configName);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

function toConfigPath(filePath) {
  return path.resolve(filePath).split(path.sep).join("/");
}

function createMergedOxlintConfig(cwd) {
  const localConfigPath = getLocalOxlintConfigPath(cwd);
  if (!localConfigPath) {
    return { configPath: oxlintConfigPath, cleanup: () => {} };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ironoxlint-"));
  const configPath = path.join(tempDir, "oxlint.config.json");
  const config = {
    extends: [toConfigPath(oxlintConfigPath), toConfigPath(localConfigPath)],
  };

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return {
    configPath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function getTargetPaths(cwd) {
  const entries = fs.readdirSync(cwd, { withFileTypes: true });
  const targets = [];

  for (const entry of entries) {
    if (defaultIgnoredNames.has(entry.name)) {
      continue;
    }

    targets.push(entry.name);
  }

  return targets.length > 0 ? targets : ["."];
}

function getOxlintArgs(cwd, configPath, modeArgs) {
  const args = [...getTargetPaths(cwd), "-c", configPath, ...modeArgs];
  const [gitignorePath] = getExistingIgnoreFiles(cwd);

  if (gitignorePath) {
    args.push("--ignore-path", gitignorePath);
  }

  return args;
}

function getOxfmtArgs(cwd, modeArgs) {
  const args = [...getTargetPaths(cwd), "-c", oxfmtConfigPath, ...modeArgs];

  for (const ignoreFile of getExistingIgnoreFiles(cwd)) {
    args.push("--ignore-path", ignoreFile);
  }

  return args;
}

function runOxlint(cwd, oxlintBin, modeArgs) {
  const oxlintConfig = createMergedOxlintConfig(cwd);

  try {
    return runNodeScript(oxlintBin, getOxlintArgs(cwd, oxlintConfig.configPath, modeArgs), cwd);
  } finally {
    oxlintConfig.cleanup();
  }
}

function runFormat(cwd) {
  const oxlintBin = findDependencyBin("oxlint");
  const oxfmtBin = findDependencyBin("oxfmt");
  if (!oxlintBin || !oxfmtBin) {
    return 1;
  }

  const lintFixExit = runOxlint(cwd, oxlintBin, ["--fix"]);
  if (lintFixExit !== 0) {
    return lintFixExit;
  }

  return runNodeScript(oxfmtBin, getOxfmtArgs(cwd, []), cwd);
}

function runLint(cwd) {
  const oxlintBin = findDependencyBin("oxlint");
  const oxfmtBin = findDependencyBin("oxfmt");
  if (!oxlintBin || !oxfmtBin) {
    return 1;
  }

  const lintExit = runOxlint(cwd, oxlintBin, []);
  if (lintExit !== 0) {
    return lintExit;
  }

  return runNodeScript(oxfmtBin, getOxfmtArgs(cwd, ["--check"]), cwd);
}

function runNodeScript(scriptPath, args, cwd) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    stdio: "inherit",
  });
  return typeof result.status === "number" ? result.status : 1;
}

function updateSelfDependency(manifest) {
  const currentVersion = manifest.devDependencies[packageName];
  const requiredVersion = `^${packageVersion}`;
  const dependencyChanged = currentVersion !== requiredVersion;

  if (dependencyChanged) {
    manifest.devDependencies[packageName] = requiredVersion;
  }

  return dependencyChanged;
}

if (command === "init") {
  process.exit(initProject(rest));
}
if (command === "lint") {
  process.exit(runLint(process.cwd()));
}
if (command === "format") {
  process.exit(runFormat(process.cwd()));
}

printHelp();
process.exit(1);
