/**
 * 代码投影（代码视图一期）测试。
 * 锁：确定性投影内容——DDL 的 enum CHECK、TS union、状态机链路、RBAC 常量、
 * 页面范式骨架、AIGC 接口与编排、README 不变式清单；缺段文件如实缺席；
 * 中文 id 净化为合法标识符；CodeProjectionView 静态渲染。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveCodeProjection } from "../live-runtime/code-projection";
import { CodeProjectionView } from "../live-runtime/CodeProjectionView";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "customer",
        name: "客户",
        fields: [
          { id: "id", name: "编号", type: "string" },
          { id: "name", name: "客户名称", type: "string" },
          {
            id: "deal_amount",
            name: "成交金额",
            type: "number",
            format: "money",
          },
          {
            id: "status",
            name: "跟进状态",
            type: "enum",
            options: [
              { id: "待跟进", tone: "warning" },
              { id: "已成交", tone: "success" },
            ],
          },
        ],
      },
    ],
  },
  rbac: {
    roles: ["sales", "manager"],
    permissions: ["customer:create"],
    menus: [
      {
        id: "m1",
        label: "客户",
        roleRefs: ["sales"],
        permissionRefs: ["customer:create"],
      },
    ],
  },
  workflow: {
    id: "wf_follow",
    name: "跟进主链路",
    nodes: [
      { id: "n_new", name: "新建", assigneeRole: "sales", phase: "录入" },
      { id: "n_ok", name: "成交", assigneeRole: "manager", phase: "收口" },
    ],
    transitions: [{ from: "n_new", to: "n_ok", condition: "确认成交" }],
    chains: [
      {
        id: "chain_money",
        name: "回款",
        kind: "money",
        nodes: [{ id: "m_pay", name: "回款确认", assigneeRole: "manager" }],
        transitions: [],
      },
    ],
  },
  page: {
    pages: [
      {
        id: "p_board",
        name: "跟进看板",
        kind: "kanban",
        statusField: "customer.status",
        fieldBindings: ["customer.name", "customer.status"],
        actionPermissions: ["customer:create"],
        stats: [
          {
            id: "s1",
            name: "成交总额",
            entity: "customer",
            metric: "sum:customer.deal_amount",
            format: "money",
          },
        ],
      },
    ],
  },
  aigc: {
    capabilities: [
      {
        id: "cap_summary",
        name: "跟进摘要",
        inputFields: ["customer.name"],
        outputField: "customer.status",
        roleRefs: ["sales"],
      },
    ],
    pipelines: [
      { id: "pipe_1", name: "摘要链", steps: ["cap_summary", "cap_summary"] },
    ],
  },
  appbundle: {
    pageBindings: [{ pageRef: "p_board", workflowRef: "wf_follow" }],
    roleRefs: ["sales"],
    dataModelRefs: ["customer"],
    invariants: [
      {
        id: "inv1",
        statement: "成交金额只能由回款确认节点写入",
        systems: ["workflow"],
        refs: ["m_pay"],
      },
    ],
  },
};

describe("deriveCodeProjection", () => {
  const files = deriveCodeProjection(MODEL, "轻量 CRM");
  const byPath = Object.fromEntries(files.map(f => [f.path, f.content]));

  it("七个文件齐全，均带只读投影头注", () => {
    expect(files.map(f => f.path)).toEqual([
      "README.md",
      "db/schema.sql",
      "src/types.ts",
      "src/workflow.ts",
      "src/rbac.ts",
      "src/pages.tsx",
      "src/aigc.ts",
    ]);
    for (const f of files) {
      expect(f.content).toContain("确定性投影");
    }
  });

  it("DDL：enum 取值落成 CHECK；format/展示名进注释", () => {
    const sql = byPath["db/schema.sql"];
    expect(sql).toContain("CREATE TABLE customer (");
    expect(sql).toContain("CHECK (status IN ('待跟进', '已成交'))");
    expect(sql).toContain("deal_amount NUMERIC");
    expect(sql).toContain("format=money");
  });

  it("类型：enum 取值落成 union；实体名 PascalCase", () => {
    const ts = byPath["src/types.ts"];
    expect(ts).toContain("export interface Customer {");
    expect(ts).toContain('status: "待跟进" | "已成交";');
    expect(ts).toContain("deal_amount: number;");
  });

  it("状态机：主链路 + 附加链路（kind/phase/condition 保留）", () => {
    const wf = byPath["src/workflow.ts"];
    expect(wf).toContain("主链路：跟进主链路");
    expect(wf).toContain('assigneeRole: "sales"');
    expect(wf).toContain('condition: "确认成交"');
    expect(wf).toContain("附加链路：回款");
    expect(wf).toContain('kind: "money"');
  });

  it("RBAC：角色/权限/菜单授予常量", () => {
    const rbac = byPath["src/rbac.ts"];
    expect(rbac).toContain('"sales"');
    expect(rbac).toContain('"customer:create"');
    expect(rbac).toContain("export const MENUS");
  });

  it("页面骨架：kanban 范式 + KPI 注释；AIGC：接口 + 编排", () => {
    const pages = byPath["src/pages.tsx"];
    expect(pages).toContain("范式：kanban");
    expect(pages).toContain('<KanbanBoard statusField="customer.status" />');
    expect(pages).toContain("KPI：成交总额");
    const aigc = byPath["src/aigc.ts"];
    expect(aigc).toContain("export async function cap_summary(");
    expect(aigc).toContain('"customer.name": string;');
    expect(aigc).toContain("写回目标：customer.status");
    expect(aigc).toContain("export const pipe_1");
  });

  it("README：规模统计 + 不变式验收清单", () => {
    const readme = byPath["README.md"];
    expect(readme).toContain("# 轻量 CRM");
    expect(readme).toContain("1 实体 · 1 页面 · 1 项 AI 能力");
    expect(readme).toContain("- [ ] 成交金额只能由回款确认节点写入");
  });

  it("缺段文件如实缺席；空模型返回空数组；投影确定性（两次相同）", () => {
    const partial = deriveCodeProjection({
      datamodel: MODEL.datamodel,
      page: { pages: [] },
    } as FiveSystemModel);
    expect(partial.map(f => f.path)).toEqual([
      "README.md",
      "db/schema.sql",
      "src/types.ts",
    ]);
    expect(deriveCodeProjection(null)).toEqual([]);
    expect(deriveCodeProjection(MODEL, "轻量 CRM")).toEqual(files);
  });

  it("中文/非法 id 净化为合法标识符（原文保留在注释/字面量）", () => {
    const weird = deriveCodeProjection({
      datamodel: {
        entities: [
          {
            id: "客户档案",
            name: "客户档案",
            fields: [{ id: "姓名", name: "姓名", type: "string" }],
          },
        ],
      },
      page: { pages: [] },
    } as FiveSystemModel);
    const sql = weird.find(f => f.path === "db/schema.sql")!.content;
    expect(sql).toMatch(/CREATE TABLE [A-Za-z_][A-Za-z0-9_]* \(/);
    expect(sql).not.toMatch(/CREATE TABLE 客户档案/);
    expect(sql).toContain("-- 客户档案");
  });
});

describe("CodeProjectionView 渲染", () => {
  it("文件列表 + 只读说明 + 代码面板", () => {
    const html = renderToStaticMarkup(
      <CodeProjectionView model={MODEL} appName="轻量 CRM" />
    );
    expect(html).toContain('data-testid="app-runtime-code"');
    expect(html).toContain('data-testid="code-file-db/schema.sql"');
    expect(html).toContain("确定性投影（只读，非 LLM 生成）");
    // 默认展示第一个文件（README）——代码面板里是它的内容
    expect(html).toContain("# 轻量 CRM");
  });

  it("空模型如实空态", () => {
    const html = renderToStaticMarkup(
      <CodeProjectionView model={{} as FiveSystemModel} />
    );
    expect(html).toContain("还没有可投影的五系统模型");
  });
});
