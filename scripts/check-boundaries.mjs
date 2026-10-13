import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile).config;
const { options, fileNames } = ts.parseJsonConfigFileContent(
  config,
  ts.sys,
  root,
);
const sources = fileNames
  .map((file) => path.resolve(file))
  .filter((file) => /^src[\\/]/.test(path.relative(root, file)));
if (!sources.length) throw new Error("没有找到源码，拒绝报告空检查通过。");
const errors = [],
  graph = new Map();
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
const layer = (file) => relative(file).split("/")[1];
const pureLayers = new Set(["domain", "application"]);
const browserGlobals = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "history",
  "location",
  "HTMLElement",
  "HTMLImageElement",
  "Image",
  "ResizeObserver",
]);

for (const file of sources) {
  const code = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const dependencies = new Set();
  const ownLayer = layer(file);
  const fail = (message) => errors.push(`${relative(file)}: ${message}`);
  function dependency(specifier, runtime, nativeImport = false) {
    if (
      pureLayers.has(ownLayer) &&
      !specifier.startsWith("@/") &&
      !specifier.startsWith(".")
    )
      fail(`纯逻辑不能依赖 ${specifier}`);
    if (
      ["ui", "pages", "features", "state"].includes(ownLayer) &&
      (specifier.startsWith("@tauri-apps/") || nativeImport)
    )
      fail("原生命令必须通过 infrastructure 的具名接口调用");
    const resolved = ts.resolveModuleName(
      specifier,
      file,
      options,
      ts.sys,
    ).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) return;
    const target = path.resolve(resolved.resolvedFileName);
    const targetLayer = layer(target);
    if (ownLayer === "domain" && targetLayer !== "domain")
      fail(`领域模块不能依赖 ${relative(target)}`);
    if (ownLayer === "application" && !pureLayers.has(targetLayer))
      fail(`业务模块不能依赖 ${relative(target)}`);
    if (
      ownLayer === "infrastructure" &&
      ["state", "ui", "pages", "features"].includes(targetLayer)
    )
      fail(`适配层不能反向依赖 ${relative(target)}`);
    if (runtime) dependencies.add(target);
  }
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const runtime =
        !clause ||
        (!clause.isTypeOnly &&
          (!!clause.name ||
            !named ||
            !ts.isNamedImports(named) ||
            named.elements.some((element) => !element.isTypeOnly)));
      const nativeImport =
        named &&
        ts.isNamedImports(named) &&
        named.elements.some(
          (element) => (element.propertyName || element.name).text === "native",
        );
      dependency(node.moduleSpecifier.text, runtime, nativeImport);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      dependency(node.moduleSpecifier.text, !node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      dependency(node.arguments[0].text, true);
    }
    if (
      pureLayers.has(ownLayer) &&
      ts.isIdentifier(node) &&
      browserGlobals.has(node.text)
    )
      fail(`纯逻辑不能访问浏览器对象 ${node.text}`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(path.resolve(file), dependencies);
}

const visited = new Set(),
  active = new Set(),
  stack = [];
function walk(file) {
  if (active.has(file)) {
    errors.push(
      `运行时循环依赖: ${[...stack.slice(stack.indexOf(file)), file].map(relative).join(" -> ")}`,
    );
    return;
  }
  if (visited.has(file)) return;
  active.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) || []) walk(dependency);
  stack.pop();
  active.delete(file);
  visited.add(file);
}
for (const file of graph.keys()) walk(file);
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exitCode = 1;
} else
  console.log(`依赖边界通过：${sources.length} 个模块，无运行时循环依赖。`);
