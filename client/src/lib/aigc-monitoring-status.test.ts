import { describe, expect, it } from "vitest";

import {
  getAigcMonitoringStatusClassName,
  getAigcMonitoringStatusLabel,
  getAigcMonitoringStatusPresentation,
  getAigcMonitoringToneClassName,
} from "./aigc-monitoring-status";

describe("aigc-monitoring-status", () => {
  it("maps execution statuses to Chinese-friendly labels and tones", () => {
    expect(
      getAigcMonitoringStatusPresentation("PENDING", { locale: "zh-CN" })
    ).toMatchObject({
      label: "待执行",
      shortLabel: "待执行",
      tone: "neutral",
      className: "border-stone-200 bg-stone-50 text-stone-600",
    });

    expect(
      getAigcMonitoringStatusPresentation("EXECUTING", { locale: "zh-CN" })
    ).toMatchObject({
      label: "执行中",
      shortLabel: "进行中",
      tone: "info",
      className: "border-sky-200 bg-sky-50 text-sky-700",
    });

    expect(
      getAigcMonitoringStatusPresentation("EXECUTED", { locale: "zh-CN" })
    ).toMatchObject({
      label: "已完成",
      shortLabel: "已完成",
      tone: "success",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    });

    expect(
      getAigcMonitoringStatusPresentation("EXCEPTION", { locale: "zh-CN" })
    ).toMatchObject({
      label: "执行异常",
      shortLabel: "异常",
      tone: "danger",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    });

    expect(
      getAigcMonitoringStatusPresentation("WAITING_INPUT", { locale: "zh-CN" })
    ).toMatchObject({
      label: "等待输入",
      shortLabel: "等待输入",
      tone: "warning",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    });

    expect(
      getAigcMonitoringStatusPresentation("FORCE_TERMINATED", {
        locale: "zh-CN",
      })
    ).toMatchObject({
      label: "强制终止",
      shortLabel: "已终止",
      tone: "danger",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    });
  });

  it("maps node statuses and supports English fallback", () => {
    expect(
      getAigcMonitoringStatusPresentation("EXECUTING", { locale: "en-US" })
    ).toMatchObject({
      label: "Executing",
      shortLabel: "Running",
      tone: "info",
    });

    expect(
      getAigcMonitoringStatusPresentation("EXECUTED", { locale: "en-US" })
    ).toMatchObject({
      label: "Executed",
      shortLabel: "Done",
      tone: "success",
    });

    expect(
      getAigcMonitoringStatusPresentation("EXCEPTION", { locale: "en-US" })
    ).toMatchObject({
      label: "Exception",
      shortLabel: "Error",
      tone: "danger",
    });
  });

  it("returns short labels when requested", () => {
    expect(
      getAigcMonitoringStatusLabel("EXECUTING", {
        locale: "zh-CN",
        short: true,
      })
    ).toBe("进行中");

    expect(
      getAigcMonitoringStatusLabel("FORCE_TERMINATED", {
        locale: "en-US",
        short: true,
      })
    ).toBe("Terminated");
  });

  it("falls back safely for unknown or empty statuses", () => {
    expect(
      getAigcMonitoringStatusPresentation("CUSTOM_STATUS", {
        locale: "zh-CN",
      })
    ).toMatchObject({
      label: "CUSTOM_STATUS",
      shortLabel: "CUSTOM_STATUS",
      tone: "neutral",
      className: "border-stone-200 bg-stone-50 text-stone-600",
    });

    expect(
      getAigcMonitoringStatusPresentation(undefined, {
        locale: "zh-CN",
      })
    ).toMatchObject({
      label: "未记录",
      shortLabel: "未记录",
      tone: "neutral",
      className: "border-stone-200 bg-stone-50 text-stone-600",
    });

    expect(
      getAigcMonitoringStatusPresentation(null, {
        locale: "en-US",
      })
    ).toMatchObject({
      label: "Unknown",
      shortLabel: "Unknown",
      tone: "neutral",
      className: "border-stone-200 bg-stone-50 text-stone-600",
    });
  });

  it("exposes reusable class-name helpers", () => {
    expect(getAigcMonitoringToneClassName("warning")).toBe(
      "border-amber-200 bg-amber-50 text-amber-700"
    );
    expect(getAigcMonitoringStatusClassName("EXECUTED")).toBe(
      "border-emerald-200 bg-emerald-50 text-emerald-700"
    );
  });
});
