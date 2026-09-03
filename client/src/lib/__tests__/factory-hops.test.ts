/**
 * 工厂 hop 人话 → 唯一工具名。跟 Python closed_tools.factory_hop_from_text
 * 同一把尺子。
 */
import { describe, expect, it } from "vitest";

import {
  FACTORY_HOP_LABELS,
  factoryCapabilityId,
  factoryHopFromText,
  hopFromFactoryCapability,
  looksLikeFactoryHopCommand,
} from "../factory-hops";

describe("factoryHopFromText", () => {
  it("收尾卡标签是唯一一跳", () => {
    expect(factoryHopFromText("进入数据模型反推（Structure）")).toBe(
      "structure"
    );
    expect(factoryHopFromText("进入权限绑定（bind）")).toBe("bind");
    expect(factoryHopFromText("直接执行闭环发布（closure）")).toBe("closure");
    expect(factoryHopFromText("直接执行闭环发布")).toBe("closure");
    expect(factoryHopFromText("继续画页面")).toBe("pages");
  });

  it("新产品名即使带闭环发布也不认成 hop", () => {
    expect(factoryHopFromText("闭环发布管理系统")).toBeUndefined();
    expect(factoryHopFromText("做一个闭环发布管理系统")).toBeUndefined();
    expect(looksLikeFactoryHopCommand("闭环发布管理系统")).toBe(false);
    expect(looksLikeFactoryHopCommand("给社区图书馆做借还书系统")).toBe(false);
  });

  it("多跳句子是 hop 指令，但没有唯一 forcedTool", () => {
    const text = "继续进行数据模型反推（structure）与权限绑定（bind）";
    expect(factoryHopFromText(text)).toBeUndefined();
    expect(looksLikeFactoryHopCommand(text)).toBe(true);
  });

  it("账本身份按 hop 分开，不是共用信封", () => {
    expect(factoryCapabilityId("structure")).toBe("factory.structure");
    expect(hopFromFactoryCapability("factory.structure")).toBe("structure");
    expect(hopFromFactoryCapability("appbundle.runtimeClosure")).toBeUndefined();
    expect(FACTORY_HOP_LABELS.structure).toContain("数据模型");
  });
});
