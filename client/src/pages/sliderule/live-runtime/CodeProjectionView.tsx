/**
 * CodeProjectionView — 代码投影视图（代码视图二期）。
 *
 * 左侧目录树（文件夹分层、可折叠）+ 右侧 CodeMirror 只读编辑器
 * （懒加载分包；未就绪/测试态回退纯 <pre>）。
 * "确定性投影（只读）"的诚实声明在每份投影文件的首行注释里
 * （顶部常驻说明条已按用户裁决移除）。
 */

import React from "react";
import { Button, message } from "antd";
import {
  CaretDownOutlined,
  CaretRightOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOpenOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import { deriveCodeProjection, type ProjectedFile } from "./code-projection";

const LazyCodeMirrorPanel = React.lazy(() => import("./CodeMirrorPanel"));

const LANGUAGE_ICON_COLOR: Record<ProjectedFile["language"], string> = {
  typescript: "#3178c6",
  tsx: "#3178c6",
  sql: "#b45309",
  json: "#ca8a04",
  markdown: "#6b7280",
};

// --- 目录树（由文件路径确定性推导，文件夹在前 · 首现顺序） -----------------

interface DirNode {
  name: string;
  path: string;
  dirs: DirNode[];
  files: ProjectedFile[];
}

function buildDirTree(files: ProjectedFile[]): DirNode {
  const root: DirNode = { name: "", path: "", dirs: [], files: [] };
  const dirMap = new Map<string, DirNode>([["", root]]);
  for (const f of files) {
    const parts = f.path.split("/");
    let parentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parentPath ? `${parentPath}/${parts[i]}` : parts[i];
      if (!dirMap.has(p)) {
        const node: DirNode = { name: parts[i], path: p, dirs: [], files: [] };
        dirMap.get(parentPath)!.dirs.push(node);
        dirMap.set(p, node);
      }
      parentPath = p;
    }
    dirMap.get(parentPath)!.files.push(f);
  }
  return root;
}

function FileRow({
  file,
  depth,
  active,
  onSelect,
}: {
  file: ProjectedFile;
  depth: number;
  active: boolean;
  onSelect: (path: string) => void;
}) {
  const name = file.path.split("/").pop() ?? file.path;
  return (
    <button
      type="button"
      onClick={() => onSelect(file.path)}
      data-testid={`code-file-${file.path}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        textAlign: "left",
        border: 0,
        cursor: "pointer",
        borderRadius: 6,
        padding: `4px 8px 4px ${21 + depth * 14}px`,
        fontSize: 12,
        fontFamily: "ui-monospace, monospace",
        background: active ? "#e6f4ff" : "transparent",
        color: active ? "#1677ff" : "#40485a",
      }}
    >
      <FileOutlined
        style={{
          fontSize: 12,
          color: active ? "#1677ff" : LANGUAGE_ICON_COLOR[file.language],
        }}
      />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
    </button>
  );
}

function DirRows({
  node,
  depth,
  activePath,
  collapsed,
  onToggle,
  onSelect,
}: {
  node: DirNode;
  depth: number;
  activePath: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {node.dirs.map(dir => {
        const isCollapsed = collapsed.has(dir.path);
        return (
          <React.Fragment key={dir.path}>
            <button
              type="button"
              onClick={() => onToggle(dir.path)}
              data-testid={`code-dir-${dir.path}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                textAlign: "left",
                border: 0,
                cursor: "pointer",
                borderRadius: 6,
                padding: `4px 8px 4px ${8 + depth * 14}px`,
                fontSize: 12,
                fontFamily: "ui-monospace, monospace",
                background: "transparent",
                color: "#40485a",
                fontWeight: 500,
              }}
            >
              {isCollapsed ? (
                <CaretRightOutlined style={{ fontSize: 9, color: "#8c95a8" }} />
              ) : (
                <CaretDownOutlined style={{ fontSize: 9, color: "#8c95a8" }} />
              )}
              {isCollapsed ? (
                <FolderOutlined style={{ fontSize: 12, color: "#8c95a8" }} />
              ) : (
                <FolderOpenOutlined
                  style={{ fontSize: 12, color: "#8c95a8" }}
                />
              )}
              <span>{dir.name}</span>
            </button>
            {!isCollapsed && (
              <DirRows
                node={dir}
                depth={depth + 1}
                activePath={activePath}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </React.Fragment>
        );
      })}
      {node.files.map(f => (
        <FileRow
          key={f.path}
          file={f}
          depth={depth}
          active={activePath === f.path}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

// --- 主视图 -----------------------------------------------------------------

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
  const tree = React.useMemo(() => buildDirTree(files), [files]);
  const [activePath, setActivePath] = React.useState<string>(
    files[0]?.path ?? ""
  );
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () => new Set()
  );
  const active = files.find(f => f.path === activePath) ?? files[0];

  const toggleDir = React.useCallback((path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

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
      {/* 顶部说明条已按用户裁决移除——"确定性投影（只读）"的诚实声明
          仍在每份投影文件的首行注释与「代码」档的悬停提示里 */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          style={{
            width: 210,
            flexShrink: 0,
            overflowY: "auto",
            borderRight: "1px solid #e5e7eb",
            padding: "8px 6px",
            background: "#fcfcfd",
          }}
        >
          <DirRows
            node={tree}
            depth={0}
            activePath={active?.path ?? ""}
            collapsed={collapsed}
            onToggle={toggleDir}
            onSelect={setActivePath}
          />
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
            {/* E28：整包下载——全部投影文件按目录结构打成 zip（用户裁决） */}
            <Button
              size="small"
              type="link"
              icon={<DownloadOutlined />}
              data-testid="code-export-zip"
              onClick={async () => {
                try {
                  const { default: JSZip } = await import("jszip");
                  const zip = new JSZip();
                  for (const f of files) zip.file(f.path, f.content);
                  const blob = await zip.generateAsync({ type: "blob" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  const safe = (appName || "sliderule-app").replace(
                    /[^a-zA-Z0-9_\-一-鿿]/g,
                    "_"
                  );
                  a.href = url;
                  a.download = `${safe}-code.zip`;
                  a.click();
                  URL.revokeObjectURL(url);
                  message.success(`已导出 ${files.length} 个文件`);
                } catch {
                  message.warning("打包失败，请重试");
                }
              }}
            >
              打包导出
            </Button>
          </div>
          <React.Suspense
            fallback={
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
            }
          >
            {active ? (
              <LazyCodeMirrorPanel
                key={active.path}
                language={active.language}
                value={active.content}
              />
            ) : null}
          </React.Suspense>
        </div>
      </div>
    </div>
  );
}
