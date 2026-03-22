#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

function runFormat(cwd) {
  const oxlintBin = findDependencyBin("oxlint");
  const oxfmtBin = findDependencyBin("oxfmt");
  if (!oxlintBin || !oxfmtBin) {
    return 1;
  }

  const lintFixExit = runNodeScript(
    oxlintBin,
    [".", "-c", oxlintConfigPath, "--fix", "--ignore-path", ".gitignore"],
    cwd,
  );
  if (lintFixExit !== 0) {
    return lintFixExit;
  }

  return runNodeScript(oxfmtBin, [".", "-c", oxfmtConfigPath, "--ignore-path", ".gitignore"], cwd);
}

function runLint(cwd) {
  const oxlintBin = findDependencyBin("oxlint");
  const oxfmtBin = findDependencyBin("oxfmt");
  if (!oxlintBin || !oxfmtBin) {
    return 1;
  }

  const lintExit = runNodeScript(
    oxlintBin,
    [".", "-c", oxlintConfigPath, "--ignore-path", ".gitignore"],
    cwd,
  );
  if (lintExit !== 0) {
    return lintExit;
  }

  return runNodeScript(
    oxfmtBin,
    [".", "-c", oxfmtConfigPath, "--check", "--ignore-path", ".gitignore"],
    cwd,
  );
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
