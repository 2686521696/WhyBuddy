/**
 * harvest-trae-skills — TRAE 论坛「SOLO技能创作赛」分区（/c/37-category/37）
 * 技能索引采集器。
 *
 * 合规边界（刻意保守）：
 *   - 只走 Discourse 公开 JSON 接口（页面 URL + .json），robots.txt 对
 *     通用 UA 开放内容页（只禁 /admin /auth 等）；
 *   - 只采"索引元数据"：标题/作者/时间/热度/标签/首帖摘要/获取渠道链接——
 *     不下载、不转存、不再分发任何参赛作品本体（zip/仓库内容留在原处）；
 *   - 限速 ~2 req/s，串行请求，UA 表明身份；
 *   - 产物带来源与采集时间标注，UI 侧必须回链原帖署名。
 *
 * 用法：node scripts/harvest-trae-skills.mjs [--limit N]
 * 产物：data/trae-skills-index.json
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

// Node fetch 默认不读 HTTPS_PROXY 环境变量（curl 会读）——受限网络（如
// 沙箱经代理出网）下必须显式接上；直连环境无此变量则保持原样。
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const BASE = "https://forum.trae.cn";
const CATEGORY_PATH = "/c/37-category/37.json";
// 产物放 client/src/data：技能库页面直接 import（打进懒加载 chunk，不占主包）
const OUT_PATH = path.join(process.cwd(), "client", "src", "data", "trae-skills-index.json");
const DELAY_MS = 450;
const UA = "SlideRule-skill-index-bot/1.0 (research index; contact via forum PM)";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number.parseInt(process.argv[limitArg + 1], 10) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, retry = 1) {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
    if (res.status === 429 && retry > 0) {
      console.log(`[harvest] 429 on ${url}, backing off 10s...`);
      await sleep(10000);
      return getJson(url, retry - 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return await res.json();
  } catch (err) {
    if (retry > 0) {
      await sleep(2000);
      return getJson(url, retry - 1);
    }
    throw err;
  }
}

/** cooked HTML → 纯文本摘要（首帖前 240 字） */
function excerptOf(cooked) {
  const text = cooked
    .replace(/<pre[\s\S]*?<\/pre>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 240);
}

const REPO_RE = /https?:\/\/(github\.com|gitee\.com|gitcode\.com|gitlab\.com)\/[^\s"'<>)]+/g;
const PAN_HOSTS = [
  "lanzou", // 蓝奏系（lanzoul/lanzouw/...）
  "pan.baidu.com",
  "alipan.com",
  "aliyundrive.com",
  "pan.quark.cn",
  "123pan.com",
  "ctfile.com",
  "wwi.lanzoup.com",
  "cowtransfer.com",
  "wenshushu.cn",
];
const ATTACHMENT_RE = /href="(\/uploads\/[^"]+\.(?:zip|rar|7z|tar\.gz|skill|md|txt)[^"]*)"/g;

/** 首帖里的技能获取渠道分类：repo / pan / attachment（图片不算） */
function extractSources(cooked) {
  const repos = [...new Set(cooked.match(REPO_RE) ?? [])].filter(
    (u) => !/\/(issues|pulls|wiki)\b/.test(u)
  );
  const allLinks = [...cooked.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const pans = [
    ...new Set(
      allLinks.filter((u) => /^https?:\/\//.test(u) && PAN_HOSTS.some((h) => u.includes(h)))
    ),
  ];
  const attachments = [...new Set([...cooked.matchAll(ATTACHMENT_RE)].map((m) => BASE + m[1]))];
  return { repos, pans, attachments };
}

async function main() {
  console.log("[harvest] listing category topics...");
  const topics = [];
  let page = 0;
  while (topics.length < LIMIT) {
    const data = await getJson(`${BASE}${CATEGORY_PATH}?page=${page}`);
    const batch = data?.topic_list?.topics ?? [];
    if (batch.length === 0) break;
    topics.push(...batch);
    console.log(`[harvest] page ${page}: +${batch.length} (total ${topics.length})`);
    if (!data.topic_list.more_topics_url) break;
    page += 1;
    await sleep(DELAY_MS);
  }

  const items = [];
  const picked = topics.slice(0, LIMIT);
  for (const [i, t] of picked.entries()) {
    await sleep(DELAY_MS);
    let detail;
    try {
      detail = await getJson(`${BASE}/t/${t.id}.json`);
    } catch (err) {
      console.log(`[harvest] skip topic ${t.id}: ${err.message}`);
      continue;
    }
    const first = detail?.post_stream?.posts?.[0];
    if (!first) continue;
    const sources = extractSources(first.cooked ?? "");
    const sourceKind =
      sources.repos.length > 0
        ? "repo"
        : sources.pans.length > 0
          ? "pan"
          : sources.attachments.length > 0
            ? "attachment"
            : "none";
    items.push({
      topicId: t.id,
      title: t.title,
      url: `${BASE}/t/${t.slug}/${t.id}`,
      author: first.username,
      createdAt: t.created_at,
      views: t.views ?? 0,
      likeCount: t.like_count ?? 0,
      postsCount: t.posts_count ?? 0,
      tags: (t.tags ?? []).map((x) => (typeof x === "string" ? x : x.name)).filter(Boolean),
      excerpt: excerptOf(first.cooked ?? ""),
      sourceKind,
      repos: sources.repos,
      pans: sources.pans,
      attachments: sources.attachments,
    });
    if ((i + 1) % 50 === 0) console.log(`[harvest] detailed ${i + 1}/${picked.length}`);
  }

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        source: `${BASE}/c/37-category/37`,
        license_note:
          "索引仅含公开元数据与原帖回链，技能本体归原作者所有，获取请回原帖/原仓库。",
        fetchedAt: new Date().toISOString(),
        count: items.length,
        items,
      },
      null,
      2
    )
  );
  const byKind = {};
  for (const it of items) byKind[it.sourceKind] = (byKind[it.sourceKind] ?? 0) + 1;
  console.log(`[harvest] done: ${items.length} items ->`, byKind, `-> ${OUT_PATH}`);
}

await main();
