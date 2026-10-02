import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishButtonState } from "../project-runtime/publication-client";
import {
  deriveDetailFromAppRecord,
  mergeGalleryItems,
} from "../../agent-loop/dashboard/AppsWorkbench";
import { forkApp, publishedProjectId, type AppStoreSummary } from "../../agent-loop/dashboard/app-store-client";

/**
 * ⚠ 2026-10-01 用户审查应用市场：结果卡上的「发布」恒为 disabled「发布通道尚未接通」，市场里只有老 HTML 推演。
 *   发布通道：通过交付验收的这一版上架（截图 + 源码），别人复刻那一版；判定在服务端，前端只照实说能不能点。
 */
describe("结果卡的发布按钮", () => {
  const fresh = { published: false, appId: null, revision: null, stale: false };
  it("没过交付验收（或还不知道）不能点，并说清楚为什么", () => {
    for (const delivered of [false, null, undefined]) {
      const state = publishButtonState(delivered, fresh);
      expect(state.enabled).toBe(false);
      expect(state.title).toContain("通过交付验收之后");
    }
  });
  it("过了验收能发；发过就是「已发布」；之后又改了是「发布新版」", () => {
    expect(publishButtonState(true, fresh)).toMatchObject({ label: "发布", enabled: true });
    expect(publishButtonState(true, { ...fresh, published: true, appId: "a" })).toMatchObject({ label: "已发布", enabled: false });
    expect(publishButtonState(true, { ...fresh, published: true, appId: "a", stale: true }))
      .toMatchObject({ label: "发布新版", enabled: true });
  });
  it("接在链路上：卡片画的是 PublishButton，不再是那个恒 disabled 的按钮", () => {
    const src = readFileSync(new URL("../TurnResultCard.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/<PublishButton projectId=\{publishProjectId \?\? null\} delivered=\{delivered\}/);
    expect(src).not.toContain("发布通道尚未接通");
    const page = readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8");
    expect(page).toContain("publishProjectId={turn.id === ctx.verdictTurnId ? ctx.projectId : null}");
  });
});

describe("市场里发布的网页工程卡", () => {
  // 形状照后端 publish_project 落的那一行（dedup_key = project:<id>，model_json.projectSnapshot）
  const summary = {
    id: "app-1", root_id: "app-1", parent_id: null, version: 1, session_id: "sr-cafe", goal: "社区咖啡店会员招募落地页",
    gate_passed: true, created_at: "2026-10-01T00:00:00Z", product_name: "社区咖啡店会员招募落地页", theme_id: "",
    theme_label: "", device: "desktop", landing_page_ref: "", entity_count: 0, page_count: 0, role_count: null,
    ai_count: null, owner_id: "alice", visibility: "public", has_preview: true,
    dedup_key: "project:prj-cafe",
  } as unknown as AppStoreSummary;

  it("认得出是网页工程，归到「网页工程」，封面走发布时那张截图", () => {
    expect(publishedProjectId(summary)).toBe("prj-cafe");
    const [item] = mergeGalleryItems([summary], []);
    expect([item.source, item.workKind, item.projectId, item.hasPreview]).toEqual(["app", "web", "prj-cafe", true]);
    expect(publishedProjectId({ dedup_key: "sess:abc" })).toBeNull();          // 反向：老推演卡不是
  });

  it("预览画截图，不把工程指针当五系统模型渲染", () => {
    const detail = deriveDetailFromAppRecord({
      projectSnapshot: { projectId: "prj-cafe", revision: "prv-1", templateVersion: "whybuddy-react-vite-1" },
      appbundle: { appIdentity: { productName: "社区咖啡店" }, preferredDevice: "desktop" },
    });
    // 在线打开之前发布的卡快照里没有 site：只能看截图，不假装能跑（published-site-frame.test.tsx）
    expect(detail.publishedSnapshot).toEqual({ projectId: "prj-cafe", revision: "prv-1", onlineOpen: false, siteUnavailable: null });
    expect(detail.model).toBeNull();
    expect(detail.status).toBe("runnable");
  });
});

describe("复刻发布的网页工程", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("后端只回会话（不另起应用记录）也算复刻成功", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: null, sessionId: "project-fork-1", projectId: "prj-2" }))));
    await expect(forkApp("app-1")).resolves.toEqual({ id: undefined, sessionId: "project-fork-1" });
  });
  it("反向：两样都没有就是失败", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}))));
    await expect(forkApp("app-1")).resolves.toBeNull();
  });
});
