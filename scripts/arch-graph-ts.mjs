// @ts-check
/**
 * TS 侧的架构编译器：把 `arch_graph.py` 那套搬到 1830 个 TS 模块上（2026-08-29）。
 *
 * ## 为什么有这个文件
 *
 * 2026-08-29 那一夜抄 grok-build 的架构，把 `slide-rule-python` 的 273 个模块
 * 从「零强制」做到了「未声明的边红、环红、图是生成的」。收工时数了一下覆盖率：
 *
 *     受闸（slide-rule-python）    273 个模块
 *     不受闸（TS/TSX，排除测试）  1830 个
 *         client   1024   server 582   shared 176   services 26   agent-loop 22
 *     ─────────────────────────────────────────────
 *     覆盖率  273 / 2103 = **13%**
 *
 * 也就是说：**闸只装了一半。** 而 CLAUDE.md 第四条讲的正是这个——
 * 「Python 判定 / TypeScript 运行时」是这仓最常见的成对物，改一条不改另一条
 * 不会报错，只会有一半不生效。架构闸自己就是这个形状的又一例。
 *
 * grok 那边没有「覆盖率」这个概念：一个 cargo workspace 全包，编译器强制。
 * 2026-08-30 重测（docs/WhyBuddy与Grok-build架构对照.md）：一等 crate 92、
 * 一等内部边 351。旧说 364 是含 third_party 的工作区边。我们要补的就是那个"全包"。
 *
 * ## ⚠ 三个非做不可的细节（少一个这道闸就是摆设）
 *
 * **① 动态 import 必须算数。** 这是 TS 侧对应 Python「函数体里的 import」的
 * 那个逃生口——Python 那边实测 62% 的内部 import 藏在函数体里，不算就等于默认
 * 放行三分之二。TS 这边全仓有 202 个文件用 `await import()` / `require()`，
 * `server/index.ts` 自己就有一串。不算它，「把 import 改成 await import()」
 * 就是一句话绕过这道闸的办法。本文件对静态和动态一视同仁，只在报告里标 `deferred`。
 *
 * **② 类型 import 也算边。** `import type { X }` 运行时会被擦掉，但它是**契约
 * 耦合**——Cargo 里 `use` 一个类型同样是依赖，grok 的内部边不区分。
 * 擦不擦得掉是编译细节，不是架构事实。标 `type`，但计入。
 *
 * **③ 判据必须被变异咬住。** 见文件末尾 `--selftest`：四刀分别对应
 * 新增未声明边 / 藏进动态 import / 新增环 / 手改生成的图。
 * 没变异过的闸，跟没装是一回事（本仓 §14 的原话）。
 *
 * ## 与 Python 侧那份的差异，以及为什么
 *
 * | | arch_graph.py | 这里 |
 * |---|---|---|
 * | 解析 | `ast` 标准库 | TypeScript 编译器 API（**不是正则**） |
 * | 清单 | `architecture.toml` | `architecture.ts.json` |
 * | 逃生口 | 函数体内 import | 动态 `import()` / `require()` |
 *
 * 清单换成 JSON 是因为 node 没有内置 TOML 解析器，而**这道闸不该因为少装一个
 * 包就跑不起来**——CI 里它是随 `node --test` 跑的第一批。段落名（layer /
 * component / baseline）与 Python 侧保持一致，好让两边是同一个心智模型。
 *
 * ⚠ 用正则扫 import 是这个位置最容易犯的错，本仓的判据踩过一模一样的形状
 * （CLAUDE.md 第二条：「判据 grep 源码里的标识符，而那个词同时出现在文档字符串里」）。
 * 注释里的 `import x from "y"`、字符串里的路径、JSX 文本——正则全会当真。
 * 所以这里走真 AST。
 *
 * ## 用法
 *
 *     node scripts/arch-graph-ts.mjs --check     # 闸：违规/环有没有变多
 *     node scripts/arch-graph-ts.mjs --report    # 人看的摘要
 *     node scripts/arch-graph-ts.mjs --emit      # 重新生成架构图（写 docs/）
 *     node scripts/arch-graph-ts.mjs --freeze    # 把当前违规/环写进基线（**慎用**）
 */

import ts from "typescript";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(__dir, "..");
export const MANIFEST = join(REPO, "architecture.ts.json");
export const DIAGRAM = join(REPO, "docs", "WhyBuddy TS 架构图（自动生成）.md");

/**
 * 顶层包 = 分层单位，对应 grok 的 crate 分组。
 *
 * ⚠ 跟 Python 侧同样的教训：这份名单**从磁盘派生**，不手写。Python 那边手写
 * 名单漏了 `stdio_utf8`，而名单同时被当成「哪些 import 算内部边」的筛子——
 * 于是漏掉的那个包**结构上不可能有入边**，在零入度名单里显示成"没人用"。
 * 下面这份只作兜底对照物，判据 `包名单是从磁盘派生的` 会拿派生结果跟它比。
 */
export const SEED_PACKAGES = ["agent-loop", "client", "server", "services", "shared"];

/** 不参与架构判定的目录。判断用路径分段，不是 `includes()`——
 *  Python 侧第一版就是后者，把 472 个测试文件全算进了依赖图。 */
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "__tests__", "tests", "test",
  ".git", "coverage", "data", "static", "tmp", "public", "assets",
]);

/** 测试文件不算数（对应 Python 侧 skip `tests/`）。 */
function isTestFile(rel) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /(^|\/)__tests__\//.test(rel);
}

const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** tsconfig / vite 里的两个别名。JSON 数据别名（@legal 等）指向 .json，不是模块。 */
const ALIASES = [
  ["@shared/", "shared/"],
  ["@/", "client/src/"],
];

// ── 扫描 ────────────────────────────────────────────────────────────────────

/** @returns {string[]} 仓内所有参与判定的源文件（仓相对路径，POSIX 分隔符） */
export function sources(root = REPO, packages = null) {
  const pkgs = packages ?? discoverPackages(root);
  /** @type {string[]} */
  const out = [];
  for (const pkg of pkgs) walk(join(root, pkg));
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (/\.[cm]?[jt]sx?$/.test(e.name)) {
        const rel = relative(root, full).split(sep).join("/");
        if (!isTestFile(rel)) out.push(rel);
      }
    }
  }
  return out.sort();
}

/** 顶层包从磁盘派生，不手写。 */
export function discoverPackages(root = REPO) {
  const out = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory() || SKIP_DIRS.has(name.name) || name.name.startsWith(".")) continue;
    // 一个目录算「包」的条件：里面（含子目录）有非测试的 ts/tsx 源码
    if (hasSource(join(root, name.name), 0)) out.push(name.name);
  }
  return out.sort();
}

function hasSource(dir, depth) {
  if (depth > 3) return false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && /\.tsx?$/.test(e.name) && !isTestFile(e.name)) return true;
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && hasSource(join(dir, e.name), depth + 1)) return true;
  }
  return false;
}

/** 模块 id = 去掉扩展名的仓相对路径。`x/index.ts` → `x/index`（不折叠，
 *  折叠会让 `x` 和 `x/index` 变成同一个 id，而磁盘上它们可以并存）。 */
export function moduleId(rel) {
  return rel.replace(/\.[cm]?[jt]sx?$/, "");
}

export function packageOf(moduleIdStr) {
  return moduleIdStr.split("/")[0];
}

/**
 * 把 import 说明符解析成模块 id；解析不出（外部包 / JSON / 资源）返回 null。
 *
 * ⚠ 这仓的 import 写的是 `.js` 而文件是 `.ts`（ESM 风格）。只按字面找文件会
 * 一条内部边都扫不出来——先剥 `.js`/`.jsx` 再按 EXTS 试。
 */
export function resolveSpecifier(spec, fromRel, known) {
  if (!spec || spec.startsWith("\0")) return null;
  let path = null;
  for (const [prefix, target] of ALIASES) {
    if (spec.startsWith(prefix)) { path = target + spec.slice(prefix.length); break; }
  }
  if (path === null) {
    if (spec.startsWith(".")) {
      path = join(dirname(fromRel), spec).split(sep).join("/");
    } else {
      return null; // 裸说明符 = 外部依赖
    }
  }
  if (/\.(json|css|svg|png|jpg|jpeg|webp|txt|md|wasm)$/.test(path)) return null;
  const stripped = path.replace(/\.[cm]?jsx?$/, "");
  for (const cand of [stripped, ...EXTS.map((e) => stripped + e), ...EXTS.map((e) => stripped + "/index" + e)]) {
    const id = moduleId(cand);
    if (known.has(id)) return id;
  }
  return null;
}

/**
 * @typedef {{src:string,dst:string,srcPkg:string,dstPkg:string,deferred:boolean,typeOnly:boolean,line:number}} Edge
 * @typedef {{modules:Set<string>,edges:Edge[],filesScanned:number}} Graph
 */

/** @returns {Graph} */
export function buildGraph(root = REPO) {
  const files = sources(root);
  const known = new Set(files.map(moduleId));
  /** @type {Edge[]} */
  const edges = [];
  for (const rel of files) {
    const text = readFileSync(join(root, rel), "utf8");
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
    const from = moduleId(rel);
    /** @param {ts.Node} n @param {boolean} inFn */
    const visit = (n, inFn) => {
      /** @type {null|[string,boolean,boolean]} */
      let hit = null; // [spec, deferred, typeOnly]
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        hit = [n.moduleSpecifier.text, inFn, Boolean(n.importClause?.isTypeOnly)];
      } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        hit = [n.moduleSpecifier.text, inFn, Boolean(n.isTypeOnly)];
      } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
        hit = [n.argument.literal.text, inFn, true];
      } else if (
        ts.isCallExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ImportKeyword &&
        n.arguments[0] && ts.isStringLiteral(n.arguments[0])
      ) {
        hit = [n.arguments[0].text, true, false]; // 动态 import 一律算 deferred
      } else if (
        ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require" &&
        n.arguments[0] && ts.isStringLiteral(n.arguments[0])
      ) {
        hit = [n.arguments[0].text, true, false];
      }
      if (hit) {
        const dst = resolveSpecifier(hit[0], rel, known);
        if (dst && dst !== from) {
          edges.push({
            src: from, dst,
            srcPkg: packageOf(from), dstPkg: packageOf(dst),
            deferred: hit[1], typeOnly: hit[2],
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          });
        }
      }
      const nowInFn = inFn || ts.isFunctionLike(n);
      ts.forEachChild(n, (c) => visit(c, nowInFn));
    };
    visit(sf, false);
  }
  edges.sort((a, b) => (a.src + a.dst + a.line).localeCompare(b.src + b.dst + b.line));
  return { modules: known, edges, filesScanned: files.length };
}

// ── 清单 ────────────────────────────────────────────────────────────────────

export function loadManifest(path = MANIFEST) {
  if (!existsSync(path)) return { layer: {}, component: {}, entrypoints: { patterns: [] }, baseline: {} };
  return JSON.parse(readFileSync(path, "utf8"));
}

/** 模块 → component。前缀最长匹配（`server/sliderule` 胜过 `server`）。 */
export function componentOf(manifest) {
  /** @type {Array<[string,string]>} */
  const rules = [];
  for (const [name, spec] of Object.entries(manifest.component ?? {})) {
    for (const p of spec.paths ?? []) rules.push([p, name]);
  }
  rules.sort((a, b) => b[0].length - a[0].length);
  return (moduleIdStr) => {
    for (const [prefix, name] of rules) {
      if (moduleIdStr === prefix || moduleIdStr.startsWith(prefix + "/")) return name;
    }
    return null;
  };
}

/** 包级：用了没声明的跨包依赖。 */
export function layerViolations(g, manifest) {
  const layers = manifest.layer ?? {};
  const out = new Set();
  for (const e of g.edges) {
    if (e.srcPkg === e.dstPkg) continue;
    const allowed = layers[e.srcPkg]?.mayDependOn ?? [];
    if (!allowed.includes(e.dstPkg)) out.add(`${e.srcPkg} -> ${e.dstPkg}`);
  }
  return [...out].sort();
}

/** 组级：用了没声明的组间依赖。 */
export function componentViolations(g, manifest) {
  const owner = componentOf(manifest);
  const spec = manifest.component ?? {};
  const out = new Set();
  for (const e of g.edges) {
    const a = owner(e.src), b = owner(e.dst);
    if (!a || !b || a === b) continue;
    if (!(spec[a]?.mayDependOn ?? []).includes(b)) out.add(`${a} -> ${b}`);
  }
  return [...out].sort();
}

/** ⚠ 反向判据的机器版：声明了却没有任何一条边对应 = 一张空白支票。
 *  Python 侧 §23.7 是手工发现这个漏筛的，这里一开始就带上。 */
export function staleComponentDeclarations(g, manifest) {
  const owner = componentOf(manifest);
  const real = new Set(g.edges.map((e) => `${owner(e.src)} -> ${owner(e.dst)}`));
  const out = [];
  for (const [name, spec] of Object.entries(manifest.component ?? {})) {
    for (const dep of spec.mayDependOn ?? []) {
      if (!real.has(`${name} -> ${dep}`)) out.push(`${name} -> ${dep}`);
    }
  }
  return out.sort();
}

export function staleLayerDeclarations(g, manifest) {
  const real = new Set(g.edges.filter((e) => e.srcPkg !== e.dstPkg).map((e) => `${e.srcPkg} -> ${e.dstPkg}`));
  const out = [];
  for (const [name, spec] of Object.entries(manifest.layer ?? {})) {
    for (const dep of spec.mayDependOn ?? []) {
      if (!real.has(`${name} -> ${dep}`)) out.push(`${name} -> ${dep}`);
    }
  }
  return out.sort();
}

// ── 环 ──────────────────────────────────────────────────────────────────────

/** 有向图找环，返回规范化后的环（最小元素起始，确定性）。 */
function cyclesOf(nodes, outEdges) {
  const color = new Map();
  const found = new Set();
  const stack = [];
  function walk(u) {
    color.set(u, 1);
    stack.push(u);
    for (const v of [...(outEdges.get(u) ?? [])].sort()) {
      const c = color.get(v) ?? 0;
      if (c === 1) {
        const cyc = stack.slice(stack.indexOf(v));
        let i = 0;
        for (let k = 1; k < cyc.length; k++) if (cyc[k] < cyc[i]) i = k;
        const rot = [...cyc.slice(i), ...cyc.slice(0, i)];
        found.add([...rot, rot[0]].join(" -> "));
      } else if (c === 0) walk(v);
    }
    stack.pop();
    color.set(u, 2);
  }
  for (const n of [...nodes].sort()) if ((color.get(n) ?? 0) === 0) walk(n);
  return [...found].sort();
}

/** 模块级环。 */
export function findCycles(g) {
  const out = new Map();
  for (const e of g.edges) {
    if (!out.has(e.src)) out.set(e.src, new Set());
    out.get(e.src).add(e.dst);
  }
  return cyclesOf(g.modules, out);
}

/** 组间环。放行条件与 Python 侧同口径：整个环落在同一个 component **且**
 *  那个 component 明写了 allowInternalCycles。 */
export function crossComponentCycles(g, manifest) {
  const owner = componentOf(manifest);
  const opted = new Set(
    Object.entries(manifest.component ?? {}).filter(([, c]) => c.allowInternalCycles).map(([n]) => n)
  );
  return findCycles(g).filter((c) => {
    const members = c.split(" -> ").slice(0, -1);
    const owners = new Set(members.map(owner));
    return !(owners.size === 1 && !owners.has(null) && opted.has([...owners][0]));
  });
}

export function componentCycles(g, manifest) {
  const owner = componentOf(manifest);
  const out = new Map();
  const nodes = new Set();
  for (const e of g.edges) {
    const a = owner(e.src), b = owner(e.dst);
    if (!a || !b || a === b) continue;
    nodes.add(a); nodes.add(b);
    if (!out.has(a)) out.set(a, new Set());
    out.get(a).add(b);
  }
  return cyclesOf(nodes, out);
}

/** 包级环（client ⇄ server 那种）。 */
export function packageCycles(g) {
  const out = new Map();
  const nodes = new Set();
  for (const e of g.edges) {
    if (e.srcPkg === e.dstPkg) continue;
    nodes.add(e.srcPkg); nodes.add(e.dstPkg);
    if (!out.has(e.srcPkg)) out.set(e.srcPkg, new Set());
    out.get(e.srcPkg).add(e.dstPkg);
  }
  return cyclesOf(nodes, out);
}

/** 没人 import 的模块。⚠ 不是待删清单——入口、被 HTML/路由拉起的页面、
 *  声明文件都会落进来。这里只做棘轮：只许变少。 */
export function orphans(g, manifest) {
  const indeg = new Map([...g.modules].map((m) => [m, 0]));
  for (const e of g.edges) indeg.set(e.dst, (indeg.get(e.dst) ?? 0) + 1);
  const pats = (manifest.entrypoints?.patterns ?? []).map(
    (p) => new RegExp("^" + p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$")
  );
  return [...g.modules]
    .filter((m) => (indeg.get(m) ?? 0) === 0 && !pats.some((r) => r.test(m)))
    .sort();
}

// ── 报告 / 生成 ──────────────────────────────────────────────────────────────

export function report(g, manifest) {
  const b = manifest.baseline ?? {};
  const lv = layerViolations(g, manifest);
  const cv = componentViolations(g, manifest);
  const cyc = crossComponentCycles(g, manifest);
  const ccyc = componentCycles(g, manifest);
  const pcyc = packageCycles(g);
  const orp = orphans(g, manifest);
  const deferred = g.edges.filter((e) => e.deferred).length;
  const typeOnly = g.edges.filter((e) => e.typeOnly).length;
  const lines = [
    `模块 ${g.modules.size}  边 ${g.edges.length}  动态/require ${deferred}  类型 ${typeOnly}`,
    `未声明跨包依赖 ${lv.length}（基线 ${(b.violations ?? []).length}）`,
    ...lv.map((v) => `   ${v}`),
    `未声明的组间依赖 ${cv.length}（基线 ${(b.componentViolations ?? []).length}）`,
    ...cv.slice(0, 12).map((v) => `   ${v}`),
    `包级环 ${pcyc.length}`,
    ...pcyc.map((c) => `   ${c}`),
    `模块级环 ${cyc.length}（基线 ${(b.cycles ?? []).length}）`,
    ...cyc.slice(0, 12).map((c) => `   ${c}`),
    `组间环 ${ccyc.length}（基线 ${(b.componentCycles ?? []).length}）`,
    ...ccyc.slice(0, 12).map((c) => `   ${c}`),
    `没人 import 的模块 ${orp.length}（基线 ${(b.orphans ?? []).length}） —— ⚠ 不是待删清单`,
  ];
  return lines.join("\n");
}

function freeze(g, manifest) {
  const next = {
    ...manifest,
    baseline: {
      violations: layerViolations(g, manifest),
      componentViolations: componentViolations(g, manifest),
      cycles: crossComponentCycles(g, manifest),
      componentCycles: componentCycles(g, manifest),
      orphans: orphans(g, manifest),
    },
  };
  writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + "\n", "utf8");
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main(argv) {
  const g = buildGraph();
  const m = loadManifest();
  const b = m.baseline ?? {};
  if (argv.includes("--freeze")) { freeze(g, m); console.log("已写入基线"); return 0; }
  if (argv.includes("--report")) { console.log(report(g, m)); return 0; }
  if (argv.includes("--emit")) {
    writeFileSync(DIAGRAM, renderDoc(g, m), "utf8");
    console.log(`已生成 ${relative(REPO, DIAGRAM)}`);
    return 0;
  }
  // --check
  const problems = [];
  const cmp = (now, base, label) => {
    const extra = now.filter((x) => !(base ?? []).includes(x));
    if (extra.length) problems.push(`新增${label}：\n   ` + extra.join("\n   "));
  };
  cmp(layerViolations(g, m), b.violations, "未声明跨包依赖");
  cmp(componentViolations(g, m), b.componentViolations, "未声明组间依赖");
  cmp(crossComponentCycles(g, m), b.cycles, "循环依赖");
  cmp(componentCycles(g, m), b.componentCycles, "组间环");
  cmp(orphans(g, m), b.orphans, "无人引用模块");
  if (problems.length) { console.error("❌ " + problems.join("\n")); return 1; }
  console.log("✅ 没有新增的未声明依赖或循环");
  return 0;
}

export function renderDoc(g, manifest) {
  const owner = componentOf(manifest);
  const comps = Object.keys(manifest.component ?? {}).sort();
  const compEdges = new Set();
  for (const e of g.edges) {
    const a = owner(e.src), b = owner(e.dst);
    if (a && b && a !== b) compEdges.add(`${a}|${b}`);
  }
  const cyclic = new Set();
  for (const c of componentCycles(g, manifest)) {
    const ms = c.split(" -> ");
    for (let i = 0; i + 1 < ms.length; i++) cyclic.add(`${ms[i]}|${ms[i + 1]}`);
  }
  const pkgCount = {};
  for (const mod of g.modules) pkgCount[packageOf(mod)] = (pkgCount[packageOf(mod)] ?? 0) + 1;
  const out = [];
  out.push("# WhyBuddy TS 架构图（自动生成）");
  out.push("");
  out.push("> ⚠ **这份文件是 `scripts/arch-graph-ts.mjs --emit` 生成的，别手改。**");
  out.push("> 手改了 `scripts/arch-graph-ts.test.mjs` 会红。改代码然后重新生成。");
  out.push("");
  out.push("对应 grok-build 的做法：crate 边界由编译器强制，根 `Cargo.toml` 是生成的。");
  out.push("数字见 `docs/WhyBuddy与Grok-build架构对照.md`（2026-08-30 重测）。");
  out.push("");
  out.push("## 规模");
  out.push("");
  out.push("| 包 | 模块数 |");
  out.push("|---|---:|");
  for (const p of Object.keys(pkgCount).sort()) out.push(`| ${p} | ${pkgCount[p]} |`);
  out.push(`| **合计** | **${g.modules.size}** |`);
  out.push("");
  out.push(`边 ${g.edges.length} 条，其中动态 import / require ${g.edges.filter((e) => e.deferred).length} 条、`);
  out.push(`类型 import ${g.edges.filter((e) => e.typeOnly).length} 条。`);
  out.push("");
  out.push("## component 依赖图");
  out.push("");
  out.push("**红色虚线 = 参与组间成环的边。**");
  out.push("");
  out.push("```mermaid");
  out.push("graph LR");
  for (const c of comps) {
    const n = [...g.modules].filter((m) => owner(m) === c).length;
    out.push(`  ${c}["${c}<br/>${n}"]`);
  }
  for (const key of [...compEdges].sort()) {
    const [a, b] = key.split("|");
    out.push(cyclic.has(key) ? `  ${a} -.->|环| ${b}` : `  ${a} --> ${b}`);
  }
  out.push("```");
  out.push("");
  out.push("## 组的职责");
  out.push("");
  for (const c of comps) {
    const spec = manifest.component[c];
    out.push(`### ${c}`);
    out.push("");
    out.push(spec.why ?? "");
    out.push("");
    out.push("路径：" + (spec.paths ?? []).map((p) => `\`${p}\``).join("、"));
    out.push("");
  }
  return out.join("\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
