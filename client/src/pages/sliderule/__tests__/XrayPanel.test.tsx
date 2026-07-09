/**
 * 方向 B（应用主舞台 + X 光）回归：
 * - derivePageXray 纯函数：home 全景切片 / 具体页面切片（主实体、可见角色、流程、AI）
 * - SlideRuleStudio 三态：无模型 → board（六系统缩略在场，无应用舞台）
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { derivePageXray, describeXrayTarget, XrayPanel } from "../XrayPanel";
import { deriveAppRuntimeSchema } from "../live-runtime/app-runtime-schema";
import { SlideRuleStudio } from "../SlideRuleStudio";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      { id: "pet", name: "宠物档案", fields: [{ id: "name", name: "昵称" }, { id: "species", name: "物种" }] },
      { id: "booking", name: "预约单", fields: [{ id: "date", name: "档期" }] },
    ],
  },
  rbac: {
    roles: ["owner", "host"],
    permissions: ["pet:read", "pet:create"],
    menus: [
      { id: "m1", label: "宠物", roleRefs: ["owner"], permissionRefs: ["pet:read", "pet:create"] },
      { id: "m2", label: "预约", roleRefs: ["host"], permissionRefs: ["booking:read"] },
    ],
  },
  workflow: {
    nodes: [
      { id: "n1", name: "提交申请", assigneeRole: "owner" },
      { id: "n2", name: "审核", assigneeRole: "host" },
    ],
    transitions: [{ from: "n1", to: "n2" }],
  },
  page: {
    pages: [
      { id: "pet_page", name: "宠物档案页", fieldBindings: ["pet.name", "pet.species"], actionPermissions: ["pet:read", "pet:create"] },
    ],
  },
  aigc: {
    capabilities: [
      { id: "cap1", name: "生成护理建议", inputFields: ["pet.species"], outputField: "pet.name" },
    ],
  },
  appbundle: { pageBindings: [{ pageRef: "pet_page", workflowRef: "boarding_flow" }] },
};

describe("derivePageXray", () => {
  const schema = deriveAppRuntimeSchema(MODEL, "测试应用")!;

  it("home → 全景切片：五系统各一节，条目非空", () => {
    const xray = derivePageXray(MODEL, schema, "home");
    expect(xray.pageTitle).toContain("全景");
    const bySkill = Object.fromEntries(xray.sections.map((s) => [s.skill, s]));
    expect(bySkill.dataModel.items.join()).toContain("宠物档案");
    expect(bySkill.workflow.items).toContain("提交申请");
    expect(bySkill.rbac.items.join()).toContain("owner");
    expect(bySkill.page.items.length).toBeGreaterThan(0);
    expect(bySkill.aigc.items).toContain("生成护理建议");
  });

  it("具体页面 → 主实体/可见角色/绑定流程/AI 动作如实透视", () => {
    const xray = derivePageXray(MODEL, schema, "pet_page");
    const bySkill = Object.fromEntries(xray.sections.map((s) => [s.skill, s]));
    expect(bySkill.dataModel.items.join()).toContain("宠物档案");
    // 只有持有 pet:read/pet:create 的 owner 能看到本页；host 不能
    expect(bySkill.rbac.items).toContain("owner");
    expect(bySkill.rbac.items).not.toContain("host");
    // appbundle.pageBindings 绑了 boarding_flow
    expect(bySkill.workflow.items.join()).toContain("boarding_flow");
    // AI 动作写回 pet.name
    expect(bySkill.aigc.items.join()).toContain("生成护理建议");
  });

  it("XrayPanel 静态渲染：面板 + 各节 + 联动总图入口", () => {
    const html = renderToStaticMarkup(
      <XrayPanel model={MODEL} schema={schema} activePageId="pet_page" onOpenSystem={() => {}} />
    );
    expect(html).toContain('data-testid="sliderule-xray-panel"');
    expect(html).toContain('data-testid="xray-section-dataModel"');
    expect(html).toContain('data-testid="xray-section-appBundle"');
    expect(html).toContain("宠物档案页");
  });
});

describe("describeXrayTarget（元素级 AR 焦点解读）", () => {
  const schema = deriveAppRuntimeSchema(MODEL, "测试应用")!;

  it("field → 实体.字段 + 页面绑定 + AI 读写", () => {
    const d = describeXrayTarget(MODEL, { kind: "field", entityId: "pet", fieldId: "species", label: "物种" });
    expect(d.skill).toBe("dataModel");
    expect(d.title).toContain("宠物档案");
    expect(d.title).toContain("物种");
    expect(d.lines.join()).toContain("宠物档案页"); // 被本页绑定
    expect(d.lines.join()).toContain("生成护理建议"); // AI 读取 pet.species
  });

  it("action → 权限声明 + 当前角色判定 + 持有角色", () => {
    const d = describeXrayTarget(MODEL, {
      kind: "action", label: "新建", pageId: "pet_page",
      permission: "pet:create", granted: false, role: "host",
    });
    expect(d.skill).toBe("rbac");
    expect(d.lines.join()).toContain("pet:create");
    expect(d.lines.join()).toContain("host 未持有");
    expect(d.lines.join()).toContain("owner"); // 持有角色
  });

  it("menu → 页面声明 + 可见角色；ai → 输入/写回", () => {
    const m = describeXrayTarget(MODEL, { kind: "menu", pageId: "pet_page", label: "宠物档案页" });
    expect(m.skill).toBe("page");
    expect(m.lines.join()).toContain("owner");
    const a = describeXrayTarget(MODEL, { kind: "ai", capId: "cap1", label: "生成护理建议" });
    expect(a.skill).toBe("aigc");
    expect(a.lines.join()).toContain("pet.species");
    expect(a.lines.join()).toContain("pet.name");
  });

  it("XrayPanel 带 target 渲染 AR 焦点卡", () => {
    const html = renderToStaticMarkup(
      <XrayPanel
        model={MODEL}
        schema={schema}
        activePageId="pet_page"
        target={{ kind: "field", entityId: "pet", fieldId: "name", label: "昵称" }}
        onOpenSystem={() => {}}
      />
    );
    expect(html).toContain('data-testid="xray-focus"');
    expect(html).toContain("昵称");
  });
});

describe("SlideRuleStudio 三态舞台", () => {
  it("无模型（空会话）→ board：六系统缩略在场，无应用舞台", () => {
    const html = renderToStaticMarkup(
      <SlideRuleStudio chatSlot={<div />} activeSkillId={null} />
    );
    expect(html).toContain("AppBundle"); // 缩略条
    expect(html).not.toContain('data-testid="sliderule-app-stage"');
    expect(html).not.toContain('data-testid="sliderule-xray-toggle"');
  });
});
