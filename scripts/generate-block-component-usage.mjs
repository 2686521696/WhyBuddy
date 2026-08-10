import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const DESKTOP_FILE = path.join(
  ROOT,
  "client/src/pages/sliderule/live-runtime/block-registry.tsx"
);
const PHONE_FILE = path.join(
  ROOT,
  "client/src/pages/sliderule/live-runtime/phone-mobile/PhoneExperienceBlock.tsx"
);
const RUNTIME_DIR = path.join(ROOT, "client/src/pages/sliderule/live-runtime");
const OUTPUT_FILE = path.join(
  ROOT,
  "client/src/pages/sliderule/generated/block-component-usage.json"
);

const CATALOG_ARRAYS = new Map([
  ["base-catalog.tsx", "PC_BASE_COMPONENTS"],
  ["base-catalog-mobile.tsx", "MOBILE_BASE_COMPONENTS"],
  ["base-catalog-pro.tsx", "PRO_BASE_COMPONENTS"],
  ["base-catalog-custom.tsx", "CUSTOM_BASE_COMPONENTS"],
]);

/**
 * 自研组件的实现模块（2026-08-10）。
 *
 * 此前这份统计只认三个模块的 import——`antd` / `@ant-design/pro-components`
 * / `antd-mobile`。自定义档那 7 个组件（CodeEditor、SignaturePad…）**结构上
 * 永远统计不到**：它们不从这三个模块来。ECharts 是靠一条硬编码的标识符特例
 * （`LazyEchartsChart` → `ECharts`）混进来的，那说明这个盲区早就存在，只是
 * 用一条补丁盖住了一个。
 *
 * 这个盲区不是小数点问题：它让"接线做了没有"这件事在数字上完全看不出来。
 * 审目录时我据此得出「自定义档零引用」，那个结论当时是对的，但**即使有人接了
 * 也会得出同样的结论**——这种指标是靠不住的。
 *
 * 现在改成认这一个模块：从它导入的名字**就是**目录里的组件名（导出名与
 * `name` 字段一一对应，见 custom-components.tsx 的文件头）。
 */
const CUSTOM_COMPONENT_MODULE = "base-components/custom-components";

function sourceFile(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function propertyName(node) {
  if (!node) return undefined;
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
  )
    return node.text;
  return undefined;
}

function variableInitializer(source, variableName) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === variableName
      )
        return declaration.initializer;
    }
  }
  return undefined;
}

function catalogNames() {
  const names = new Set();
  const directory = path.join(
    ROOT,
    "client/src/pages/sliderule/base-components"
  );
  for (const [file, variableName] of CATALOG_ARRAYS) {
    const source = sourceFile(path.join(directory, file));
    const initializer = variableInitializer(source, variableName);
    if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
      throw new Error(`${variableName} array not found in ${file}`);
    }
    for (const element of initializer.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue;
      const nameProperty = element.properties.find(
        property =>
          ts.isPropertyAssignment(property) &&
          propertyName(property.name) === "name"
      );
      if (
        nameProperty &&
        ts.isPropertyAssignment(nameProperty) &&
        ts.isStringLiteral(nameProperty.initializer)
      )
        names.add(nameProperty.initializer.text);
    }
  }
  return names;
}

function createProject() {
  const configFile = ts.findConfigFile(
    ROOT,
    ts.sys.fileExists,
    "tsconfig.json"
  );
  if (!configFile) throw new Error("tsconfig.json not found");
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n")
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configFile)
  );
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
}

function importDeclarationOf(node) {
  let current = node;
  while (current && !ts.isImportDeclaration(current)) current = current.parent;
  return current && ts.isImportDeclaration(current) ? current : undefined;
}

function componentIdFromImport(identifier, symbol, device) {
  for (const declaration of symbol?.declarations ?? []) {
    if (!ts.isImportSpecifier(declaration)) continue;
    const importDeclaration = importDeclarationOf(declaration);
    if (
      !importDeclaration ||
      !ts.isStringLiteral(importDeclaration.moduleSpecifier) ||
      declaration.isTypeOnly ||
      importDeclaration.importClause?.isTypeOnly
    )
      continue;
    const moduleName = importDeclaration.moduleSpecifier.text;
    // 自研组件是 pc 档（目录里 platform: "pc"），只在桌面侧计数。
    if (device === "desktop" && moduleName.endsWith(CUSTOM_COMPONENT_MODULE)) {
      return declaration.propertyName?.text ?? declaration.name.text;
    }
    const supported =
      device === "desktop"
        ? moduleName === "antd" || moduleName === "@ant-design/pro-components"
        : moduleName === "antd-mobile";
    if (!supported) continue;
    const imported = declaration.propertyName?.text ?? declaration.name.text;
    if (imported === "theme") return undefined;
    // ProComponents exposes field-level controls as separate React exports,
    // while the catalog deliberately models them as one ProForm capability.
    // The editable row/cell variants are the same catalog capability as the
    // editable ProTable surface.
    const normalized =
      device === "desktop"
        ? imported.startsWith("ProForm") ||
          imported === "CellEditorTable" ||
          imported === "RowEditorTable"
          ? imported === "CellEditorTable" || imported === "RowEditorTable"
            ? "EditableProTable"
            : "ProForm"
          : imported
        : imported;
    return device === "phone" ? `M.${normalized}` : normalized;
  }
  return undefined;
}

function isRuntimeDeclaration(declaration) {
  const file = path.resolve(declaration.getSourceFile().fileName);
  return file === RUNTIME_DIR || file.startsWith(`${RUNTIME_DIR}${path.sep}`);
}

function dependencyReader(program, device) {
  const checker = program.getTypeChecker();

  return root => {
    const found = new Set();
    const visitedNodes = new Set();
    const visitedSymbols = new Set();

    const visitSymbol = symbol => {
      if (!symbol || visitedSymbols.has(symbol)) return;
      visitedSymbols.add(symbol);

      for (const declaration of symbol.declarations ?? []) {
        if (isRuntimeDeclaration(declaration)) visit(declaration);
      }

      if (symbol.flags & ts.SymbolFlags.Alias) {
        const target = checker.getAliasedSymbol(symbol);
        if (target !== symbol) visitSymbol(target);
      }
    };

    const visit = node => {
      if (!node || visitedNodes.has(node)) return;
      visitedNodes.add(node);

      if (ts.isIdentifier(node)) {
        if (
          node.text === "LazyEchartsChart" ||
          node.text === "PhoneLazyEchartsChart"
        )
          found.add("ECharts");

        const symbol = checker.getSymbolAtLocation(node);
        const component = componentIdFromImport(node, symbol, device);
        if (component) {
          found.add(component);
          return;
        }
        visitSymbol(symbol);
      }

      ts.forEachChild(node, visit);
    };

    visit(root);
    return [...found].sort((a, b) => a.localeCompare(b));
  };
}

function unwrapObject(expression) {
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (ts.isCallExpression(expression)) {
    for (const argument of expression.arguments) {
      const object = unwrapObject(argument);
      if (object) return object;
    }
  }
  return undefined;
}

function desktopBlocks(program) {
  const source = program.getSourceFile(DESKTOP_FILE);
  if (!source) throw new Error("desktop registry source not found in program");
  const readDependencies = dependencyReader(program, "desktop");
  const definitions = variableInitializer(source, "BLOCK_DEFINITIONS");
  const object = definitions && unwrapObject(definitions);
  if (!object) throw new Error("BLOCK_DEFINITIONS object not found");

  const blocks = new Map();
  const phoneEnabled = new Set();
  for (const property of object.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isObjectLiteralExpression(property.initializer)
    )
      continue;
    const blockType = propertyName(property.name);
    const renderProperty = property.initializer.properties.find(
      item =>
        ts.isPropertyAssignment(item) && propertyName(item.name) === "render"
    );
    if (
      !blockType ||
      !renderProperty ||
      !ts.isPropertyAssignment(renderProperty)
    )
      continue;
    blocks.set(blockType, readDependencies(renderProperty.initializer));
    const phoneProperty = property.initializer.properties.find(
      item =>
        ts.isPropertyAssignment(item) && propertyName(item.name) === "phone"
    );
    if (
      phoneProperty &&
      ts.isPropertyAssignment(phoneProperty) &&
      phoneProperty.initializer.kind === ts.SyntaxKind.TrueKeyword
    )
      phoneEnabled.add(blockType);
  }
  return { blocks, phoneEnabled };
}

function phoneBlocks(program, knownBlockTypes) {
  const phoneDirectory = path.dirname(PHONE_FILE);
  const sources = program.getSourceFiles().filter(source => {
    const file = path.resolve(source.fileName);
    return (
      (file === phoneDirectory ||
        file.startsWith(`${phoneDirectory}${path.sep}`)) &&
      !file.includes(`${path.sep}__tests__${path.sep}`)
    );
  });
  if (sources.length === 0)
    throw new Error("phone renderer sources not found in program");
  const readDependencies = dependencyReader(program, "phone");
  const blocks = new Map();

  const visit = node => {
    if (ts.isCaseBlock(node)) {
      const clauses = node.clauses;
      for (let index = 0; index < clauses.length; index += 1) {
        const clause = clauses[index];
        if (
          !ts.isCaseClause(clause) ||
          !ts.isStringLiteral(clause.expression) ||
          !knownBlockTypes.has(clause.expression.text)
        )
          continue;

        const nodes = [clause];
        let cursor = index;
        while (
          nodes.at(-1)?.statements.length === 0 &&
          cursor + 1 < clauses.length
        ) {
          cursor += 1;
          nodes.push(clauses[cursor]);
        }
        const dependencies = new Set(
          nodes.flatMap(candidate => readDependencies(candidate))
        );
        const existing = blocks.get(clause.expression.text) ?? [];
        blocks.set(
          clause.expression.text,
          [...new Set([...existing, ...dependencies])].sort((a, b) =>
            a.localeCompare(b)
          )
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const source of sources) visit(source);
  return blocks;
}

function buildUsage() {
  const program = createProject();
  const { blocks: desktop, phoneEnabled } = desktopBlocks(program);
  const phone = phoneBlocks(program, new Set(desktop.keys()));
  const knownNames = catalogNames();
  const unknown = new Set();
  for (const values of [...desktop.values(), ...phone.values()]) {
    for (const value of values) if (!knownNames.has(value)) unknown.add(value);
  }
  if (unknown.size > 0) {
    throw new Error(
      `Rendered components missing from the base catalog: ${[...unknown]
        .sort((a, b) => a.localeCompare(b))
        .join(", ")}`
    );
  }
  const actual = values => values.filter(value => knownNames.has(value));
  for (const [type, values] of desktop) desktop.set(type, actual(values));
  for (const [type, values] of phone) phone.set(type, actual(values));
  const missingPhoneDependencies = [...phoneEnabled]
    .filter(type => (phone.get(type) ?? []).length === 0)
    .sort((a, b) => a.localeCompare(b));
  if (missingPhoneDependencies.length > 0) {
    throw new Error(
      `Phone-enabled blocks without traced mobile components: ${missingPhoneDependencies.join(", ")}`
    );
  }

  const types = [...new Set([...desktop.keys(), ...phone.keys()])].sort(
    (a, b) => a.localeCompare(b)
  );
  return {
    version: 2,
    generatedFrom: [
      "live-runtime/block-registry.tsx and its local imports",
      "live-runtime/phone-mobile/PhoneExperienceBlock.tsx and its local imports",
    ],
    audit: {
      method: "typescript-symbol-graph",
      renderedButNotCataloged: [...unknown].sort((a, b) => a.localeCompare(b)),
      phoneEnabledBlocks: [...phoneEnabled].sort((a, b) => a.localeCompare(b)),
      desktopDeclarationMismatches: {},
    },
    blocks: Object.fromEntries(
      types.map(type => [
        type,
        { desktop: desktop.get(type) ?? [], phone: phone.get(type) ?? [] },
      ])
    ),
  };
}

const serialized = `${JSON.stringify(buildUsage(), null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUTPUT_FILE)
    ? fs.readFileSync(OUTPUT_FILE, "utf8")
    : "";
  if (current !== serialized) {
    console.error(
      "Block-to-component usage is stale. Run: pnpm usage:generate"
    );
    process.exitCode = 1;
  } else {
    console.log("Block-to-component usage matches the renderer symbol graph.");
  }
} else {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, serialized);
  console.log(`Generated ${path.relative(ROOT, OUTPUT_FILE)}`);
}
