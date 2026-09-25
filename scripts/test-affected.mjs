#!/usr/bin/env node
// 按改动选测试。改代码时跑这个；推送前 / CI 照旧全量兜底（见下）。
//
//   node scripts/test-affected.mjs                 看计划：工作区相对 HEAD 的改动
//   node scripts/test-affected.mjs --base origin/main   相对某个基线
//   node scripts/test-affected.mjs --run           照计划跑
//   node scripts/test-affected.mjs --run a.py b.ts 指定改动文件
//
// 四路来源，缺一路就会静默漏选（CLAUDE.md §3「闸全绿但东西没了」）：
//
//   ① Python 代码 → pytest-testmon。它按 Coverage 记下每条测试**真执行过**的代码，
//      拼字符串的动态 import 也算在内。第一次跑是全量，用来建库（.testmondata）。
//   ② 前端 / shared / server → vitest related（vitest 自己的模块图）。
//   ③ 「读文件」边：测试按路径打开源码 / 数据文件做检查（Python 164 个、前端 135 个
//      测试文件这么干）。它们跟被读的文件之间**没有 import**，①② 都看不见。
//      这里扫测试里写死的路径字面量补上。跨语言的读（前端测试读 turn_narration.py、
//      pipeline_stages.json）也走这一路。
//   ④ 跨语言入口：server/index.ts 按拼出来的字符串 __import__ 的 Python 适配器，
//      两侧静态分析都看不见。architecture.toml 里归类为 cross_language_entry 的
//      模块一改，就带上两头钉它们的 tests/test_cross_language_entrypoints.py。
//   另：Python 源码读的数据文件（services/data/*.json）一改，testmon 不知道——
//      找出读它的源码模块，沿 import 图（函数体里的 import 也算）反查到测试。
//
// ⚠ 选择是**优化**，不是闸。选漏了没有任何提示：选中的全绿，该红的那条根本没跑。
//   所以推送前 / CI 全量不能省（pytest -n 4 并行，见 CLAUDE.md 常用命令）。
//   判据：scripts/test-affected.test.mjs 回放历史上真漏过 / 真抓到的改动。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PY_ROOT = "slide-rule-python";
const PATH_LITERAL = /["'`]([^"'`\s]*?\.(?:py|ts|tsx|mjs|cjs|js|json|toml|md|html|css|sql|ya?ml))["'`]/g;

const isPyTest = f => f.startsWith(`${PY_ROOT}/tests/`) && f.endsWith(".py");
// 能交给 pytest 单独跑的只有 test_*.py；conftest / *_support 这类辅助模块改了，
// 用到它的测试由 testmon 按执行轨迹带上（它追踪测试目录里的项目代码）。
const isPyRunnable = f => isPyTest(f) && path.posix.basename(f).startsWith("test_");
const isPySource = f => f.startsWith(`${PY_ROOT}/`) && f.endsWith(".py") && !isPyTest(f)
  && !f.includes("/.venv/");
const isTsTest = f => /\.(test|spec)\.(ts|tsx|mjs|js)$/.test(f) || /\/__tests__\//.test(f);
const isClientFile = f => f.startsWith("client/");
const isServerSideTs = f => f.startsWith("shared/") || f.startsWith("server/");
const isTsSource = f => /\.(ts|tsx|mjs|js)$/.test(f) && !isTsTest(f)
  && (isClientFile(f) || isServerSideTs(f));

export function trackedFiles(root = ROOT) {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n").filter(Boolean);
}

export function changedFiles({ base = null, root = ROOT } = {}) {
  const run = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const set = new Set([
    ...run(["diff", "--name-only", base ? `${base}...HEAD` : "HEAD"]),
    ...(base ? run(["diff", "--name-only", "HEAD"]) : []),
    ...run(["ls-files", "--others", "--exclude-standard"]),
  ]);
  return [...set].sort();
}

/** 字面量 → 仓里的文件。带斜杠按路径后缀匹配，不带按文件名匹配；多配是安全的。 */
export function resolveLiteral(literal, files, byBase) {
  const clean = literal.replace(/\\/g, "/").replace(/^(?:\.\.?\/)+/, "");
  if (!clean.includes("/")) return byBase.get(clean) || [];
  return files.filter(f => f === clean || f.endsWith("/" + clean));
}

/** 测试文件 → 它按路径读的仓内文件（③）。 */
export function readEdges(testFiles, files, readText) {
  const byBase = new Map();
  for (const f of files) {
    const base = path.posix.basename(f);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(f);
  }
  const edges = new Map(); // 被读的文件 → Set(测试)
  for (const test of testFiles) {
    let text;
    try { text = readText(test); } catch { continue; }
    for (const m of text.matchAll(PATH_LITERAL)) {
      for (const target of resolveLiteral(m[1], files, byBase)) {
        if (target === test) continue;
        if (!edges.has(target)) edges.set(target, new Set());
        edges.get(target).add(test);
      }
    }
  }
  return edges;
}

const PY_IMPORT = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;

function pyModuleName(file) {
  return file.slice(PY_ROOT.length + 1, -3).replace(/\//g, ".").replace(/\.__init__$/, "");
}

/** Python 反向依赖闭包：改了这些模块，谁（含函数体里 import 的）会受影响。 */
export function pyImpactedTests(changedModules, files, readText) {
  const sources = files.filter(isPySource);
  const tests = files.filter(isPyTest);
  const known = new Set(sources.map(pyModuleName));
  const importsOf = file => {
    const out = new Set();
    let text; try { text = readText(file); } catch { return out; }
    for (const m of text.matchAll(PY_IMPORT)) {
      const name = m[1] || m[2];
      for (let parts = name.split("."); parts.length; parts.pop()) {
        const candidate = parts.join(".");
        if (known.has(candidate)) { out.add(candidate); break; }
      }
    }
    return out;
  };
  const reverse = new Map();
  for (const src of sources) {
    for (const dep of importsOf(src)) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(pyModuleName(src));
    }
  }
  const impacted = new Set(changedModules);
  const stack = [...changedModules];
  while (stack.length) {
    for (const up of reverse.get(stack.pop()) || []) {
      if (!impacted.has(up)) { impacted.add(up); stack.push(up); }
    }
  }
  // 测试辅助模块（tests/*_support.py、别的测试文件当夹具）一层展开。
  const testByModule = new Map(tests.map(t => [path.posix.basename(t, ".py"), t]));
  const selected = new Set();
  for (const test of tests) {
    let text; try { text = readText(test); } catch { continue; }
    const names = [...text.matchAll(PY_IMPORT)].map(m => m[1] || m[2]);
    const direct = names.some(n => [...impacted].some(mod => n === mod || n.startsWith(mod + ".")));
    const viaHelper = names.some(n => testByModule.has(n) && [...importsOf(testByModule.get(n))].some(mod => impacted.has(mod)));
    if (direct || viaHelper) selected.add(test);
  }
  return selected;
}

export function crossLanguageEntries(readText) {
  let toml; try { toml = readText(`${PY_ROOT}/architecture.toml`); } catch { return new Set(); }
  const out = new Set();
  for (const m of toml.matchAll(/^"([\w.]+)"\s*=\s*"cross_language_entry"/gm)) {
    out.add(`${PY_ROOT}/${m[1].replace(/\./g, "/")}.py`);
  }
  return out;
}

/** 计划本身是纯函数：给定改动与仓内文件，算出要跑什么。 */
export function plan(changed, { files, readText }) {
  const testFiles = files.filter(f => isPyTest(f) || isTsTest(f));
  const edges = readEdges(testFiles, files, readText);
  const result = {
    arch: changed.some(f => isPySource(f) || isTsSource(f) || f.endsWith("architecture.toml")
      || f === "architecture.ts.json"),
    python: { testmon: changed.some(f => isPySource(f) || (isPyTest(f) && !isPyRunnable(f))), extra: new Set() },
    client: { related: new Set(), extra: new Set() },
    server: { related: new Set(), extra: new Set() },
    scripts: new Set(),
  };
  const addTest = t => {
    if (isPyTest(t)) { if (isPyRunnable(t)) result.python.extra.add(t); }
    else if (t.startsWith("scripts/")) result.scripts.add(t);
    else if (isClientFile(t)) result.client.extra.add(t);
    else if (isServerSideTs(t)) result.server.extra.add(t);
  };
  const crossEntries = crossLanguageEntries(readText);
  const dataReaders = new Set();
  for (const f of changed) {
    if (isPyTest(f) || isTsTest(f)) addTest(f);
    if (isTsSource(f)) (isClientFile(f) ? result.client : result.server).related.add(f);
    for (const t of edges.get(f) || []) addTest(t);
    if (crossEntries.has(f)) addTest(`${PY_ROOT}/tests/test_cross_language_entrypoints.py`);
    // Python 源码读的非代码文件：testmon 看不见，交给 import 闭包。
    if (!f.endsWith(".py") && f.startsWith(`${PY_ROOT}/`)) {
      const base = path.posix.basename(f);
      for (const src of files.filter(isPySource)) {
        let text; try { text = readText(src); } catch { continue; }
        if (text.includes(base)) dataReaders.add(pyModuleName(src));
      }
    }
  }
  if (dataReaders.size) for (const t of pyImpactedTests([...dataReaders], files, readText)) addTest(t);
  return result;
}

function sh(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  return spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" }).status ?? 1;
}

function main(argv) {
  const run = argv.includes("--run");
  const baseAt = argv.indexOf("--base");
  const base = baseAt >= 0 ? argv[baseAt + 1] : null;
  const explicit = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--base");
  const changed = explicit.length ? explicit : changedFiles({ base });
  const files = trackedFiles();
  const known = new Set(files);
  for (const f of changed) if (!known.has(f) && existsSync(path.join(ROOT, f))) files.push(f);
  const p = plan(changed, { files, readText: f => readFileSync(path.join(ROOT, f), "utf8") });
  const list = s => [...s].sort();
  console.log(JSON.stringify({ changed, arch: p.arch,
    python: { testmon: p.python.testmon, extra: list(p.python.extra) },
    client: { related: list(p.client.related), extra: list(p.client.extra) },
    server: { related: list(p.server.related), extra: list(p.server.extra) },
    scripts: list(p.scripts) }, null, 2));
  if (!run) return 0;
  let failed = 0;
  const py = `${PY_ROOT}/.venv/bin/python`;
  if (p.arch) {
    failed |= sh(py, [`${PY_ROOT}/arch_graph.py`, "--check"]);
    failed |= sh("node", ["scripts/arch-graph-ts.mjs", "--check"]);
  }
  if (p.python.testmon) failed |= sh(py, ["-m", "pytest", "--testmon", "-q", "-p", "no:cacheprovider", `${PY_ROOT}/tests`]);
  if (p.python.extra.size) failed |= sh(py, ["-m", "pytest", "-q", "-p", "no:cacheprovider", ...list(p.python.extra)]);
  const abs = s => list(s).map(f => path.join(ROOT, f));
  if (p.client.related.size) failed |= sh("npx", ["vitest", "related", "--run", ...abs(p.client.related)]);
  if (p.client.extra.size) failed |= sh("npx", ["vitest", "run", ...abs(p.client.extra)]);
  if (p.server.related.size) failed |= sh("npx", ["vitest", "related", "--run", "--config", "vitest.config.server.ts", ...abs(p.server.related)]);
  if (p.server.extra.size) failed |= sh("npx", ["vitest", "run", "--config", "vitest.config.server.ts", ...abs(p.server.extra)]);
  if (p.scripts.size) failed |= sh("node", ["--test", ...list(p.scripts)]);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  process.exit(main(process.argv.slice(2)));
}
