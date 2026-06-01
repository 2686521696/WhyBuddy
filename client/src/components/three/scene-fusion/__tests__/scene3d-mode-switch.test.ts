/**
 * Scene3D / blueprint-vs-mission-first 模式切换的源码级护栏测试。
 *
 * 这条护栏沿用同目录已验证的模式（`blueprint-wall-process-data.test.ts` /
 * `blueprint-wall-process-graph-hud.test.tsx`）：直接用 `node:fs` 从磁盘读取
 * `Scene3D.tsx` 的源文件文本做精确断言，而不在 jsdom 里真正 import `Scene3D`。
 *
 * 原因：`Scene3D` 会拉起完整的 R3F `<Canvas>` + GLTF + drei 技术栈，这套依赖在
 * jsdom / SSR 环境中既重又脆；源码级读取是更稳健、且已被两个兄弟护栏测试证明可行
 * 的做法。
 *
 * 锁定的模式切换边界（Req 1.1 / 1.2 / 10.1 / NFR-2.5）：
 *  - mission-first 分支仍静态 import 并渲染 `SandboxMonitor`。
 *  - blueprint 分支通过懒加载 / 动态 `import()` 引用 `BlueprintWallProcessGraphHud`，
 *    而**不是**顶层静态 import。
 *  - blueprint 分支不挂载 `SandboxMonitor`（全文件只有一处 `<SandboxMonitor` 渲染，
 *    位于 mission-first else 分支）。
 *  - mission-first / `/tasks` bundle 路径上的 `Scene3D` 源码不静态 import
 *    `@ant-design/graphs`（重型图渲染依赖只能经由 blueprint chunk 的动态 import 进入）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("Scene3D / blueprint-vs-mission-first mode switch (source guards)", () => {
  // 解析被测组件源文件路径：测试位于
  // client/src/components/three/scene-fusion/__tests__/，
  // 向上三级（scene-fusion -> three -> components）即可定位 Scene3D.tsx。
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../Scene3D.tsx"),
    "utf8"
  );

  // 去掉注释后的源码：Scene3D.tsx 的 JSDoc 里**记录**了「不在顶层 import
  // { BlueprintWallProcessGraphHud } from ...」「不静态 import @ant-design/graphs」
  // 这两条护栏，因此直接对整段源码做 includes / 正则会误命中这些文档文字。剥离行注释
  // `// ...` 与块注释 `/* ... */`（含 `/** ... */`）后再检查实际代码，既保留强保证，
  // 又不会被护栏文档误伤。
  const codeWithoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("mission-first 路径仍静态 import 并渲染 SandboxMonitor（Req 1.2 / 1.1）", () => {
    // mission-first 分支必须保持既有沙箱监控墙面：顶层静态 import + JSX 渲染。
    expect(source.includes("import { SandboxMonitor }")).toBe(true);
    expect(source.includes("<SandboxMonitor")).toBe(true);
  });

  it("blueprint 路径经由动态 import() 懒加载 BlueprintWallProcessGraphHud（Req 1.1 / 10.1）", () => {
    // 组件被引用，且引用方式是对 ./three/scene-fusion/BlueprintWallProcessGraphHud
    // 的动态 import()（而非顶层静态 import），并包在 lazy() 中形成代码分割边界。
    expect(source.includes("BlueprintWallProcessGraphHud")).toBe(true);
    expect(
      /import\(\s*["']\.\/three\/scene-fusion\/BlueprintWallProcessGraphHud["']\s*\)/.test(
        source
      )
    ).toBe(true);
    expect(/lazy\(/.test(source)).toBe(true);
  });

  it("blueprint 分支不挂载 SandboxMonitor，模式分支存在（Req 1.1 / 1.2）", () => {
    // 模式分支条件存在。
    expect(source.includes('mode === "blueprint"')).toBe(true);
    // 不得有顶层静态 `import { BlueprintWallProcessGraphHud }`——它必须是 lazy 动态
    // 引入。注意 JSDoc 里以反引号记录了这段文字，故针对剥离注释后的代码检查。
    expect(
      codeWithoutComments.includes("import { BlueprintWallProcessGraphHud }")
    ).toBe(false);
    // 全文件只有一处 `<SandboxMonitor` JSX 渲染，且它位于 mission-first（else）分支；
    // blueprint 分支渲染的是 `<BlueprintWallProcessGraphHud>`，不会重复挂载沙箱监控。
    expect((source.match(/<SandboxMonitor/g) || []).length).toBe(1);
  });

  it("mission-first bundle 路径不静态 import @ant-design/graphs（Req 10.1 / NFR-2.5）", () => {
    // 唯一允许的引用方式是经由动态 import("./three/scene-fusion/BlueprintWallProcessGraphHud")
    // 的 chunk（该 chunk 内部才 import graphs），从而让 @ant-design/graphs 不进入
    // mission-first 的静态依赖图。针对剥离注释后的代码检查，避免命中 JSDoc 里记录该护栏
    // 的文档文字。
    expect(
      /import\s+[^;]*from\s+["']@ant-design\/graphs["']/.test(codeWithoutComments)
    ).toBe(false);
    expect(
      /import\s+["']@ant-design\/graphs["']/.test(codeWithoutComments)
    ).toBe(false);
  });

  it("blueprint 分支把 blueprintLocale 透传给 HUD 的 locale prop（Fix 2，Req 5 本地化）", () => {
    // Scene3DProps 暴露 blueprintLocale（AppLocale），blueprint 分支把它作为 HUD 的
    // locale 透传，使 en-US 页面墙面文案不再回退 deriver 的 zh-CN 默认。
    expect(codeWithoutComments.includes("blueprintLocale?: AppLocale")).toBe(true);
    expect(codeWithoutComments).toContain("locale={blueprintLocale}");
    // AppLocale 类型已 import（type-only 即可）。
    expect(
      /import\s+type\s+\{\s*AppLocale\s*\}\s+from\s+["']@\/lib\/locale["']/.test(
        codeWithoutComments
      )
    ).toBe(true);
  });
});
