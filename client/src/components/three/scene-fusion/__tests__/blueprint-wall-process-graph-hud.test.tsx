/**
 * BlueprintWallProcessGraphHud / 源码级 import 护栏测试。
 *
 * 这条护栏沿用同目录数据 spec 测试 `blueprint-wall-process-data.test.ts` 中已验证的
 * 模式：直接用 `node:fs` 从磁盘读取被测组件的源文件文本，对 import 语句做精确断言，
 * 而不在 jsdom / SSR 中真正 import 这个重型组件（它静态依赖 `@ant-design/graphs` /
 * G6，渲染开销大且在测试环境中易碎）。
 *
 * 锁定的可视层边界（Req 2.1 / 3.1 / 3.7 / 10.2-10.4）：
 *  - 组件必须 import `@ant-design/graphs`（FlowGraph 渲染器）。
 *  - 组件必须 import `deriveBlueprintWallProcessData`（唯一图数据源）。
 *  - 组件整段源码不得出现 `useSandboxStore`（不得读 mission-first 沙箱状态）。
 *  - 组件不得 import 可视组件 `SandboxMonitor` / `MissionWallTaskPanel`（模式隔离）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("BlueprintWallProcessGraphHud / source-level import guards", () => {
  // 从测试文件位置解析被测组件的源文件路径：__tests__ 目录的上一级即组件所在目录。
  const moduleSource = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../BlueprintWallProcessGraphHud.tsx"
    ),
    "utf8"
  );

  // 仅抽取 import 语句相关的行做精确检查，避免对正文 / 注释里出现的同名词产生误报。
  // 收集两类行：以 `import` 开头的行，以及包含 `from "..."` / `from '...'` 的行
  // （覆盖多行 import 的 `} from "..."` 收尾行）。
  const importLines = moduleSource
    .split("\n")
    .filter(
      (line) =>
        line.trim().startsWith("import") || /\bfrom\s+["']/.test(line)
    );
  const importsText = importLines.join("\n");

  // 去掉注释后的源码：本组件在 JSDoc 里**记录**了「不得读取 useSandboxStore」这条护栏，
  // 因此直接对整段源码做 `includes("useSandboxStore")` 会误命中这条文档注释。剥离
  // 行注释 `// ...` 与块注释 `/* ... */`（含 JSX `{/* ... */}`）后再检查实际代码，
  // 既保留「代码中任意位置都不得出现该标识符」的强保证，又不会被护栏文档误伤。
  const codeWithoutComments = moduleSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("imports the FlowGraph renderer from \"@ant-design/graphs\"（Req 2.1 / 10.2）", () => {
    // 可视层 spec 明确允许 @ant-design/graphs：FlowGraph 是图渲染器。
    expect(/from\s+["']@ant-design\/graphs["']/.test(importsText)).toBe(true);
  });

  it("imports deriveBlueprintWallProcessData from the deriver（Req 3.1 / 10.3）", () => {
    // 唯一图数据源：组件必须引用同目录的纯数据 deriver。该 import 是多行写法，
    // deriveBlueprintWallProcessData 标识符单独成行，因此对整段源码与 import 路径
    // 分别断言（importsText 只收 `import` 起始行与 `from "..."` 行，会漏掉中间标识符行）。
    expect(moduleSource.includes("deriveBlueprintWallProcessData")).toBe(true);
    expect(
      /from\s+["']\.\/blueprint-wall-process-data["']/.test(importsText)
    ).toBe(true);
  });

  it("整个模块源码不出现 useSandboxStore 标识符（Req 3.7 / 10.4）", () => {
    // useSandboxStore 既不应被 import，也不应在实际代码任何位置出现——blueprint 墙面图
    // 不得读取 mission-first 沙箱状态作为内容来源（避免跨 job 残留）。剥离注释后检查，
    // 避免命中组件 JSDoc 中**记录该护栏**的文档文字。
    expect(importsText.includes("useSandboxStore")).toBe(false);
    expect(codeWithoutComments.includes("useSandboxStore")).toBe(false);
  });

  it("不 import 可视组件 SandboxMonitor / MissionWallTaskPanel（Req 3.7 / 模式隔离）", () => {
    // 模式隔离：blueprint 墙面图组件不应引用 mission-first 墙面设备组件。
    // 检查 import 语句行即可（这两个标识符不会在 import 行以子串形式误命中其它符号）。
    expect(importsText.includes("SandboxMonitor")).toBe(false);
    expect(importsText.includes("MissionWallTaskPanel")).toBe(false);
  });
});

describe("BlueprintWallProcessGraphHud / Task 6.2 live-data + viewport wiring (source guards)", () => {
  // 与上方同源：直接读组件源文件文本做精确断言，不渲染 live FlowGraph
  // （它需要真实 canvas，在 node 测试环境中无法完整渲染——沿用本目录既有 source-guard
  // 约定）。锁定 Task 6.2 把骨架空图升级为「映射后真实数据 + 自定义节点卡片 + 视口配置」
  // 这套接线（Req 2.6 / 2.7 / 3.1-3.3 / 5.1-5.7 / 9.1-9.9）。
  const moduleSource = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../BlueprintWallProcessGraphHud.tsx"
    ),
    "utf8"
  );

  it("把 mapWallDataToFlowGraph(...) 的输出作为 <FlowGraph data> 唯一数据源（Req 3.1/3.2/3.3）", () => {
    // 引用映射器，并以 wallData（deriver 输出）为输入映射。
    expect(moduleSource.includes("mapWallDataToFlowGraph")).toBe(true);
    expect(moduleSource).toMatch(/mapWallDataToFlowGraph\(\s*wallData\s*\)/);
    // 映射结果作为 data 透传给 FlowGraph（Fix 3：空态不再走 EMPTY_GRAPH_DATA，而是
    // 直接 gate 掉 `<FlowGraph>`，因此 data 恒为映射结果 flowGraph.data）。
    expect(moduleSource).toContain("data={flowGraph.data}");
    // graphData 源自映射结果 flowGraph.data（非空时）。
    expect(moduleSource).toContain("flowGraph.data");
  });

  it("把自定义节点卡片 BlueprintWallGraphNodeCard 接到 FlowGraph 的 react 节点渲染（Req 5.1-5.7）", () => {
    // 引用节点卡片组件，并通过 node 配置接入 FlowGraph。
    expect(moduleSource.includes("BlueprintWallGraphNodeCard")).toBe(true);
    // FlowGraph 默认 react 节点：node.style.component 回调。
    expect(moduleSource).toContain('type: "react"');
    expect(moduleSource).toContain("component:");
    expect(moduleSource).toContain("node={nodeConfig}");
    // preview 节点把 previewSummary 透传给卡片（Req 5.5/3.6）。
    expect(moduleSource).toContain("previewSummary");
  });

  it("初次渲染 autoFit，job 变化后命令式重新 fitView（Req 2.6 / 9.5）", () => {
    // 初始铺满取景。
    expect(moduleSource).toContain('autoFit="view"');
    // job/数据变化后经 ref 命令式补一次 fitView（依赖映射结果的 effect）。
    expect(moduleSource).toMatch(/useEffect\(/);
    expect(moduleSource).toContain("fitView");
    // effect 依赖映射结果，job-scoped 输入变化即重新 fit。
    expect(moduleSource).toMatch(/\}, \[flowGraph\]\)/);
  });

  it("约束 min/max 缩放并禁用画布内编辑交互（Req 2.7 / 9.2-9.4 / 9.7）", () => {
    expect(moduleSource).toContain("zoomRange={BLUEPRINT_WALL_ZOOM_RANGE}");
    // Task 1.4 spike 锁定：画布内 pan/zoom 与一切编辑/连边交互禁用（空 behaviors）。
    expect(moduleSource).toContain("behaviors={[]}");
  });

  it("禁用内建 dagre 自动布局，节点保留 mapper 写入的固定坐标（Req 2.8）", () => {
    expect(moduleSource).toContain("layout={BLUEPRINT_WALL_FLOW_GRAPH_LAYOUT}");
  });

  it("空态下完全不挂载 <FlowGraph>（Fix 3：gate 在 !isEmpty 之后，避免空 data 仍初始化 G6）", () => {
    // 空态分支直接渲染 null，非空才渲染 FlowGraph：`{isEmpty ? null : (<FlowGraph ...`。
    expect(moduleSource).toMatch(/isEmpty\s*\?\s*null\s*:\s*\(\s*<FlowGraph/);
    // 不再保留旧的 EMPTY_GRAPH_DATA 常量 / 三元（空 data 不能阻止 BaseGraph 挂载）。
    expect(moduleSource).not.toContain("EMPTY_GRAPH_DATA");
    expect(moduleSource).not.toContain("data={graphData}");
  });
});
