import fs from "node:fs";
import path from "node:path";

const SOURCE_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const TEST_FILE_NAME_PATTERN = /\.(test|spec)\.[^.]+$/;
const TEST_FILE_PATH_PATTERN = /\/test\/[^/]+\.(test|spec)\.[^.]+$/;
const FEATURE_HOOK_FILE_PATTERN = /\/src\/features\/[^/]+\/hooks\/use[A-Z][^/]*\.(?:ts|tsx)$/;
const SHARED_LOGIC_HOOK_FILE_PATTERN = /\/src\/shared\/logic\/use[A-Z][^/]*\.(?:ts|tsx)$/;
const SHARED_THEME_HOOK_FILE_PATTERN = /\/src\/shared\/themes\/use[A-Z][^/]*\.(?:ts|tsx)$/;
const SHARED_UI_LOCAL_HOOK_FILE_PATTERN = /\/src\/shared\/ui\/.+\/use[A-Z][^/]*\.(?:ts|tsx)$/;

function getFilename(context) {
  return normalizePath(context.filename);
}

function isAllowedHookFile(filePath) {
  return (
    FEATURE_HOOK_FILE_PATTERN.test(filePath) ||
    SHARED_LOGIC_HOOK_FILE_PATTERN.test(filePath) ||
    SHARED_THEME_HOOK_FILE_PATTERN.test(filePath) ||
    SHARED_UI_LOCAL_HOOK_FILE_PATTERN.test(filePath)
  );
}

function isSrcFile(filePath) {
  return filePath.includes("/src/");
}

function isTestFile(filePath) {
  return TEST_FILE_PATH_PATTERN.test(filePath);
}

function isTestNamedFile(filePath) {
  return TEST_FILE_NAME_PATTERN.test(path.posix.basename(filePath));
}

function isTypesFile(filePath) {
  return filePath.endsWith("/types.ts");
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function reportProgramNode(context, node, message) {
  context.report({ node, message });
}

const noReexportsRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow re-exports.",
    },
    schema: [],
  },
  create(context) {
    const filePath = getFilename(context);
    if (!isSrcFile(filePath) || isTestFile(filePath)) {
      return {};
    }

    return {
      ExportAllDeclaration(node) {
        context.report({
          node,
          message:
            "Re-exports are forbidden. Import symbols where needed and export only local declarations.",
        });
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          context.report({
            node,
            message:
              "Re-exports are forbidden. Import symbols where needed and export only local declarations.",
          });
        }
      },
    };
  },
};

const noDefaultExportInSrcRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow default exports in src files.",
    },
    schema: [],
  },
  create(context) {
    const filePath = getFilename(context);
    if (!isSrcFile(filePath) || isTestFile(filePath)) {
      return {};
    }

    return {
      ExportDefaultDeclaration(node) {
        context.report({
          node,
          message: "Default exports are forbidden in src. Use named exports only.",
        });
      },
    };
  },
};

const hookFilePlacementRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce hook file placement and naming conventions.",
    },
    schema: [],
  },
  create(context) {
    const filePath = getFilename(context);
    if (!isSrcFile(filePath) || isTestFile(filePath)) {
      return {};
    }

    const baseName = path.posix.basename(filePath);

    return {
      Program(node) {
        if (/\/hooks\//.test(filePath) && !/^use[A-Z][^/]*\.(?:ts|tsx)$/.test(baseName)) {
          reportProgramNode(
            context,
            node,
            "Files inside a hooks directory must be named use*.ts or use*.tsx.",
          );
          return;
        }

        if (/^use[A-Z][^/]*\.(?:ts|tsx)$/.test(baseName) && !isAllowedHookFile(filePath)) {
          reportProgramNode(
            context,
            node,
            "Hooks must live in src/features/<feature>/hooks, src/shared/logic, src/shared/themes, or a local shared/ui component folder.",
          );
        }
      },
    };
  },
};

const testFilePlacementRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce colocated test directory placement.",
    },
    schema: [],
  },
  create(context) {
    const filePath = getFilename(context);
    if (!isSrcFile(filePath)) {
      return {};
    }

    return {
      Program(node) {
        if (!isTestNamedFile(filePath)) {
          return;
        }

        if (!isTestFile(filePath)) {
          reportProgramNode(
            context,
            node,
            "Tests must live in a sibling test/ directory next to the module they verify.",
          );
          return;
        }

        const testBaseName = path.posix.basename(filePath).replace(TEST_FILE_NAME_PATTERN, "");
        const sourceDirectory = path.posix.dirname(path.posix.dirname(filePath));

        const hasSourceFile = SOURCE_FILE_EXTENSIONS.some((extension) =>
          fs.existsSync(`${sourceDirectory}/${testBaseName}${extension}`),
        );

        if (!hasSourceFile) {
          reportProgramNode(
            context,
            node,
            "Each test file must map to a sibling source module in the parent directory.",
          );
        }
      },
    };
  },
};

const preferTypesFileRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce colocating exported shared type declarations in a dedicated types.ts file.",
    },
    schema: [],
  },
  create(context) {
    const filePath = getFilename(context);
    if (!isSrcFile(filePath) || isTestFile(filePath) || isTypesFile(filePath)) {
      return {};
    }

    return {
      ExportNamedDeclaration(node) {
        if (!node.declaration) {
          return;
        }

        const declaration = node.declaration;
        if (
          declaration.type === "TSTypeAliasDeclaration" ||
          declaration.type === "TSInterfaceDeclaration"
        ) {
          context.report({
            node,
            message:
              "Exported types/interfaces must live in a sibling types.ts file. Keep file-local types non-exported.",
          });
        }
      },
    };
  },
};

export default {
  rules: {
    "hook-file-placement": hookFilePlacementRule,
    "no-default-export-in-src": noDefaultExportInSrcRule,
    "no-reexports": noReexportsRule,
    "prefer-types-file": preferTypesFileRule,
    "test-file-placement": testFilePlacementRule,
  },
};
