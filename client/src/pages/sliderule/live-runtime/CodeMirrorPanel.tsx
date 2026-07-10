/**
 * CodeMirrorPanel — 代码视图的只读编辑器面板（代码视图二期）。
 *
 * CodeMirror 6 只读态：行号 / 折叠槽 / 语法高亮（github 亮色主题，
 * 与冷调壳体一致）。整个模块经 React.lazy 懒加载，不进主包。
 */

import CodeMirror from "@uiw/react-codemirror";
import { githubLight } from "@uiw/codemirror-theme-github";
import { javascript } from "@codemirror/lang-javascript";
import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import type { ProjectedFile } from "./code-projection";

function extensionsFor(language: ProjectedFile["language"]) {
  switch (language) {
    case "sql":
      return [sql()];
    case "markdown":
      return [markdown()];
    case "json":
      return [json()];
    case "tsx":
      return [javascript({ typescript: true, jsx: true })];
    default:
      return [javascript({ typescript: true })];
  }
}

export default function CodeMirrorPanel({
  language,
  value,
}: {
  language: ProjectedFile["language"];
  value: string;
}) {
  return (
    <div
      data-testid="code-editor"
      style={{ flex: 1, minHeight: 0, overflow: "hidden", fontSize: 12 }}
    >
      <CodeMirror
        value={value}
        theme={githubLight}
        readOnly
        editable={false}
        height="100%"
        style={{ height: "100%" }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        extensions={extensionsFor(language)}
      />
    </div>
  );
}
