/**
 * harvest-skill-semantics — 技能库二期"化为己用"：
 * 从索引里的开源仓库中筛出宽松协议（MIT/Apache/BSD/Unlicense/CC0）的，
 * 抽取技能语义档案（名称/描述/输入输出线索），产出推演引擎参考语料。
 *
 * 收录策略（项目 owner 决策，2026-07-09）：全量收录简短语义档案
 * （≤300 字摘要 + 署名回链），不再按协议门控——owner 对未挂协议仓库
 * 的引用风险兜底，异议按条下架（每条保留协议标签便于定位）。
 *   - 只读公开 raw 文件（LICENSE / SKILL.md / README），无认证、限并发；
 *   - 产物按仓库署名（repo url + 论坛原帖回链），供生成 prompt 做
 *     命名/输入输出风格参考，不复制任何实现内容。
 *
 * 用法：node scripts/harvest-skill-semantics.mjs [--limit N]
 * 产物：slide-rule-python/data/skill_semantics.json
 */

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const INDEX_PATH = path.join(process.cwd(), "client", "src", "data", "trae-skills-index.json");
const OUT_PATH = path.join(process.cwd(), "slide-rule-python", "data", "skill_semantics.json");
const CONCURRENCY = 5;
const REQUEST_GAP_MS = 120;
const UA = "SlideRule-skill-semantics-bot/1.0 (license census + permissive-only excerpts)";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number.parseInt(process.argv[limitArg + 1], 10) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) return null;
    const text = await res.text();
    // gitee 对不存在的 raw 路径有时回 HTML 页——粗筛
    if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) return null;
    return text;
  } catch {
    return null;
  }
}

/** host 感知的 raw 文件 URL 候选（github 用 HEAD ref 免猜默认分支） */
function rawUrlCandidates(host, owner, repo, file) {
  if (host === "github.com") {
    return [`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${file}`];
  }
  if (host === "gitee.com") {
    return [
      `https://gitee.com/${owner}/${repo}/raw/master/${file}`,
      `https://gitee.com/${owner}/${repo}/raw/main/${file}`,
    ];
  }
  if (host === "gitcode.com") {
    return [
      `https://gitcode.com/${owner}/${repo}/-/raw/main/${file}`,
      `https://gitcode.com/${owner}/${repo}/-/raw/master/${file}`,
    ];
  }
  return [];
}

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"];
const DOC_FILES = ["SKILL.md", "skill.md", "README.md", "readme.md", "README_CN.md"];

/** LICENSE 文本 → SPDX 风格标签 */
function classifyLicense(text) {
  const head = text.slice(0, 2000);
  if (/MIT License|Permission is hereby granted, free of charge/i.test(head)) return "MIT";
  if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(head)) return "Apache-2.0";
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(head)) return "AGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(head)) return "LGPL";
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,60}Version 3/i.test(head)) return "GPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,60}Version 2/i.test(head)) return "GPL-2.0";
  if (/Mozilla Public License[\s\S]{0,40}2\.0/i.test(head)) return "MPL-2.0";
  if (/Redistribution and use in source and binary forms/i.test(head)) {
    return /neither the name/i.test(head) ? "BSD-3-Clause" : "BSD-2-Clause";
  }
  if (/This is free and unencumbered software released into the public domain/i.test(head))
    return "Unlicense";
  if (/CC0 1\.0 Universal|CREATIVE COMMONS.*CC0/i.test(head)) return "CC0-1.0";
  if (/Creative Commons Attribution-NonCommercial|CC BY-NC/i.test(head)) return "CC-BY-NC";
  if (/木兰宽松许可证|Mulan PSL/i.test(head)) return "MulanPSL-2.0";
  return "unknown";
}

// 木兰 PSL v2 是国产宽松许可证（Gitee 常见），语义等同 Apache 风格宽松授权
const PERMISSIVE = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Unlicense",
  "CC0-1.0",
  "MulanPSL-2.0",
]);

/** JS 按 UTF-16 code unit 截断会把 emoji 切成孤代理，JSON 下游（Python/严格
 * 解析器）直接炸——截断后统一清掉孤代理。 */
function stripLoneSurrogates(text) {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** markdown 头部 → 语义档案（标题/描述/输入输出线索行） */
function extractSemantics(md) {
  const text = md.slice(0, 6000).replace(/\r/g, "");
  const lines = text.split("\n");
  let name = "";
  const descLines = [];
  const ioHints = [];
  let inCode = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) inCode = !inCode;
    if (inCode || !line || line.startsWith("![") || line.startsWith("<")) continue;
    if (!name && /^#{1,2}\s+/.test(line)) {
      name = line.replace(/^#+\s*/, "").slice(0, 80);
      continue;
    }
    if (/^(输入|输出|触发|用法|使用方法|input|output|trigger|usage)\s*[:：]/i.test(line)) {
      ioHints.push(line.slice(0, 120));
      continue;
    }
    if (name && descLines.join("").length < 300 && !line.startsWith("#")) {
      descLines.push(line);
    }
  }
  return {
    name: stripLoneSurrogates(name),
    description: stripLoneSurrogates(descLines.join(" ").slice(0, 300)),
    ioHints: ioHints.slice(0, 6).map(stripLoneSurrogates),
  };
}

async function main() {
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));

  // 去重仓库 → 反向挂论坛来源（署名回链用）
  const repoMap = new Map();
  for (const it of index.items) {
    for (const r of it.repos) {
      const m = /https?:\/\/(github\.com|gitee\.com|gitcode\.com)\/([^/\s]+)\/([^/\s#?]+)/.exec(r);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}/${m[3].replace(/\.git$/, "")}`;
      const entry = repoMap.get(key) ?? {
        host: m[1],
        owner: m[2],
        repo: m[3].replace(/\.git$/, ""),
        topics: [],
      };
      if (!entry.topics.some((t) => t.topicId === it.topicId)) {
        entry.topics.push({ topicId: it.topicId, title: it.title, url: it.url });
      }
      repoMap.set(key, entry);
    }
  }
  const repos = [...repoMap.entries()].slice(0, LIMIT);
  console.log(`[semantics] unique repos: ${repos.length}`);

  const census = {};
  const items = [];
  let cursor = 0;

  async function worker() {
    for (;;) {
      const idx = cursor++;
      if (idx >= repos.length) return;
      const [key, entry] = repos[idx];
      await sleep(REQUEST_GAP_MS);

      // 1) 协议普查
      let license = "no-license-file";
      outer: for (const file of LICENSE_FILES) {
        for (const url of rawUrlCandidates(entry.host, entry.owner, entry.repo, file)) {
          const text = await fetchText(url);
          if (text) {
            license = classifyLicense(text);
            break outer;
          }
        }
      }
      census[license] = (census[license] ?? 0) + 1;

      // 2) 全量摘录语义（owner 兜底决策）；协议标签随条保留，异议可按条下架
      {
        let doc = null;
        for (const file of DOC_FILES) {
          for (const url of rawUrlCandidates(entry.host, entry.owner, entry.repo, file)) {
            doc = await fetchText(url);
            if (doc) break;
          }
          if (doc) break;
        }
        const semantics = doc ? extractSemantics(doc) : { name: "", description: "", ioHints: [] };
        items.push({
          repo: key,
          url: `https://${key}`,
          license,
          permissive: PERMISSIVE.has(license),
          name: semantics.name || entry.topics[0]?.title?.slice(0, 80) || entry.repo,
          description: semantics.description,
          ioHints: semantics.ioHints,
          forumTopics: entry.topics.slice(0, 4),
        });
      }
      if ((idx + 1) % 50 === 0) console.log(`[semantics] ${idx + 1}/${repos.length}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        source: "TRAE 论坛 SOLO 技能创作赛开源仓库（经 trae-skills-index 去重）",
        criteria:
          "全量收录简短语义档案（署名回链，每条带协议标签；owner 对未挂协议引用兜底，异议按条下架）",
        generatedAt: new Date().toISOString(),
        licenseCensus: census,
        count: items.length,
        items,
      },
      null,
      2
    )
  );
  console.log("[semantics] census:", census);
  console.log(`[semantics] permissive items: ${items.length} -> ${OUT_PATH}`);

  // 双写前端瘦身版（技能库 marketplace 安装/试跑用；topicIds 供索引行 join）
  const CLIENT_OUT = path.join(process.cwd(), "client", "src", "data", "skill-semantics.json");
  writeFileSync(
    CLIENT_OUT,
    JSON.stringify(
      {
        source: "TRAE 论坛 SOLO 技能创作赛开源仓库（经 trae-skills-index 去重）",
        generatedAt: new Date().toISOString(),
        items: items.map((it) => ({
          repo: it.repo,
          url: it.url,
          license: it.license,
          name: it.name,
          description: it.description,
          ioHints: it.ioHints,
          topicIds: it.forumTopics.map((t) => t.topicId),
        })),
      },
      null,
      1
    )
  );
  console.log(`[semantics] client slim -> ${CLIENT_OUT}`);
}

await main();
