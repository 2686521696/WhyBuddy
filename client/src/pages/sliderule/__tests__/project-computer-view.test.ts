/**
 * 右侧电脑档位：用户点过就钉住，没点过才按干活/预览自动切。
 *
 * ⚠ 把「有动作在跑 → 终端」改回去叠在预览上面，下面「live 优先」那条必红。
 *   把 userPinned 删掉改成永远自动切，反向那条必红。
 */
import { describe, expect, it } from "vitest";
import {
  computerViewForAction,
  FOLLOW_COMPUTER_EVENT,
  INSPECT_ACTION_EVENT,
  inspectActionDetail,
  isComputerView,
  resolveComputerView,
  shouldAutoCreateProject,
  shouldShowProjectComputer,
} from "../project-computer-view";

describe("用户点过下拉就钉住", () => {
  it("钉在源码时，哪怕正在跑、预览也就绪，都不许拽走", () => {
    expect(
      resolveComputerView({
        userPinned: "source",
        live: true,
        hasActivity: true,
        previewReady: true,
      })
    ).toBe("source");
  });

  it("反向：没点过才允许自动切", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: true,
        hasActivity: true,
        previewReady: true,
      })
    ).toBe("computer");
  });
});

describe("没点过：按干活 / 预览自动切", () => {
  it("有动作在跑 → 终端，预览再就绪也先看它干活", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: true,
        hasActivity: true,
        previewReady: true,
      })
    ).toBe("computer");
  });

  it("跑完且预览能打开 → 预览", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: true,
        previewReady: true,
      })
    ).toBe("preview");
  });

  it("跑完但预览还没开 → 留在终端回放，不扔进一块空占位", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: true,
        previewReady: false,
      })
    ).toBe("computer");
  });

  it("什么都没有 → 预览（跟应用中心没接 turns 的默认面孔一致）", () => {
    expect(
      resolveComputerView({
        userPinned: null,
        live: false,
        hasActivity: false,
        previewReady: false,
      })
    ).toBe("preview");
  });
});

describe("左栏点工具 → 右侧开哪一档", () => {
  it("写入 / 读取源码打开代码，运行命令打开终端，启动打开预览", () => {
    expect(computerViewForAction("project_patch")).toBe("source");
    expect(computerViewForAction("project_read")).toBe("source");
    expect(computerViewForAction("project_exec")).toBe("computer");
    expect(computerViewForAction("project_start")).toBe("preview");
    expect(computerViewForAction("project_revisions")).toBe("history");
    expect(computerViewForAction("project_delivery")).toBe("delivery");
  });

  it("反向：未知工具落到终端，不编一个预览", () => {
    expect(computerViewForAction("project_brand_new")).toBe("computer");
    expect(computerViewForAction("")).toBe("computer");
    expect(computerViewForAction("intent.parse")).toBe("computer");
  });

  it("载荷缺 id 或 tool 就不认——编一条会让右侧跟错人", () => {
    expect(inspectActionDetail({ id: "a", tool: "project_exec" })).toEqual({
      id: "a",
      tool: "project_exec",
    });
    expect(inspectActionDetail({ id: "a" })).toBeNull();
    expect(inspectActionDetail({ tool: "project_exec" })).toBeNull();
    expect(inspectActionDetail(null)).toBeNull();
  });
});

describe("事件名不许 silently 改掉", () => {
  it("inspect / follow 是外壳在听的那两个字面量", () => {
    expect(INSPECT_ACTION_EVENT).toBe("sliderule:inspect-action");
    expect(FOLLOW_COMPUTER_EVENT).toBe("sliderule:follow-computer");
  });
});

describe("计划批准后右侧是电脑，不是接线沙盘", () => {
  it("已经是工程、或有 projectId、或正在创建、或可以创建 → 电脑", () => {
    expect(shouldShowProjectComputer({ runtimeKind: "project" })).toBe(true);
    expect(
      shouldShowProjectComputer({
        runtimeKind: "html-prototype",
        projectId: "proj-1",
      })
    ).toBe(true);
    expect(
      shouldShowProjectComputer({
        runtimeKind: "html-prototype",
        creating: true,
      })
    ).toBe(true);
    expect(
      shouldShowProjectComputer({
        runtimeKind: "html-prototype",
        canCreateProject: true,
      })
    ).toBe(true);
  });

  it("反向：普通 HTML 推演不许改成电脑", () => {
    expect(
      shouldShowProjectComputer({ runtimeKind: "html-prototype" })
    ).toBe(false);
    expect(shouldShowProjectComputer({})).toBe(false);
  });

  it("空闲且能创建才自动 POST；跑着 / 已在创建 / 失败过都不重打", () => {
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: false,
        createStatus: "idle",
      })
    ).toBe(true);
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: true,
        createStatus: "idle",
      })
    ).toBe(false);
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: false,
        createStatus: "creating",
      })
    ).toBe(false);
    expect(
      shouldAutoCreateProject({
        canCreateProject: true,
        isRunning: false,
        createStatus: "error",
      })
    ).toBe(false);
    expect(
      shouldAutoCreateProject({
        canCreateProject: false,
        isRunning: false,
        createStatus: "idle",
      })
    ).toBe(false);
  });
});

describe("档位名单", () => {
  it("终端 / 预览 / 源码都在，瞎写的不算", () => {
    expect(isComputerView("computer")).toBe(true);
    expect(isComputerView("preview")).toBe(true);
    expect(isComputerView("source")).toBe(true);
    expect(isComputerView("terminal")).toBe(false);
    expect(isComputerView("")).toBe(false);
  });
});
