function getFilename(context) {
  return normalizePath(context.filename);
}

function isImportedIdentifier(specifier, importedBindingNames) {
  return (
    specifier.type === "ExportSpecifier" &&
    specifier.local?.type === "Identifier" &&
    importedBindingNames.has(specifier.local.name)
  );
}

function isImportedVariableAlias(declaration, importedBindingNames) {
  return (
    declaration.id?.type === "Identifier" &&
    declaration.init?.type === "Identifier" &&
    importedBindingNames.has(declaration.init.name)
  );
}

function unwrapExpression(node) {
  let currentNode = node;
  while (currentNode) {
    if (
      currentNode.type === "ParenthesizedExpression" ||
      currentNode.type === "TSAsExpression" ||
      currentNode.type === "TSSatisfiesExpression" ||
      currentNode.type === "TSTypeAssertion" ||
      currentNode.type === "TSNonNullExpression"
    ) {
      currentNode = currentNode.expression;
      continue;
    }

    if (currentNode.type === "AwaitExpression") {
      currentNode = currentNode.argument;
      continue;
    }

    break;
  }

  return currentNode;
}

function isImportedIdentifierNode(node, importedBindingNames) {
  const normalizedNode = unwrapExpression(node);
  return normalizedNode?.type === "Identifier" && importedBindingNames.has(normalizedNode.name);
}

function isSingleSpreadCloneFromImported(node, importedBindingNames) {
  const normalizedNode = unwrapExpression(node);
  if (!normalizedNode) {
    return false;
  }

  if (normalizedNode.type === "ArrayExpression" && normalizedNode.elements.length === 1) {
    const [element] = normalizedNode.elements;
    return (
      element?.type === "SpreadElement" &&
      isImportedIdentifierNode(element.argument, importedBindingNames)
    );
  }

  if (normalizedNode.type === "ObjectExpression" && normalizedNode.properties.length === 1) {
    const [property] = normalizedNode.properties;
    return (
      property?.type === "SpreadElement" &&
      isImportedIdentifierNode(property.argument, importedBindingNames)
    );
  }

  return false;
}

function isFunctionForwardingImportedCall(functionNode, importedBindingNames) {
  if (!functionNode?.body || functionNode.body.type !== "BlockStatement") {
    return false;
  }

  if (functionNode.params.some((param) => param.type !== "Identifier")) {
    return false;
  }

  if (functionNode.body.body.length !== 1) {
    return false;
  }

  const [statement] = functionNode.body.body;
  let candidateExpression = null;

  if (statement.type === "ReturnStatement") {
    candidateExpression = statement.argument;
  } else if (statement.type === "ExpressionStatement") {
    candidateExpression = statement.expression;
  }

  const callExpression = unwrapExpression(candidateExpression);
  if (!callExpression || callExpression.type !== "CallExpression") {
    return false;
  }

  if (!isImportedIdentifierNode(callExpression.callee, importedBindingNames)) {
    return false;
  }

  if (callExpression.arguments.length !== functionNode.params.length) {
    return false;
  }

  return callExpression.arguments.every((argument, index) => {
    const normalizedArgument = unwrapExpression(argument);
    const parameter = functionNode.params[index];
    return (
      normalizedArgument?.type === "Identifier" &&
      parameter.type === "Identifier" &&
      normalizedArgument.name === parameter.name
    );
  });
}

function isForwardedFunctionExpression(node, importedBindingNames) {
  const normalizedNode = unwrapExpression(node);
  if (
    normalizedNode?.type !== "ArrowFunctionExpression" &&
    normalizedNode?.type !== "FunctionExpression"
  ) {
    return false;
  }

  if (
    normalizedNode.type === "ArrowFunctionExpression" &&
    normalizedNode.body.type !== "BlockStatement"
  ) {
    if (normalizedNode.params.some((param) => param.type !== "Identifier")) {
      return false;
    }

    const callExpression = unwrapExpression(normalizedNode.body);
    if (!callExpression || callExpression.type !== "CallExpression") {
      return false;
    }

    if (!isImportedIdentifierNode(callExpression.callee, importedBindingNames)) {
      return false;
    }

    if (callExpression.arguments.length !== normalizedNode.params.length) {
      return false;
    }

    return callExpression.arguments.every((argument, index) => {
      const normalizedArgument = unwrapExpression(argument);
      const parameter = normalizedNode.params[index];
      return (
        normalizedArgument?.type === "Identifier" &&
        parameter.type === "Identifier" &&
        normalizedArgument.name === parameter.name
      );
    });
  }

  return isFunctionForwardingImportedCall(normalizedNode, importedBindingNames);
}

function isSrcFile(filePath) {
  return filePath.includes("/src/");
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function reportAliasedReExport(context, node) {
  context.report({
    node,
    message:
      "Pass-through export wrappers are forbidden. Export only local implementations with local behavior.",
  });
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

const noAliasedReExportRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow pass-through export wrappers of imported symbols (aliases, spread clones, and forwarder functions).",
    },
    schema: [],
  },
  create(context) {
    const filePath = getFilename(context);
    if (!isSrcFile(filePath) || isTestFile(filePath)) {
      return {};
    }

    const importedBindingNames = new Set();

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.local?.type === "Identifier") {
            importedBindingNames.add(specifier.local.name);
          }
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          return;
        }

        for (const specifier of node.specifiers ?? []) {
          if (isImportedIdentifier(specifier, importedBindingNames)) {
            reportAliasedReExport(context, specifier);
          }
        }

        if (node.declaration?.type !== "VariableDeclaration") {
          if (
            node.declaration?.type === "FunctionDeclaration" &&
            isFunctionForwardingImportedCall(node.declaration, importedBindingNames)
          ) {
            reportAliasedReExport(context, node.declaration);
          }

          return;
        }

        for (const declaration of node.declaration.declarations) {
          if (
            isImportedVariableAlias(declaration, importedBindingNames) ||
            isSingleSpreadCloneFromImported(declaration.init, importedBindingNames) ||
            isForwardedFunctionExpression(declaration.init, importedBindingNames)
          ) {
            reportAliasedReExport(context, declaration);
          }
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

export default {
  rules: {
    "no-aliased-re-export": noAliasedReExportRule,
    "no-default-export-in-src": noDefaultExportInSrcRule,
    "no-reexports": noReexportsRule,
  },
};
