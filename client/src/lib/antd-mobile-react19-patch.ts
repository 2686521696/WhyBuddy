/**
 * antd-mobile v5 的 React 19 兼容补丁（2026-07-28）。
 *
 * 官方只发了 antd 的补丁包（@ant-design/v5-patch-for-react-19，main.tsx 已引），
 * antd-mobile 是**另一个包、另一套 unstableSetRender registry**，那个补丁盖不到
 * 它。antd-mobile 自 v5.42.3（2025-01）起再没发版，也没有对应的官方补丁包，
 * 所以这里照官方补丁的实现自己注册一次。
 *
 * 具体坏在哪（实测，不是照抄结论）：
 *   React 19.2.1 的 react-dom 主入口已经不再导出 createRoot / render /
 *   unmountComponentAtNode —— 三个全搬去了 react-dom/client：
 *     require("react-dom").createRoot             → undefined
 *     require("react-dom/client").createRoot      → function
 *   而 antd-mobile 的命令式渲染走 rc-util/React/render，那份代码是从
 *   react-dom **主入口**解构这三个 API 的。于是 createRoot 拿到 undefined、
 *   掉进 legacy 分支：render 因为带可选调用而静默失效，unmount 直接
 *   `undefined(container)` → TypeError: unmountComponentAtNode is not a function。
 *
 * 触发路径是手机档表单的 Picker（PhoneFormField）、角色切换的 Picker
 * （PhoneRolePicker），以及任何 Dialog/Toast/ActionSheet 这类命令式调用。
 * 真机复现过：手机档业务页 → 新建 → 点任一选择器。
 *
 * 引入时机与 antd 那个补丁同理——必须在任何 antd-mobile 组件渲染之前，
 * 所以放 main.tsx 顶部。这里不 export 任何东西，import 即生效。
 */
import type React from "react";
import { unstableSetRender } from "antd-mobile";
import { createRoot } from "react-dom/client";

interface RootHost extends Element {
  _antdMobileReactRoot?: ReturnType<typeof createRoot>;
}

unstableSetRender((node, container) => {
  const host = container as RootHost;
  host._antdMobileReactRoot ??= createRoot(host);
  const root = host._antdMobileReactRoot;
  root.render(node as React.ReactElement);
  return () =>
    // 延一拍再 unmount：React 19 不允许在渲染周期内同步卸载一个 root
    //（会报 "Attempted to synchronously unmount a root while React was
    // already rendering"）。官方 antd 补丁也是这么处理的。
    new Promise<void>(resolve => {
      setTimeout(() => {
        root.unmount();
        delete host._antdMobileReactRoot;
        resolve();
      }, 0);
    });
});
