/**
 * 更新日志生成器（E36）：从 git 发版历史生成帮助中心「更新日志」文档。
 *
 * 数据源 = main 分支上 `发版：` 前缀的合并提交（发版门的机械产物，
 * 天然是一条可信时间线）——不引 conventional-changelog/git-cliff 等
 * 外部工具（它们依赖 feat:/fix: 约定式提交，本仓提交是中文叙事体）。
 *
 * 用法：node scripts/gen-help-changelog.mjs   （发版后手动跑，或并入发版脚本）
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(
  root,
  "client/src/pages/agent-loop/help/docs/09-changelog.md"
);

const raw = execSync(
  'git log main --grep="^发版：" --pretty="%ad|%s" --date=format:"%Y-%m-%d"',
  { cwd: root, encoding: "utf-8" }
).trim();

const byDate = new Map();
for (const line of raw.split("\n").filter(Boolean)) {
  const [date, subject] = line.split("|");
  const title = subject
    .replace(/^发版：/, "")
    .replace(/（pre_main → main）$/, "")
    .trim();
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date).push(title);
}

let md = `# 更新日志

每一条都对应一次**过了发布门**的正式发版（测试 + 浏览器冒烟全绿才可合并
进生产分支）——不是计划，是已经上线的事实。本页由 \`scripts/gen-help-changelog.mjs\`
从发版历史自动生成。

`;
for (const [date, titles] of byDate) {
  md += `## ${date}\n\n`;
  for (const t of titles) md += `- ${t}\n`;
  md += "\n";
}

writeFileSync(OUT, md, "utf-8");
console.log(`已生成 ${OUT}（${[...byDate.values()].flat().length} 条发版记录）`);
