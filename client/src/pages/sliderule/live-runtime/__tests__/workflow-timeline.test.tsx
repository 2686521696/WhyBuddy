import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperienceBlockBoundary } from "../block-registry";
import type { ExperienceBlockInstance } from "../block-registry";

/**
 * WorkflowTimeline 区块渲染哨兵（2026-07-27）。
 *
 * 补的是一个真空白：这个渲染器 07-23 就接了真实 workflow 数据，却一直零
 * 测试覆盖——因为生成侧 prompt 有一句"渲染器还没上线，不要输出
 * page.blocks"的禁令，它实际上从没被渲染过，坏了也没人会发现。现在目录
 * 把 WorkflowTimeline 的 generationEnabled 放开（灰度第一个），补齐覆盖
 * 再上路。
 *
 * 锁三件事：节点从 workflow 系统机械派生（不接受自由文案）、chainRef 选
 * 链路、无数据时诚实空态（不白屏也不编节点）。
 */

const WORKFLOW = {
  nodes: [
    { id: "submit", name: "提交申请", assigneeRole: "requester" },
    { id: "review", name: "主管审批", assigneeRole: "manager" },
    { id: "done", name: "归档" },
  ],
  transitions: [
    { from: "submit", to: "review" },
    { from: "review", to: "done", condition: "金额 ≤ 5000" },
  ],
  chains: [
    { id: "fast_chain", name: "快速通道", nodes: [{ id: "auto", name: "自动放行" }], transitions: [] },
  ],
};

function block(props: Record<string, unknown> = {}): ExperienceBlockInstance {
  return { id: "wf1", type: "WorkflowTimeline", props } as ExperienceBlockInstance;
}

function render(props: Record<string, unknown>, workflow: unknown): string {
  return renderToStaticMarkup(
    <ExperienceBlockBoundary
      block={block(props)}
      workflow={workflow as never}
    />
  );
}

const nodeCount = (html: string) =>
  (html.match(/data-testid="workflow-timeline-node"/g) ?? []).length;

describe("WorkflowTimeline 渲染", () => {
  it("chainRef 留空时渲染主链路全部节点，顺序与 workflow 一致", () => {
    const html = render({ title: "审批流程" }, WORKFLOW);
    expect(nodeCount(html)).toBe(3);
    expect(html.indexOf("提交申请")).toBeLessThan(html.indexOf("主管审批"));
    expect(html.indexOf("主管审批")).toBeLessThan(html.indexOf("归档"));
    expect(html).toContain("审批流程");
  });

  it("节点文案只来自 workflow 系统：角色与流转条件如实透出", () => {
    const html = render({}, WORKFLOW);
    expect(html).toContain("requester");
    expect(html).toContain("manager");
    expect(html).toContain("金额 ≤ 5000");
  });

  it("chainRef 指定时只渲染那条链路，不混主链路节点", () => {
    const html = render({ chainRef: "fast_chain" }, WORKFLOW);
    expect(nodeCount(html)).toBe(1);
    expect(html).toContain("自动放行");
    expect(html).not.toContain("提交申请");
  });

  it("没有 workflow 数据时给诚实空态，不白屏、不编节点", () => {
    const html = render({}, undefined);
    expect(html).toContain('data-testid="workflow-timeline-empty"');
    expect(nodeCount(html)).toBe(0);
  });

  it("链路存在但节点为空时同样走空态", () => {
    const html = render(
      { chainRef: "fast_chain" },
      { ...WORKFLOW, chains: [{ id: "fast_chain", name: "空链", nodes: [], transitions: [] }] }
    );
    expect(html).toContain('data-testid="workflow-timeline-empty"');
    expect(nodeCount(html)).toBe(0);
  });
});
