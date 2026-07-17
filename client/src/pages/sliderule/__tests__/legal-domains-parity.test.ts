/**
 * E40.1 合法域单一真相源——渲染器侧 parity 锁。
 *
 * 账本 = @legal（slide-rule-python/services/data/five_system_legal.json），
 * 与结构门/修复器/生成契约同一份。这里锁两件事：
 *  1. field-display 的运行时数组确实派生自账本（不是又一份手抄）；
 *  2. 「渲染器已实现」清单与账本一致——E40.4/40.5 往账本加图表形态或页面
 *     范式时，这里会红，逼着渲染器同步实现（绊线设计，红了就是提醒你去
 *     live-runtime 补实现，补完把清单更新到这里）。
 */
import { describe, expect, it } from "vitest";

import legal from "@legal";
import { FIELD_TONES } from "../live-runtime/field-display";
import {
  LEGAL_THEME_IDS,
  allIdentityThemes,
} from "../live-runtime/identity-themes";

// 渲染器当前已实现的集合（app-runtime-schema.ts 的 switch/联合类型覆盖面）。
// 账本加值 → 此清单不含 → 测试红 → 去补渲染实现，再更新清单。
const RENDERER_PAGE_KINDS = ["workbench", "kanban", "calendar", "dashboard"];
const RENDERER_CHART_TYPES = ["bar", "line", "pie"];
const RENDERER_STAT_FORMATS = ["number", "money", "percent"];

describe("legal-domains parity（四方同账，E40.1）", () => {
  it("field-display 的 tones/formats 派生自账本", () => {
    expect([...FIELD_TONES]).toEqual(legal.fieldTones);
    // formats 联合 = 账本 number+string formats（normalizeFieldFormat 的判定域）
    expect([...legal.numberFormats, ...legal.stringFormats]).toEqual([
      "money",
      "percent",
      "progress",
      "score",
      "rating",
      "masked",
    ]);
  });

  it("账本页面范式 = 渲染器已实现范式（绊线：加范式先补渲染）", () => {
    expect(legal.pageKinds).toEqual(RENDERER_PAGE_KINDS);
  });

  it("账本图表形态 = 渲染器已实现形态（绊线：加形态先补渲染）", () => {
    expect(legal.chartTypes).toEqual(RENDERER_CHART_TYPES);
  });

  it("账本统计卡格式 = 渲染器已实现格式", () => {
    expect(legal.statFormats).toEqual(RENDERER_STAT_FORMATS);
  });

  it("账本身份主题 = identity-themes 实现清单（E40.2 绊线）", () => {
    expect(LEGAL_THEME_IDS).toEqual(legal.identityThemes);
    expect(allIdentityThemes().map(t => t.id)).toEqual(legal.identityThemes);
  });

  it("账本导航形态 = 渲染器已实现形态（side/top）", () => {
    expect(legal.identityNavs).toEqual(["side", "top"]);
  });
});
