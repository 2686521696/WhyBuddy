/**
 * 技能目录的通道/绑定数据完整性（2026-07-27）。
 *
 * featured-skills.json 里每条技能的 channel 决定它进推演时走哪条 prompt 路径，
 * binding 决定要不要给模型形状提示。这份数据是手工判定（docs/skills-triage.jsonl）
 * 落下来的，最容易腐化的方式是新增技能时忘了标 channel、或给 aigc 通道标了一个
 * 类型闭集之外的 binding——两种都不会报错，只会在真推演时变成门禁失败。
 */
import { describe, it, expect } from "vitest";

import featuredSkills from "@/data/featured-skills.json";
import {
  channelOf,
  installedSkillsDrivePayload,
  SKILL_CHANNELS,
} from "../installed-skills";

interface Row {
  id: string;
  channel?: string;
  binding?: { inputTypes: string[]; outputType: string };
}
const ITEMS = (featuredSkills as { items: Row[] }).items;

/** 与 slide-rule-python/services/data/five_system_legal.json 的 fieldTypes 同一闭集。 */
const FIELD_TYPES = ["string", "number", "date", "ref", "enum", "text"];

describe("技能目录的消费通道", () => {
  it("每条技能都标了 channel，且取值在闭集内", () => {
    expect(ITEMS.length).toBeGreaterThan(0);
    for (const it of ITEMS) {
      expect(
        SKILL_CHANNELS.includes(it.channel as never),
        `${it.id} 的 channel=${it.channel} 不在闭集内`
      ).toBe(true);
    }
  });

  it("aigc 通道必须带 binding —— 说不出读写什么形状的，就不该发硬要求", () => {
    const aigc = ITEMS.filter(i => i.channel === "aigc");
    expect(aigc.length).toBeGreaterThan(0);
    for (const it of aigc) {
      expect(it.binding, `${it.id} 走 aigc 通道却没有 binding`).toBeTruthy();
      expect(it.binding!.inputTypes.length).toBeGreaterThan(0);
    }
  });

  it("binding 的类型全部落在 fieldTypes 闭集内", () => {
    for (const it of ITEMS) {
      if (!it.binding) continue;
      for (const t of it.binding.inputTypes) {
        expect(FIELD_TYPES, `${it.id} inputTypes 含闭集外类型 ${t}`).toContain(t);
      }
      expect(
        FIELD_TYPES,
        `${it.id} outputType 含闭集外类型 ${it.binding.outputType}`
      ).toContain(it.binding.outputType);
    }
  });

  it("非 aigc 通道不带 binding —— 带了就是在暗示一个不存在的硬契约", () => {
    for (const it of ITEMS) {
      if (it.channel === "aigc") continue;
      expect(it.binding, `${it.id} 是 ${it.channel} 通道却带了 binding`).toBeUndefined();
    }
  });

  it("哨兵：已下架的开发者工具类技能不得回流", () => {
    const ids = new Set(ITEMS.map(i => i.id));
    // 抽查下架清单里最典型的几条（部署/Git/CLI/技术栈规范/MCP 开发）
    for (const gone of [
      "gh-cli",
      "git-commit",
      "mcp-builder",
      "react-best-practices",
      "webapp-testing",
      "obsidian-cli",
    ]) {
      expect(ids.has(gone), `${gone} 又回到技能目录里了`).toBe(false);
    }
  });
});

describe("channelOf 的降级", () => {
  it("未标注/非法 channel 一律 unbound", () => {
    expect(channelOf({})).toBe("unbound");
    expect(channelOf({ channel: "quantum" })).toBe("unbound");
    expect(channelOf({ channel: "aigc" })).toBe("aigc");
    expect(channelOf({ channel: "experience" })).toBe("experience");
  });
});

describe("推演注入载荷", () => {
  it("localStorage 不可用时返回空数组，不抛", () => {
    expect(() => installedSkillsDrivePayload()).not.toThrow();
    expect(Array.isArray(installedSkillsDrivePayload())).toBe(true);
  });
});
