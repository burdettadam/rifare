import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const application = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(application, "../..");
const packages = resolve(repository, "packages");
const output = resolve(application, ".medusa/server/rifare");
const entries = [
  "packages/adapters/delegated-commands/public-use-client.mts",
  "packages/adapters/delegated-commands/command-codec.mts",
  "packages/adapters/delegated-receipts/strict-json.mts",
];
const pending = entries.map(path => resolve(repository, path));
const visited = new Set();
const modulePath = text => text.replace(/\.mts$/, ".mjs");

function specifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0];
}

function rewrite(context) {
  const visit = node => {
    const source = specifier(node);
    if (source && ts.isStringLiteral(source) && source.text.startsWith(".") && source.text.endsWith(".mts")) {
      const target = ts.factory.createStringLiteral(modulePath(source.text));
      if (ts.isImportDeclaration(node)) {
        return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, target, node.attributes);
      }
      if (ts.isExportDeclaration(node)) {
        return ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly,
          node.exportClause, target, node.attributes);
      }
      return ts.factory.updateCallExpression(node, node.expression, node.typeArguments, [target, ...node.arguments.slice(1)]);
    }
    return ts.visitEachChild(node, visit, context);
  };
  return source => ts.visitNode(source, visit);
}

while (pending.length) {
  const path = pending.pop();
  if (visited.has(path)) continue;
  const local = relative(packages, path);
  if (local.startsWith(".." + sep) || local === ".." || !path.endsWith(".mts")) {
    throw new Error("Shared authority import escapes the packages source");
  }
  visited.add(path);
  const source = readFileSync(path, "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
  const collect = node => {
    const imported = specifier(node);
    if (imported && ts.isStringLiteral(imported) && imported.text.startsWith(".")) {
      if (!imported.text.endsWith(".mts")) throw new Error("Unsupported shared authority import in " + local);
      pending.push(resolve(dirname(path), imported.text));
    }
    ts.forEachChild(node, collect);
  };
  collect(tree);
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false },
    transformers: { before: [rewrite] },
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new Error("Cannot compile shared authority source " + local);
  }
  const destination = resolve(output, "shared", modulePath(relative(repository, path)));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, compiled.outputText, "utf8");
}
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "authority-adapters.mjs"),
  'export * as wire from "./shared/packages/adapters/delegated-commands/public-use-client.mjs";\n' +
  'export * as codec from "./shared/packages/adapters/delegated-commands/command-codec.mjs";\n' +
  'export * as request_json from "./shared/packages/adapters/delegated-receipts/strict-json.mjs";\n', "utf8");
console.log(JSON.stringify({ authority_adapter_modules: visited.size, format: "compiled-esm" }));
