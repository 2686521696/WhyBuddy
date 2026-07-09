/**
 * harvest-skill-packages — 技能库四期：抓取原版技能包（完整 SKILL.md 指令）。
 *
 * 收录策略沿用 owner 决策（全量 + 署名回链 + 异议按条下架，每条带协议标签）。
 * 通道（本会话 GitHub 域受管控，走公开镜像/归档）：
 *   - GitHub：jsDelivr 数据 API 列目录树（@HEAD）→ CDN 逐文件取 SKILL.md；
 *   - Gitee：仓库 zip 归档（master→main 兜底）→ 本地解包抽取；
 *   - GitCode：尽力而为（gitlab 风格归档），失败如实跳过。
 *
 * 抽取规则：所有名为 SKILL.md / skill.md 的文件（合集仓库一仓多技能逐个拆），
 * 单技能内容上限 16KB（超限截断并标记），内容哈希去重。
 *
 * 用法：node scripts/harvest-skill-packages.mjs [--limit N]
 * 产物：slide-rule-python/data/skill_packages.json
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const SEMANTICS_PATH = path.join(process.cwd(), "slide-rule-python", "data", "skill_semantics.json");
const OUT_PATH = path.join(process.cwd(), "slide-rule-python", "data", "skill_packages.json");
const CONTENT_CAP = 16 * 1024;
const ZIP_CAP = 30 * 1024 * 1024;
const GAP_MS = 250;
const UA = "SlideRule-skill-packages-bot/1.0 (full SKILL.md harvest; attributed; per-item takedown)";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number.parseInt(process.argv[limitArg + 1], 10) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isSkillFile = (name) => /^skill\.md$/i.test(name);

function stripLoneSurrogates(text) {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  return res.text();
}

/** jsDelivr 目录树 → 所有 SKILL.md 相对路径 */
function collectSkillPaths(node, prefix, bucket) {
  for (const child of node.files ?? []) {
    const p = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.type === "directory") collectSkillPaths(child, p, bucket);
    else if (child.type === "file" && isSkillFile(child.name)) bucket.push(p);
  }
}

/** SKILL.md → {name, description}（frontmatter 优先，其次首标题/首段） */
function parseSkillMeta(content, fallbackName) {
  let name = "";
  let description = "";
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  if (fm) {
    const nameMatch = /^name:\s*["']?(.+?)["']?\s*$/m.exec(fm[1]);
    const descMatch = /^description:\s*["']?([\s\S]+?)["']?\s*$/m.exec(fm[1]);
    if (nameMatch) name = nameMatch[1].trim();
    if (descMatch) description = descMatch[1].split("\n")[0].trim();
  }
  if (!name) {
    const heading = /^#{1,2}\s+(.+)$/m.exec(content);
    if (heading) name = heading[1].trim();
  }
  if (!description) {
    const body = content.replace(/^---\n[\s\S]*?\n---/, "");
    const para = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && !l.startsWith("```") && !l.startsWith("!["));
    if (para) description = para;
  }
  return {
    name: stripLoneSurrogates((name || fallbackName).slice(0, 80)),
    description: stripLoneSurrogates(description.slice(0, 240)),
  };
}

function capContent(text) {
  const clean = stripLoneSurrogates(text.replace(/\r\n/g, "\n"));
  if (clean.length <= CONTENT_CAP) return { content: clean, truncated: false };
  return { content: `${clean.slice(0, CONTENT_CAP)}\n\n[…SKILL.md 超长截断，完整版见原仓库]`, truncated: true };
}

async function harvestGithub(owner, repo) {
  const tree = await getJson(`https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@HEAD`);
  const paths = [];
  collectSkillPaths(tree, "", paths);
  const files = [];
  for (const p of paths.slice(0, 40)) {
    await sleep(GAP_MS);
    const text = await getText(
      `https://cdn.jsdelivr.net/gh/${owner}/${repo}@HEAD/${p.split("/").map(encodeURIComponent).join("/")}`
    );
    if (text) files.push({ path: p, text });
  }
  return files;
}

async function harvestGiteeLike(host, owner, repo) {
  const urls =
    host === "gitee.com"
      ? [
          `https://gitee.com/${owner}/${repo}/repository/archive/master.zip`,
          `https://gitee.com/${owner}/${repo}/repository/archive/main.zip`,
        ]
      : [
          `https://gitcode.com/${owner}/${repo}/-/archive/main/${repo}-main.zip`,
          `https://gitcode.com/${owner}/${repo}/-/archive/master/${repo}-master.zip`,
        ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 || buf.length > ZIP_CAP) continue;
      // 错误页可能顶着 200 + zip 后缀回 HTML——认 PK 魔数
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) continue;
      const work = path.join(tmpdir(), `skillpkg-${owner}-${repo}-${Date.now()}`);
      mkdirSync(work, { recursive: true });
      const zipPath = path.join(work, "repo.zip");
      writeFileSync(zipPath, buf);
      try {
        execFileSync("unzip", ["-qq", "-o", zipPath, "-d", work], { timeout: 30000 });
      } catch {
        rmSync(work, { recursive: true, force: true });
        continue;
      }
      const files = [];
      const walk = (dir, rel) => {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry);
          const relPath = rel ? `${rel}/${entry}` : entry;
          const st = statSync(full);
          if (st.isDirectory()) walk(full, relPath);
          else if (isSkillFile(entry) && st.size < 512 * 1024) {
            // zip 顶层是 repo-branch/ 目录，剥掉一层
            files.push({ path: relPath.split("/").slice(1).join("/"), text: readFileSync(full, "utf8") });
          }
        }
      };
      walk(work, "");
      rmSync(work, { recursive: true, force: true });
      return files;
    } catch {
      /* 下一个候选 */
    }
  }
  return [];
}

async function main() {
  const semantics = JSON.parse(readFileSync(SEMANTICS_PATH, "utf8"));
  const repos = semantics.items.slice(0, LIMIT);
  console.log(`[packages] repos: ${repos.length}`);

  const items = [];
  const seenHash = new Set();
  let done = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const idx = cursor++;
      if (idx >= repos.length) return;
      const it = repos[idx];
      const [host, owner, repo] = it.repo.split("/");
      await sleep(GAP_MS);
      let files = [];
      try {
        if (host === "github.com") files = await harvestGithub(owner, repo);
        else files = await harvestGiteeLike(host, owner, repo);
      } catch (err) {
        console.log(`[packages] skip ${it.repo}: ${String(err.message ?? err).slice(0, 80)}`);
      }
      for (const f of files) {
        const hash = createHash("sha256").update(f.text.trim()).digest("hex").slice(0, 16);
        if (seenHash.has(hash)) continue;
        seenHash.add(hash);
        const dirName = f.path.includes("/") ? f.path.split("/").at(-2) : repo;
        const meta = parseSkillMeta(f.text, dirName);
        const capped = capContent(f.text);
        items.push({
          id: `${it.repo}#${f.path}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 120),
          repo: it.repo,
          path: f.path,
          sourceUrl: `${it.url}`,
          license: it.license,
          name: meta.name,
          description: meta.description,
          content: capped.content,
          truncated: capped.truncated,
        });
      }
      done += 1;
      if (done % 40 === 0) console.log(`[packages] ${done}/${repos.length} repos, ${items.length} skills`);
    }
  }

  await Promise.all(Array.from({ length: 4 }, worker));

  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        source: "TRAE 论坛 SOLO 技能创作赛开源仓库（完整 SKILL.md，owner 兜底收录，署名回链，异议按条下架）",
        generatedAt: new Date().toISOString(),
        count: items.length,
        items,
      },
      null,
      1
    )
  );
  const bytes = items.reduce((n, i) => n + i.content.length, 0);
  console.log(
    `[packages] done: ${items.length} skills from ${repos.length} repos, ~${Math.round(bytes / 1024)}KB -> ${OUT_PATH}`
  );
}

await main();
