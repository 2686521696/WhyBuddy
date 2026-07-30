/**
 * 档位可用性推导（2026-07-30）。
 *
 * 这一条的价值全在"不给没设计过的档留入口"：07-30 起明说桌面档的应用不再
 * 设计手机版式，切换条上要是还留着「手机」，点进去就是桌面版式被 CSS 掰弯
 * 的样子。形状照 Appsmith 的 LayoutSystemFeatures——用一处派生回答，各处只问。
 */
import { describe, expect, it } from "vitest";

import { availableDeviceTiers } from "../AppRuntimeScreen";

const page = (mobile: boolean) => ({
  freeformOverview: mobile
    ? { root: { tag: "div" }, mobile: { root: { tag: "div" } } }
    : { root: { tag: "div" } },
});

describe("availableDeviceTiers", () => {
  it("声明 phone → 只有手机档", () => {
    expect(availableDeviceTiers({ identity: { preferredDevice: "phone" }, pages: [] })).toEqual([
      "phone",
    ]);
  });

  it("声明 desktop 且没有手机设计 → 只有桌面档（切换条因此整条不出现）", () => {
    expect(
      availableDeviceTiers({ identity: { preferredDevice: "desktop" }, pages: [page(false)] })
    ).toEqual(["desktop"]);
  });

  it("判据是真有没有那份设计，不只看声明——老数据必须还能切到手机", () => {
    // 07-30 之前生成的应用 preferredDevice 一律 desktop（那时这个字段没判据、
    // 实测 9/9 都是它），但它们**确实有** mobile 设计。只按声明判会把已经
    // 存在的设计藏起来，那是数据丢失级别的错。
    expect(
      availableDeviceTiers({ identity: { preferredDevice: "desktop" }, pages: [page(true)] })
    ).toEqual(["desktop", "phone"]);
  });

  it("未声明 + 有手机设计 → 两档都给", () => {
    expect(availableDeviceTiers({ identity: {}, pages: [page(true)] })).toEqual([
      "desktop",
      "phone",
    ]);
  });

  it("未声明 + 没有手机设计 → 只有桌面档", () => {
    expect(availableDeviceTiers({ identity: {}, pages: [page(false)] })).toEqual(["desktop"]);
  });

  it("tablet 按未声明处理（平板范式已下架 ADR-0001）", () => {
    expect(
      availableDeviceTiers({ identity: { preferredDevice: "tablet" }, pages: [page(true)] })
    ).toEqual(["desktop", "phone"]);
  });

  it("空 schema 不炸，退到桌面档", () => {
    expect(availableDeviceTiers(null)).toEqual(["desktop"]);
    expect(availableDeviceTiers(undefined)).toEqual(["desktop"]);
    expect(availableDeviceTiers({})).toEqual(["desktop"]);
  });

  it("多页里只要有一页挂了手机设计就算有", () => {
    expect(
      availableDeviceTiers({ identity: {}, pages: [page(false), page(true), page(false)] })
    ).toEqual(["desktop", "phone"]);
  });
});
