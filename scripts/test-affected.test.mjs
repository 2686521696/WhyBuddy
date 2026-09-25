// 选择器的判据：在**真仓库**上跑产线 plan()，回放真实存在过的依赖。
// 选漏是静默的（CLAUDE.md §3），所以每一路来源各钉一条会漏的真例子。
// 把 test-affected.mjs 里对应的那一路删掉，对应那条变红。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, plan, pyImpactedTests, trackedFiles } from "./test-affected.mjs";

const files = trackedFiles();
const readText = f => readFileSync(path.join(ROOT, f), "utf8");
const planFor = (...changed) => plan(changed, { files, readText });

test("跨语言读：改 Python 的叙述表，带上读它的前端测试", () => {
  // shared/blueprint/__tests__/spec-first-labels.test.ts 按路径读 turn_narration.py，
  // 两者之间没有任何 import——vitest related 和 testmon 都选不到它。
  const p = planFor("slide-rule-python/services/turn_narration.py");
  assert.ok(p.server.extra.has("shared/blueprint/__tests__/spec-first-labels.test.ts"));
  assert.equal(p.python.testmon, true);
});

test("读源码的接线测试：改 SlideRule.tsx，带上按路径读它的测试", () => {
  // turn-result-card.test.ts 的「通电」那组用 readFileSync 读 SlideRule.tsx 原文。
  const p = planFor("client/src/pages/SlideRule.tsx");
  assert.ok(p.client.related.has("client/src/pages/SlideRule.tsx"));
  assert.ok(p.client.extra.has("client/src/pages/sliderule/__tests__/turn-result-card.test.ts"));
});

test("跨语言入口：改被 Node 拼字符串 __import__ 的适配器，带上两头钉它的测试", () => {
  const p = planFor("slide-rule-python/services/web_aigc_open_adapter.py");
  assert.ok(p.python.extra.has("slide-rule-python/tests/test_cross_language_entrypoints.py"));
});

test("数据文件：改阶段账本 JSON，testmon 看不见，沿读它的模块反查到测试", () => {
  const p = planFor("slide-rule-python/services/data/pipeline_stages.json");
  assert.equal(p.python.testmon, false);
  // 这条测试 import stage_legal（读账本的模块），自己不读这个 JSON——
  // 只有「数据文件 → 读它的模块 → import 闭包」这一路能选到它。
  assert.ok(p.python.extra.has("slide-rule-python/tests/test_product_steps_come_from_the_ledger.py"));
  assert.ok(p.server.extra.has("shared/blueprint/__tests__/spec-first-labels.test.ts"));
  for (const t of p.python.extra) assert.match(path.basename(t), /^test_/, "只选能单独跑的 test_*.py");
});

test("import 闭包：函数体里的 import 也算（真机漏过的那条）", () => {
  // ⚠ 2026-09-25：复用开发服务器排在版本校验前的回归，是全量里
  //   test_project_live_source_sync 抓到的。它经由夹具间接用到 worker。
  const selected = pyImpactedTests(["services.project_runtime_worker"], files, readText);
  assert.ok(selected.has("slide-rule-python/tests/test_project_live_source_sync.py"));
});

test("反向：只改一个测试文件，只跑它自己，不拉 testmon 全量", () => {
  const p = planFor("slide-rule-python/tests/test_one_dev_server_per_project.py");
  assert.equal(p.python.testmon, false);
  assert.deepEqual([...p.python.extra], ["slide-rule-python/tests/test_one_dev_server_per_project.py"]);
  assert.equal(p.client.related.size + p.client.extra.size + p.server.extra.size, 0);
});
