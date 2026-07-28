/**
 * PhoneProgress — 手机档的进度字段（antd-mobile ProgressBar）。
 *
 * antd 的 Progress 带 minWidth 90 的桌面预设，塞进窄屏列表行会把整行撑开。
 * 与 phone-mobile/ 下其余组件同理走 React.lazy——静态引 antd-mobile 会让
 * node 环境的测试在收集期炸掉（见 PhoneActionButton 的说明）。
 */

import React from "react";
import { ProgressBar } from "antd-mobile";

export default function PhoneProgress({ percent }: { percent: number }) {
  return (
    <ProgressBar
      percent={percent}
      style={{ minWidth: 72, "--track-width": "4px" } as React.CSSProperties}
    />
  );
}
