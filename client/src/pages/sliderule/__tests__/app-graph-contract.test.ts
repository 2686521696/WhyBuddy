/**
 * 图的边**词汇表**只有一份：shared/app-graph/edge-contract.json（2026-08-17）。
 *
 * 这张网在两个运行时里各推一遍——本目录的 sandbox-graph.ts 画沙盘 + 断线体检，
 * slide-rule-python/services/app_graph.py 在生成链路上算影响面。两份实现是有
 * 理由的（用途和运行时都不同），但**边的词汇表不能各定一套**：同一份模型在
 * 前端画出来是通的、后端算影响面时却是断的，而这种不一致不会报错。
 *
 * ⚠ 这条判据必须**两边都有**。只在 Python 侧钉，TS 这边加一种边照样绿——
 *   而那正是漂移开始的地方。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { deriveSandboxGraph } from "../system-screens/sandbox-graph";

interface EdgeSpec {
  kind: string;
  displayLabel: string;
  pythonLabels: string[];
}

const contract = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../../shared/app-graph/edge-contract.json"), "utf8")
) as { edges: EdgeSpec[]; rules: Record<string, any> };

/** 一份能把六种边都跑出来的模型：字段绑定、装配流程、审批人、可进入、AIGC 读写与可用角色。 */
const MODEL = {
  datamodel: {
    entities: [{ id: "wo", name: "工单", fields: [{ id: "amt", name: "金额", type: "string" }] }],
  },
  page: {
    pages: [{ id: "p1", name: "工单页", fieldBindings: ["wo.amt"], actionPermissions: ["wo:read"] }],
  },
  rbac: {
    roles: ["mgr"],
    permissions: ["wo:read"],
    menus: [{ id: "m1", label: "工单", roleRefs: ["mgr"], permissionRefs: ["wo:read"] }],
  },
  workflow: { nodes: [{ id: "n1", name: "提交", assigneeRole: "mgr" }] },
  aigc: { capabilities: [{ id: "c1", name: "摘要", inputFields: ["wo.amt"], outputField: "wo.amt", roleRefs: ["mgr"] }] },
  appbundle: { pageBindings: [{ pageRef: "p1", workflowRef: "n1" }] },
} as any;

describe("图的边词汇表跟契约对齐", () => {
  it("契约里每种边这边都产得出", () => {
    const g = deriveSandboxGraph(MODEL);
    expect(g).not.toBeNull();
    const produced = new Set((g!.edges ?? []).map((e) => e.kind));
    const missing = contract.edges.map((s) => s.kind).filter((k) => !produced.has(k));
    expect(missing, `契约里这些边这边没产出：${missing.join("、")}`).toEqual([]);
  });

  it("不许产出契约外的边", () => {
    const g = deriveSandboxGraph(MODEL);
    const allowed = new Set(contract.edges.map((s) => s.kind));
    const extra = [...new Set((g!.edges ?? []).map((e) => e.kind))].filter((k) => !allowed.has(k));
    expect(extra, `这些边不在契约里：${extra.join("、")}——加边要先写进契约`).toEqual([]);
  });

  it("角色权限的口径以 menus 为准，跟契约一致", () => {
    // ⚠ 这条是契约存在的直接原因：TS 走 menus、Python 第一版走 rolePermissions，
    //   而真机里后者恒空——两边对"这个角色能进哪些页"得出完全不同的答案。
    const rule = contract.rules["role-perms-intersect-page-actions"];
    expect(rule.roleHeldPermissions.authoritative).toContain("menus");

    // 行为判据：只给 rolePermissions、不给 menus 时，这边不该判出可进入。
    const noMenus = {
      ...MODEL,
      rbac: { roles: ["mgr"], permissions: ["wo:read"], rolePermissions: { mgr: ["wo:read"] } },
    } as any;
    const g = deriveSandboxGraph(noMenus);
    expect((g!.edges ?? []).filter((e) => e.kind === "role-page")).toEqual([]);
  });

  it("公共页不画角色→页面（否则是角色×页面全连接）", () => {
    const pub = {
      ...MODEL,
      page: { pages: [{ id: "p1", name: "公共页", fieldBindings: ["wo.amt"] }] },
    } as any;
    const g = deriveSandboxGraph(pub);
    expect((g!.edges ?? []).filter((e) => e.kind === "role-page")).toEqual([]);
  });
});
