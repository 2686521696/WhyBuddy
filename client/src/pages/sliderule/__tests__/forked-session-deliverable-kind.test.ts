/**
 * 复刻出来的会话还没有自己的计划时，交付类别跟源会话走。
 *
 * ⚠ 2026-09-30 用户点名「Fork 这种逻辑」：办公工程复刻后，新会话的 controlTranscript 只有一行
 *   project_forked（Python ProjectSourceOperations.fork），latestPlanDeliverableKind 只认 plan_written，
 *   于是按网页工程画右栏——拷过去的 PPT 看不到。行的形状照 Python 那边写的原样。
 * 把 latestPlanDeliverableKind 里认 project_forked 那一支删掉，第一条变红。
 */
import { describe, expect, it } from "vitest";
import { latestPlanDeliverableKind, OFFICE_FILE, WEB_APP } from "../deliverable-kind";

const forked = (deliverableKind: string) => ({
  kind: "project_forked",
  sourceProjectId: "prj-src",
  sourceRevision: "prv-1",
  deliverableKind,
  officeFiles: ["output/新员工入职培训.pptx"],
});

describe("复刻会话的交付类别", () => {
  it("办公工程的复刻，没写新计划之前就是办公交付", () => {
    expect(latestPlanDeliverableKind([forked("office-file")])).toBe(OFFICE_FILE);
  });

  it("复刻之后自己写了新计划，以新计划为准", () => {
    expect(
      latestPlanDeliverableKind([forked("office-file"), { kind: "plan_written", deliverableKind: "web-app" }])
    ).toBe(WEB_APP);
  });

  it("反向：网页工程的复刻照旧是网页；没有类别的老复刻行也不猜成办公", () => {
    expect(latestPlanDeliverableKind([forked("web-app")])).toBe(WEB_APP);
    expect(latestPlanDeliverableKind([{ kind: "project_forked", sourceProjectId: "p" }])).toBe(WEB_APP);
  });
});
