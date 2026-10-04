/**
 * 会话卡片摘要（Python 保存时算）与前端原推导 `deriveAppCardDetail(整份会话)` 必须逐字段一致。
 *
 * ⚠ 2026-10-04：「我的应用」原来每张会话卡挂载就 GET /sessions/{sid} 拉整包推状态/指标
 *   （本地复现首屏 99 条、9.0 MB、最后一条 23 s）。现在 GET /sessions 带着摘要，卡片不再拉。
 *   摘要是 Python 写的，推导原来是 TS 写的——本仓第四条「Python 判定 / TS 运行时」成对物。
 *   两边钉在同一份金样上：slide-rule-python/tests/fixtures/session_card_parity.json，
 *   expected 由 Python 算出（tests/test_session_card.py 钉住），这里证明 TS 原推导得出同一张卡。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  deriveAppCardDetail,
  deriveDetailFromSessionCard,
  detailWithoutNetwork,
  mergeGalleryItems,
  type AppCardDetail,
  type SessionListItem,
} from "../AppsWorkbench";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(here, "../../../../../../slide-rule-python/tests/fixtures/session_card_parity.json"), "utf8"),
) as { cases: Array<{ name: string; state: unknown; expected: unknown }> };

/** 卡片不画这两样本体（会话卡点击直接进会话），比对时去掉。 */
function cardFields(detail: AppCardDetail | null) {
  if (!detail) return detail;
  const { model: _model, specPages: _specPages, ...rest } = detail;
  return rest;
}

describe("会话卡片摘要与前端原推导同一张卡", () => {
  it("金样有足够的覆盖（防止有人把用例删空，判据空转）", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(15);
    const statuses = new Set(fixture.cases.map(c => (c.expected as { status: string }).status));
    expect(statuses).toEqual(new Set(["runnable", "awaiting", "draft"]));
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      const fromState = cardFields(deriveAppCardDetail(c.state));
      const fromCard = cardFields(deriveDetailFromSessionCard(c.expected));
      expect(fromCard).not.toBeNull();
      expect(fromCard).toEqual(fromState);
    });
  }
});

describe("摘要不认识就退回老路，不画一张猜出来的卡", () => {
  const good = fixture.cases[1].expected as Record<string, unknown>;
  it("版本不对 → null", () => {
    expect(deriveDetailFromSessionCard({ ...good, v: 2 })).toBeNull();
  });
  it("状态不在三档里 → null", () => {
    expect(deriveDetailFromSessionCard({ ...good, status: "closed" })).toBeNull();
  });
  it("缺摘要 / 非对象 → null", () => {
    expect(deriveDetailFromSessionCard(undefined)).toBeNull();
    expect(deriveDetailFromSessionCard("{}")).toBeNull();
  });
});

describe("摘要真的接到了卡片上（不是只有函数对）", () => {
  it("mergeGalleryItems 把会话列表的 card 带到会话卡上", () => {
    const card = fixture.cases[1].expected as SessionListItem["card"];
    const items = mergeGalleryItems([], [
      { sessionId: "sr-a", goal: "带摘要", artifactCount: 1, card },
      { sessionId: "sr-b", goal: "没摘要", artifactCount: 1 },
    ]);
    expect(items.find(i => i.sessionId === "sr-a")?.card).toEqual(card);
    expect(items.find(i => i.sessionId === "sr-b")?.card).toBeUndefined();
  });
});

describe("带摘要的会话卡不打网络", () => {
  const card = fixture.cases[1].expected as SessionListItem["card"];
  it("有摘要 → 直接给详情；没摘要 / 摘要不认识 → undefined（调用方去拉整包）", () => {
    expect(detailWithoutNetwork({ source: "session", card })).toEqual(deriveDetailFromSessionCard(card));
    expect(detailWithoutNetwork({ source: "session" })).toBeUndefined();
    expect(detailWithoutNetwork({ source: "session", card: { ...card!, v: 99 } })).toBeUndefined();
  });

  it("ensureDetail 真的先问 detailWithoutNetwork，再决定 fetch（剥注释后看源码）", () => {
    const src = readFileSync(resolve(here, "../AppsWorkbench.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const body = src.slice(src.indexOf("const ensureDetail = React.useCallback"));
    const head = body.slice(0, body.indexOf("}, []);"));
    const ask = head.indexOf("detailWithoutNetwork(gi)");
    const fetchAt = head.indexOf("fetch(`/api/sliderule/sessions/");
    expect(ask).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(ask);
  });
});
