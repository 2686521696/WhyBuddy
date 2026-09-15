/**
 * 源码树：整份工程，不是扁平路径条。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  sourceFileTree,
  sourceTreeDirPaths,
  sourceTreeFilePaths,
} from "../project-runtime/source-file-tree";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("清单收成树", () => {
  it("目录在上、文件在下，嵌套按路径长出来", () => {
    const tree = sourceFileTree([
      "src/pages/Home.tsx",
      "package.json",
      "src/main.tsx",
    ]);
    expect(tree.map(node => node.name)).toEqual(["src", "package.json"]);
    const src = tree[0];
    expect(src.kind).toBe("dir");
    if (src.kind !== "dir") return;
    expect(src.children.map(node => node.name)).toEqual(["pages", "main.tsx"]);
    const pages = src.children[0];
    expect(pages.kind).toBe("dir");
    if (pages.kind !== "dir") return;
    expect(pages.children).toEqual([
      { kind: "file", name: "Home.tsx", path: "src/pages/Home.tsx" },
    ]);
  });

  it("清单里的每一份都在树上——漏掉就是「不是整个项目」", () => {
    const paths = [
      "package.json",
      "src/App.tsx",
      "src/pages/UsersPage.tsx",
      "src/i18n/translations.ts",
    ];
    expect(sourceTreeFilePaths(sourceFileTree(paths)).sort()).toEqual(
      [...paths].sort()
    );
    expect(sourceTreeDirPaths(sourceFileTree(paths)).sort()).toEqual(
      ["src", "src/i18n", "src/pages"].sort()
    );
  });

  it("反向：清单外的路径不许编进树，坏路径直接丢掉", () => {
    const tree = sourceFileTree([
      "src/App.tsx",
      "../escape",
      "/outside",
      "nested/../../x",
      "",
    ]);
    expect(sourceTreeFilePaths(tree)).toEqual(["src/App.tsx"]);
    expect(JSON.stringify(tree)).not.toContain("escape");
    expect(JSON.stringify(tree)).not.toContain("outside");
  });
});

describe("通电：面板画的是树，不是 files.map(path)", () => {
  it("源码面板用 sourceFileTree，文件钮钉 data-source-path", () => {
    const panel = stripComments(
      readFileSync(
        resolve(process.cwd(), "client/src/pages/sliderule/project-runtime/ProjectWorkspacePanel.tsx"),
        "utf8"
      )
    );
    expect(panel).toMatch(/sourceFileTree\(/);
    expect(panel).toMatch(/project-source-tree/);
    expect(panel).toMatch(/data-source-path/);
    // 反向：再摊成窄条 + 完整 path 当唯一标签，看起来又不是整个项目。
    expect(panel).not.toMatch(/max-h-36/);
    expect(panel).not.toMatch(/aria-label="工程文件"[\s\S]*\{row\.path\}/);
  });
});
