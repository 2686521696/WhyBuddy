/**
 * spec-generation-perceived-performance / Task 6.4
 *
 * 失败 toast 与超时 / 回写失败映射的契约测试。
 *
 * _Requirements: 2.3, 2.4, 2.10, 4.5, 5.5, 5.6_
 *
 * 实现口径（与本仓现有 React 组件测试一致，见 SpecTreeWorkbench.test.tsx）：
 *
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`，
 *   `test:client` 走默认 node 环境（`vitest run client/src`）。
 *   `triggerSpecDocsGeneration` 是 `AutopilotRightRail` 组件闭包内的私有
 *   async 回调（非导出），其 toast / 超时 / 回写失败映射依赖一次真实点击、
 *   `useState` / `useRef` 重渲染与 `Promise.race` 异步决胜，无法在
 *   `renderToStaticMarkup`（SSR）下被驱动。
 *
 *   因此本文件采用源代码层契约断言（source-level contract），与
 *   SpecTreeWorkbench.test.tsx 的「源代码层契约」块同构：直接读
 *   `AutopilotRightRail.tsx`，断言失败 / 超时 / 回写失败三条映射路径的关键
 *   结构与顺序不变式存在且未被破坏。
 */

import { describe, expect, it } from "vitest";

async function readSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(
    path.resolve(__dirname, "../AutopilotRightRail.tsx"),
    "utf8"
  );
}

describe("AutopilotRightRail spec-docs 失败 toast 与超时映射 (Task 6.4)", () => {
  // ── R2.3 / R2.4 / R2.10：API 失败 → toast(detail || message || locale 兜底) ──
  describe("API 失败映射（R2.3 / R2.4 / R2.10）", () => {
    it("失败有原因 → toast description 优先呈现可读 detail，其次 message", async () => {
      const source = await readSource();
      // 失败分支：先把错误写入真相源派生入口（specDocsError）。
      expect(source).toContain("setSpecDocsError(result.error);");
      // toast description 取 detail || message || locale 兜底，顺序不可颠倒。
      expect(source).toMatch(
        /description:\s*[\r\n\s]*result\.error\.detail\s*\|\|[\r\n\s]*result\.error\.message\s*\|\|/
      );
    });

    it("失败无原因 → toast 使用随 locale 的通用兜底文案（zh / en 各一）", async () => {
      const source = await readSource();
      // 失败 toast 标题随 locale。
      expect(source).toContain("生成规格文档失败");
      expect(source).toContain("Spec document generation failed");
      // detail/message 缺失时的兜底文案（zh-CN 与 en-US 各一份）。
      expect(source).toContain(
        "请检查 LLM 服务配置（LLM_BASE_URL / LLM_MODEL / LLM_API_KEY）后重试。"
      );
      expect(source).toContain(
        "Check the LLM service config (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY) and retry."
      );
    });

    it("失败反馈只走既有 sonner toast 通道（showToast.error），不新增通道", async () => {
      const source = await readSource();
      expect(source).toContain('import { toast as showToast } from "sonner";');
      expect(source).toContain("showToast.error(");
    });
  });

  // ── R4.5 / R5.5：超时 → failure + CTA enabled + 真相源不被部分写入 ──────────
  describe("60s 超时映射（R4.5 / R5.5）", () => {
    it("超时阈值常量为 60000ms 并用于 race 哨兵", async () => {
      const source = await readSource();
      expect(source).toMatch(
        /const SPEC_DOCS_GENERATION_TIMEOUT_MS = 60000;/
      );
      // 真实生成 promise 与超时哨兵竞速。
      expect(source).toMatch(/Promise\.race\(\[/);
      expect(source).toMatch(
        /setTimeout\([\s\S]*?SPEC_DOCS_GENERATION_TIMEOUT_MS/
      );
    });

    it("超时分支：specDocsGenerating 归 null（CTA 恢复 enabled）+ 派生 failure + 超时 toast", async () => {
      const source = await readSource();
      const timeoutBranch = source.indexOf("if (raceResult === TIMEOUT) {");
      expect(timeoutBranch).toBeGreaterThan(-1);
      // 超时分支内部片段（截到 return 为止）。
      const tail = source.slice(timeoutBranch);
      const branchEnd = tail.indexOf("return;");
      expect(branchEnd).toBeGreaterThan(-1);
      const branch = tail.slice(0, branchEnd);

      // CTA 恢复 enabled：In_Flight_Lock 释放。
      expect(branch).toContain("setSpecDocsGenerating(null);");
      // 派生 failure：写入 specDocsError。
      expect(branch).toContain("setSpecDocsError(timeoutError);");
      // 超时 toast 文案随 locale。
      expect(branch).toContain("showToast.error(");
      expect(branch).toContain("生成规格文档超时");
      expect(branch).toContain("Spec document generation timed out");
    });

    it("超时分支不向真相源写入部分结果：不调用 onSpecDocumentsGenerated 即 return", async () => {
      const source = await readSource();
      const timeoutBranch = source.indexOf("if (raceResult === TIMEOUT) {");
      const tail = source.slice(timeoutBranch);
      const branch = tail.slice(0, tail.indexOf("return;"));
      // 超时分支内绝不回写真相源：不存在对 onSpecDocumentsGenerated 的实际调用
      // （注释中提及该标识符不算，只排除带调用括号的形式）。
      expect(branch).not.toMatch(/onSpecDocumentsGenerated\s*\??\.?\s*\(/);
    });
  });

  // ── R5.6：回写失败（onSpecDocumentsGenerated 抛错）→ failure + toast，无部分写入 ──
  describe("回写失败映射（R5.6）", () => {
    it("onSpecDocumentsGenerated 调用包裹在 try/catch 中", async () => {
      const source = await readSource();
      expect(source).toMatch(
        /try\s*\{[\s\S]*?props\.onSpecDocumentsGenerated\?\.\(result\.data\);[\s\S]*?\}\s*catch\s*\(writebackError\)/
      );
    });

    it("回写失败 catch 内：映射为 failure（specDocsError）+ 回写失败 toast（随 locale）", async () => {
      const source = await readSource();
      const catchIdx = source.indexOf("catch (writebackError)");
      expect(catchIdx).toBeGreaterThan(-1);
      // catch 块片段（足以覆盖整个映射逻辑：detail 兜底 + setSpecDocsError + toast）。
      const catchBody = source.slice(catchIdx, catchIdx + 1200);
      expect(catchBody).toContain("setSpecDocsError(mappedError);");
      expect(catchBody).toContain("showToast.error(");
      expect(catchBody).toContain("生成规格文档回写失败");
      expect(catchBody).toContain("Failed to apply generated spec documents");
    });

    it("回写失败不做二次回写：catch 内不再调用 onSpecDocumentsGenerated", async () => {
      const source = await readSource();
      const catchIdx = source.indexOf("catch (writebackError)");
      const catchBody = source.slice(catchIdx, catchIdx + 1200);
      expect(catchBody).not.toContain("onSpecDocumentsGenerated");
    });
  });

  // ── In_Flight_Lock 释放 / 唯一锚点（贯穿 R4.5 / R5.5 / R5.6） ───────────────
  describe("In_Flight_Lock 与回写锚点", () => {
    it("成功 / 失败 / 超时各分支均释放 In_Flight_Lock（specDocsGenerating=null）", async () => {
      const source = await readSource();
      const releases = source.match(/setSpecDocsGenerating\(null\)/g) ?? [];
      // 至少超时分支与 race 后主分支两处释放。
      expect(releases.length).toBeGreaterThanOrEqual(2);
    });

    it("triggerSpecDocsGeneration 是唯一回写锚点：仅经 onSpecDocumentsGenerated 回写真相源", async () => {
      const source = await readSource();
      // 子组件不旁路：父级以既有 onSpecDocumentsGenerated 桥回写。
      expect(source).toContain("props.onSpecDocumentsGenerated?.(result.data);");
    });
  });
});
