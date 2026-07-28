/**
 * PhoneActionButton — 手机档的行内动作按钮（antd-mobile Button）。
 *
 * 为什么单独一个文件而不是在 AppRuntimeScreen 里直接 import antd-mobile：
 * 这个仓库的测试跑在 node 环境、没有 CSS 处理，antd-mobile 的 CJS 入口一被
 * 静态引入就会在收集期炸（Unexpected token ':'）。phone-mobile/ 下所有组件
 * 因此都走 React.lazy——动态 import 只在真渲染手机档时才求值，测试不碰。
 * 破坏这条约定的代价是 8 个测试文件直接起不来，跟组件本身对不对无关。
 *
 * 语义上替掉的是 antd 的 `size="small" type="link"`：那个在指尖下太小太轻，
 * 移动端的可点区域该有 mini 按钮的尺寸和按下反馈。
 */

import React from "react";
import { Button } from "antd-mobile";

export default function PhoneActionButton({
  children,
  onClick,
  color = "primary",
  loading = false,
  disabled = false,
  size = "mini",
  testId,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  color?: "primary" | "danger";
  loading?: boolean;
  disabled?: boolean;
  size?: "mini" | "small";
  testId?: string;
}) {
  return (
    <Button
      size={size}
      color={color}
      fill="none"
      loading={loading}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </Button>
  );
}
