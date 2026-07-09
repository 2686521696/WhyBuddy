/**
 * CodeProjectionView — 代码投影视图（代码视图一期）。
 *
 * 左侧文件列表 + 右侧 mono 代码面板（零高亮依赖，一期先保内容与诚实性）。
 * 顶部常驻说明：这是 schema 的确定性投影（只读），与运行应用同源。
 */

import React from "react";
import { Button, message } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import { deriveCodeProjection } from "./code-projection";

export function CodeProjectionView({
  model,
  appName,
}: {
  model: FiveSystemModel;
  appName?: string;
}) {
  const files = React.useMemo(
    () => deriveCodeProjection(model, appName),
    [model, appName]
  );
  const [activePath, setActivePath] = React.useState<string>(
    files[0]?.path ?? ""
  );
  const active = files.find(f => f.path === activePath) ?? files[0];

  if (files.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          color: "#8c8c8c",
        }}
      >
        本话题还没有可投影的五系统模型
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
      }}
      data-testid="app-runtime-code"
    >
      <div
        style={{
          flexShrink: 0,
          padding: "8px 14px",
          fontSize: 11,
          color: "#595959",
          background: "#f7f8fa",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        代码视图 = 五系统 schema 的确定性投影（只读，非 LLM
        生成）——与左侧运行应用同源同真相；要改内容请回到意图重新推演。
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          style={{
            width: 190,
            flexShrink: 0,
            overflowY: "auto",
            borderRight: "1px solid #e5e7eb",
            padding: "8px 6px",
            background: "#fcfcfd",
          }}
        >
          {files.map(f => (
            <button
              key={f.path}
              type="button"
              onClick={() => setActivePath(f.path)}
              data-testid={`code-file-${f.path}`}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: 0,
                cursor: "pointer",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 12,
                fontFamily: "ui-monospace, monospace",
                background: active?.path === f.path ? "#e6f4ff" : "transparent",
                color: active?.path === f.path ? "#1677ff" : "#40485a",
              }}
            >
              {f.path}
            </button>
          ))}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderBottom: "1px solid #f0f0f0",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontFamily: "ui-monospace, monospace",
                color: "#262626",
              }}
            >
              {active?.path}
            </span>
            <span style={{ fontSize: 10, color: "#bfbfbf" }}>
              {active ? `${active.content.split("\n").length} 行` : ""}
            </span>
            <Button
              size="small"
              type="link"
              icon={<CopyOutlined />}
              style={{ marginLeft: "auto" }}
              data-testid="code-copy"
              onClick={() => {
                if (!active) return;
                navigator.clipboard
                  .writeText(active.content)
                  .then(() => message.success(`已复制 ${active.path}`))
                  .catch(() =>
                    message.warning("复制失败（浏览器未授权剪贴板）")
                  );
              }}
            >
              复制
            </Button>
          </div>
          <pre
            data-testid="code-content"
            style={{
              flex: 1,
              minHeight: 0,
              margin: 0,
              overflow: "auto",
              padding: "12px 16px",
              fontSize: 12,
              lineHeight: 1.7,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              color: "#1f2329",
              whiteSpace: "pre",
            }}
          >
            {active?.content}
          </pre>
        </div>
      </div>
    </div>
  );
}
