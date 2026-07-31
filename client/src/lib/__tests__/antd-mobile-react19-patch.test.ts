/**
 * antd-mobile 的 React 19 兼容补丁必须在入口注册（2026-07-28）。
 *
 * 真机 A/B 过：同一段脚本（手机档新建 → 保存，触发 Toast 命令式渲染），
 * 关掉补丁抛 2 次 `TypeError: unmountComponentAtNode is not a function`，
 * 开着一次不抛。
 *
 * 这个坑的隐蔽之处在于它**编译能过、单测能过、桌面档也完全正常**——只有
 * 手机档走到 Toast/Dialog/Picker 这类命令式 API 时才炸，而这些恰恰是最
 * 难被静态检查覆盖的路径。所以这里用源码断言把"入口引了这一行"钉死。
 */
import { describe, it, expect } from "vitest";

const mainSrc = await import("../../main.tsx?raw").then(
  m => (m as unknown as { default: string }).default
);
const patchSrc = await import("../antd-mobile-react19-patch.ts?raw").then(
  m => (m as unknown as { default: string }).default
);

describe("React 19 兼容补丁", () => {
  it("入口同时引了 antd 与 antd-mobile 两份补丁", () => {
    // 官方补丁包只覆盖 antd；antd-mobile 是另一个包、另一套
    // unstableSetRender registry，盖不到，必须各注册一次
    expect(mainSrc).toContain('import "@ant-design/v5-patch-for-react-19"');
    expect(mainSrc).toContain('import "./lib/antd-mobile-react19-patch"');
  });

  it("补丁在任何组件渲染之前引入", () => {
    const patchAt = mainSrc.indexOf('./lib/antd-mobile-react19-patch');
    const renderAt = mainSrc.indexOf("createRoot(document.getElementById");
    expect(patchAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(-1);
    expect(patchAt).toBeLessThan(renderAt);
  });

  it("createRoot 取自 react-dom/client —— React 19 主入口已经没有它了", () => {
    // 根因就在这：react-dom 主入口的 createRoot/render/unmountComponentAtNode
    // 在 19 里全没了，rc-util 从主入口解构拿到 undefined 才掉进 legacy 分支。
    expect(patchSrc).toContain('from "react-dom/client"');
    expect(patchSrc).not.toMatch(/from "react-dom"/);
    expect(patchSrc).toContain("unstableSetRender");
  });

  it("卸载延一拍 —— React 19 不允许在渲染周期内同步卸载 root", () => {
    expect(patchSrc).toContain("setTimeout");
    expect(patchSrc).toContain("root.unmount()");
  });
});

describe("react-dom 主入口的事实（根因锚点）", () => {
  it("React 19 的 react-dom 不再导出这三个 API", async () => {
    // 这条如果哪天红了，说明 React 把 API 加回来了或版本回退了——
    // 那时这个补丁的必要性就该重新评估，而不是默默留着。
    const reactDom = (await import("react-dom")) as unknown as Record<
      string,
      unknown
    >;
    expect(reactDom.createRoot).toBeUndefined();
    expect(reactDom.render).toBeUndefined();
    expect(reactDom.unmountComponentAtNode).toBeUndefined();
    const client = await import("react-dom/client");
    expect(typeof client.createRoot).toBe("function");
  });
});
