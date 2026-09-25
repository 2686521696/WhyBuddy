import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  humanReasoningStepLabel,
  SPEC_FIRST_LIVE_LABELS,
} from "../spec-first-labels.js";

describe("spec-first 人话（Actions name vs id）", () => {
  it("内部 id 不许漏到左栏", () => {
    expect(humanReasoningStepLabel("specfirst.design")).toBe(
      "定这个应用的设计语言"
    );
    expect(humanReasoningStepLabel("specfirst.design")).not.toMatch(
      /specfirst\./
    );
    expect(humanReasoningStepLabel("intent.parse")).toBe("正在理解你的目标");
  });

  it("SSE 已经是人话时不再套「正在执行」", () => {
    expect(humanReasoningStepLabel("定这个应用的设计语言")).toBe(
      "定这个应用的设计语言"
    );
    expect(humanReasoningStepLabel("定这个应用的设计语言")).not.toContain(
      "正在执行"
    );
  });

  it("未知点号 id 才回落正在执行", () => {
    expect(humanReasoningStepLabel("unknown.cap")).toBe("正在执行 unknown.cap");
  });

  it("工厂 hop 账本身份翻人话，不许 factory.structure 上脸", () => {
    expect(humanReasoningStepLabel("factory.structure")).toBe(
      "从界面反推数据模型与关联关系"
    );
    expect(humanReasoningStepLabel("factory.structure")).not.toMatch(
      /factory\./
    );
    expect(humanReasoningStepLabel("factory.pages")).toBe(
      "逐页画界面（并发）"
    );
    expect(humanReasoningStepLabel("factory.closure")).toBe(
      "完整性检查与发布闭环"
    );
  });

  it("Python 那份键这里都有——漏一个就是下一处漏词", () => {
    const py = readFileSync(
      fileURLToPath(
        new URL(
          "../../../slide-rule-python/services/turn_narration.py",
          import.meta.url
        )
      ),
      "utf8"
    );
    // ⚠ 2026-09-25：上一版在 turn_narration.py 里 grep 字面键。08-30 那张表
    //   改成从阶段账本派生（stage_legal.labels() 按 specfirst. 过滤），源码里
    //   一个字面键都没了，keys=0，判据在 main 上一直红。现在分两段钉：
    //   ① Python 叙述表确实取自账本；② 账本里每个 specfirst.* 这边都有人话。
    const code = py
      .replace(/^\s*#.*$/gm, "")
      .replace(/"""[\s\S]*?"""/g, "");
    const block = code.slice(
      code.indexOf("_SPEC_FIRST_LABELS"),
      code.indexOf("_SKILL_LABELS")
    );
    expect(block, "叙述表不再取自阶段账本——下面读账本就钉不住它了").toMatch(
      /_stage_labels\(\)[\s\S]*startswith\("specfirst\."\)/
    );
    const ledger = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../slide-rule-python/services/data/pipeline_stages.json",
            import.meta.url
          )
        ),
        "utf8"
      )
    );
    const keys = Object.keys(ledger.stages ?? {}).filter(k =>
      k.startsWith("specfirst.")
    );
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      expect(SPEC_FIRST_LIVE_LABELS[key], `缺 ${key}`).toBeTruthy();
    }
  });
});
