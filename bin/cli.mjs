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

const lintScript =
  `oxlint . -c ./node_modules/${packageName}/oxlint/strict-react.json --ignore-path .gitignore ` +
  `&& oxfmt . -c ./node_modules/${packageName}/oxfmt/strict.mjs --check --ignore-path .gitignore`;
const formatScript =
  `oxlint . -c ./node_modules/${packageName}/oxlint/strict-react.json --fix --ignore-path .gitignore ` +
  `&& oxfmt . -c ./node_modules/${packageName}/oxfmt/strict.mjs --ignore-path .gitignore`;

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  ironoxlint init [--force]",
      "",
      "Examples:",
      "  ironoxlint init",
      "  ironoxlint init --force",
      "",
    ].join("\n"),
  );
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

function initProject(args) {
  const force = args.includes("--force");
  const cwd = process.cwd();
  const cwdPackageJson = path.join(cwd, "package.json");

  if (!fs.existsSync(cwdPackageJson)) {
    process.stderr.write(
      "No package.json found in current directory. Run this command at your project root.\n",
    );
    return 1;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(cwdPackageJson, "utf8"));
  } catch {
    process.stderr.write("Could not parse package.json. Fix JSON syntax and retry.\n");
    return 1;
  }

  if (!manifest.scripts || typeof manifest.scripts !== "object") {
    manifest.scripts = {};
  }
  if (!manifest.devDependencies || typeof manifest.devDependencies !== "object") {
    manifest.devDependencies = {};
  }

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

    if (force) {
      manifest.scripts[key] = value;
      overwritten.push(key);
    } else {
      skipped.push(key);
    }
  }

  const currentVersion = manifest.devDependencies[packageName];
  const requiredVersion = `^${packageVersion}`;
  const dependencyChanged = currentVersion !== requiredVersion;
  if (dependencyChanged) {
    manifest.devDependencies[packageName] = requiredVersion;
  }

  if (created.length === 0 && overwritten.length === 0 && !dependencyChanged) {
    process.stdout.write(
      "No changes applied. Use --force to overwrite existing lint/format scripts.\n",
    );
    return 0;
  }

  fs.writeFileSync(cwdPackageJson, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

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
  if (dependencyChanged) {
    const installExit = installSelf(cwd);
    if (installExit !== 0) {
      return installExit;
    }
  }

  return 0;
}

if (command === "init") {
  process.exit(initProject(rest));
}

printHelp();
process.exit(1);

