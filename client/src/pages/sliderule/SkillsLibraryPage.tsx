/**
 * SkillsLibraryPage — 技能库 marketplace（TRAE 论坛 SOLO 技能创作赛）。
 *
 * 形态对齐 TRAE 技能市场：技能市场 / 已安装 双 tab，装完即用——
 *   - 技能市场：889 项索引（搜索/渠道筛选/回链原帖）；带语义档案的
 *     543 项可「安装」，纯图文帖诚实禁用（没有可执行定义就不装样子）；
 *   - 已安装：技能卡直接输入试跑（POST /aigc-tryrun 真 LLM 通道，
 *     技能描述作为任务上下文），输出/失败如实展示；可卸载。
 *
 * 合规定位不变：索引 + 回链，技能本体归原作者；安装的是"语义档案"
 * （名称/描述/IO 线索），不是搬运的代码。数据从 @/data 静态导入，
 * 打进本页懒加载 chunk。
 */

import React from "react";
import { Button, Empty, Input, message, Segmented, Table, Tag, Tooltip } from "antd";
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileZipOutlined,
  GithubOutlined,
  LinkOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import skillsIndex from "@/data/trae-skills-index.json";
import skillSemantics from "@/data/skill-semantics.json";
import featuredSkills from "@/data/featured-skills.json";
import {
  installKeyOf,
  installSkill,
  isInstalled,
  loadInstalledSkills,
  uninstallSkill,
  type InstalledSkill,
} from "./installed-skills";

/** 服务端原版技能包元数据（GET /skill-packages；Python 不在场时优雅缺席） */
interface SkillPackageMeta {
  id: string;
  repo: string;
  path: string;
  sourceUrl: string;
  license: string;
  name: string;
  description: string;
  truncated: boolean;
  contentChars: number;
}

interface SkillIndexItem {
  topicId: number;
  title: string;
  url: string;
  author: string;
  createdAt: string;
  views: number;
  likeCount: number;
  postsCount: number;
  tags: string[];
  excerpt: string;
  sourceKind: "repo" | "pan" | "attachment" | "none" | string;
  repos: string[];
  pans: string[];
  attachments: string[];
}

interface SkillSemanticsItem {
  repo: string;
  url: string;
  license: string;
  name: string;
  description: string;
  ioHints: string[];
  topicIds: number[];
}

const INDEX = skillsIndex as {
  source: string;
  license_note: string;
  fetchedAt: string;
  count: number;
  items: SkillIndexItem[];
};

const SEMANTICS = (skillSemantics as { items: SkillSemanticsItem[] }).items;

/** 精选层：官方/大厂出品的开源 Skill（用户提供的 TRAE 官方市场清单） */
interface FeaturedSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
}

const FEATURED = (featuredSkills as { items: FeaturedSkill[] }).items;
const FEATURED_CATEGORIES = ["全部", ...new Set(FEATURED.map((f) => f.category))];

// topicId → 语义档案（description 非空才算"可安装定义"）
const SEMANTICS_BY_TOPIC = new Map<number, SkillSemanticsItem>();
for (const sem of SEMANTICS) {
  if (!sem.description) continue;
  for (const tid of sem.topicIds) {
    if (!SEMANTICS_BY_TOPIC.has(tid)) SEMANTICS_BY_TOPIC.set(tid, sem);
  }
}

const KIND_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  repo: { label: "开源仓库", color: "green", icon: <GithubOutlined /> },
  pan: { label: "网盘分发", color: "blue", icon: <CloudDownloadOutlined /> },
  attachment: { label: "论坛附件", color: "purple", icon: <FileZipOutlined /> },
  none: { label: "图文介绍", color: "default", icon: <LinkOutlined /> },
};

const KIND_FILTERS = [
  { label: "全部", value: "all" },
  { label: "开源仓库", value: "repo" },
  { label: "网盘分发", value: "pan" },
  { label: "论坛附件", value: "attachment" },
  { label: "图文介绍", value: "none" },
];

/** 已安装技能卡：输入 → /aigc-tryrun 真 LLM 试跑 → 输出/失败如实展示 */
function InstalledSkillCard({
  skill,
  onUninstall,
}: {
  skill: InstalledSkill;
  onUninstall: (repo: string) => void;
}) {
  const [input, setInput] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [output, setOutput] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = async () => {
    if (running || !input.trim()) return;
    setRunning(true);
    setOutput(null);
    setError(null);
    try {
      // 原版技能包：完整 SKILL.md 指令在服务端做 system prompt（真·原版执行）；
      // 语义档案：技能定位描述作为任务上下文（转述驱动，fallback 档）
      const res = skill.kind === "package" && skill.packageId
        ? await fetch("/api/sliderule/skill-package-tryrun", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ packageId: skill.packageId, input }),
          })
        : await fetch("/api/sliderule/aigc-tryrun", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              capability: {
                id: skill.repo.replace(/[^a-zA-Z0-9]+/g, "_"),
                name: skill.name,
                inputFields: ["skill.input"],
                outputField: "skill.output",
              },
              inputs: { "skill.input": input },
              goal: `${skill.name}：${skill.description}`,
            }),
          });
      const body = res.ok
        ? ((await res.json()) as { ok: boolean; output?: string; code?: string; detail?: string })
        : { ok: false, code: `HTTP_${res.status}`, detail: await res.text() };
      if (!body.ok || body.output === undefined) {
        setError(`${body.code ?? "UNKNOWN"}${body.detail ? ` · ${body.detail.slice(0, 160)}` : ""}`);
      } else {
        setOutput(body.output);
      }
    } catch (e) {
      setError(`NETWORK_ERROR · ${String(e).slice(0, 160)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="rounded-md border border-stone-200 bg-white p-3 shadow-sm"
      data-testid={`installed-skill-${skill.repo}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-stone-800">{skill.name}</span>
        {skill.kind === "package" ? (
          <Tooltip title="试跑时原作者的完整 SKILL.md 指令作为 system prompt 执行">
            <Tag color="green" style={{ fontSize: 10, marginInlineEnd: 0 }}>
              原版 SKILL.md
            </Tag>
          </Tooltip>
        ) : (
          <Tooltip title="该仓库未抓到 SKILL.md，按语义档案（名称/描述）驱动执行">
            <Tag color="default" style={{ fontSize: 10, marginInlineEnd: 0 }}>
              语义档案
            </Tag>
          </Tooltip>
        )}
        <Tag color="default" style={{ fontSize: 10, marginInlineEnd: 0 }}>
          {skill.license}
        </Tag>
        {skill.url ? (
          <a
            href={skill.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-stone-400 hover:text-blue-600"
          >
            {skill.repo}
          </a>
        ) : (
          <span className="font-mono text-[10px] text-stone-400">{skill.repo}</span>
        )}
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          className="ml-auto"
          onClick={() => onUninstall(installKeyOf(skill))}
          title="卸载（只移除本地安装，不影响原仓库）"
        >
          卸载
        </Button>
      </div>
      <div className="mt-1 text-xs text-stone-500">{skill.description}</div>
      {skill.ioHints.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {skill.ioHints.slice(0, 3).map((h) => (
            <div key={h} className="font-mono text-[10px] text-stone-400">
              {h}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-start gap-2">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="给这个技能输入内容，立即试跑（真 LLM，走服务端通道）"
          autoSize={{ minRows: 1, maxRows: 4 }}
        />
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={running}
          disabled={!input.trim()}
          onClick={run}
          data-testid="installed-skill-run"
        >
          试跑
        </Button>
      </div>
      {output !== null && (
        <div className="mt-2 whitespace-pre-wrap rounded bg-stone-50 p-2.5 text-xs leading-5 text-stone-700 ring-1 ring-stone-200">
          {output}
        </div>
      )}
      {error !== null && (
        <div className="mt-2 rounded bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600 ring-1 ring-red-200">
          试跑失败：{error}
        </div>
      )}
    </div>
  );
}

export function SkillsLibraryPage({
  initialTab = "featured",
}: {
  /** 初始 tab（测试用；产品默认精选层） */
  initialTab?: "featured" | "market" | "installed";
} = {}) {
  const [tab, setTab] = React.useState<"featured" | "market" | "installed">(initialTab);
  const [featuredCat, setFeaturedCat] = React.useState("全部");
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<string>("all");
  const [installed, setInstalled] = React.useState<InstalledSkill[]>(() => loadInstalledSkills());
  // 原版技能包元数据（服务端）：Python 不在场（Pages 演示/后端未起）时为空，
  // 页面优雅回退到语义档案安装——不装样子也不报错刷屏
  const [packages, setPackages] = React.useState<SkillPackageMeta[]>([]);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/sliderule/skill-packages")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { items?: SkillPackageMeta[] } | null) => {
        if (alive && body && Array.isArray(body.items)) setPackages(body.items);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const packagesByRepo = React.useMemo(() => {
    const map = new Map<string, SkillPackageMeta[]>();
    for (const p of packages) {
      const list = map.get(p.repo) ?? [];
      list.push(p);
      map.set(p.repo, list);
    }
    return map;
  }, [packages]);

  // 索引行 → 该行仓库对应的技能包（经 repos 链接归一化出 host/owner/repo 键）
  const packagesOfRow = React.useCallback(
    (it: SkillIndexItem): SkillPackageMeta[] => {
      const out: SkillPackageMeta[] = [];
      for (const link of it.repos) {
        const m = /https?:\/\/(github\.com|gitee\.com|gitcode\.com)\/([^/\s]+)\/([^/\s#?]+)/.exec(link);
        if (!m) continue;
        const key = `${m[1]}/${m[2]}/${m[3].replace(/\.git$/, "")}`;
        for (const p of packagesByRepo.get(key) ?? []) {
          if (!out.some((x) => x.id === p.id)) out.push(p);
        }
      }
      return out;
    },
    [packagesByRepo]
  );

  const installPackage = (pkg: SkillPackageMeta) => {
    setInstalled((prev) => {
      const next = installSkill(prev, {
        repo: pkg.repo,
        url: pkg.sourceUrl,
        license: pkg.license,
        name: pkg.name,
        description: pkg.description,
        ioHints: [],
        kind: "package",
        packageId: pkg.id,
      });
      if (next !== prev) message.success(`已安装「${pkg.name}」（原版 SKILL.md），到「已安装」直接试跑`);
      return next;
    });
  };

  const items = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return INDEX.items
      .filter((it) => (kind === "all" ? true : it.sourceKind === kind))
      .filter(
        (it) =>
          !q ||
          it.title.toLowerCase().includes(q) ||
          it.excerpt.toLowerCase().includes(q) ||
          it.author.toLowerCase().includes(q)
      )
      .sort((a, b) => b.views - a.views);
  }, [query, kind]);

  const kindCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of INDEX.items) counts[it.sourceKind] = (counts[it.sourceKind] ?? 0) + 1;
    return counts;
  }, []);

  const installFeatured = (f: FeaturedSkill) => {
    setInstalled((prev) => {
      const next = installSkill(prev, {
        repo: `trae-market/${f.id}`,
        url: "",
        license: "官方市场",
        name: f.name,
        description: f.description,
        ioHints: [],
        kind: "semantic",
      });
      if (next !== prev) message.success(`已安装「${f.name}」，到「已安装」里直接试跑`);
      return next;
    });
  };

  const handleInstall = (sem: SkillSemanticsItem) => {
    setInstalled((prev) => {
      const next = installSkill(prev, {
        repo: sem.repo,
        url: sem.url,
        license: sem.license,
        name: sem.name,
        description: sem.description,
        ioHints: sem.ioHints,
        kind: "semantic",
      });
      if (next !== prev) message.success(`已安装「${sem.name}」，到「已安装」里直接试跑`);
      return next;
    });
  };

  return (
    // 块级流式 + 整页滚动：不用 flex-col 分高度——内容超高时 flex 子项会被
    // 压缩（筛选行被压到 0 高、表格盖上来，实测踩过）
    <div className="mx-auto h-full max-w-[1080px] space-y-3 overflow-auto p-5" data-testid="skills-library">
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-stone-800">技能库</h1>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">
            {FEATURED.length + INDEX.count} 项
          </span>
        </div>
        <div className="mt-0.5 text-xs text-stone-400">
          来自官方技能市场与 TRAE 社区「SOLO 技能创作赛」的优质 Skill，覆盖产品、研发、设计、运营等多个领域。
        </div>
      </div>

      {/* 统计卡（全部真数据，不造假指标） */}
      <div className="flex flex-wrap gap-2.5">
        {[
          { label: "精选技能", value: FEATURED.length, sub: "官方/大厂出品", tone: "bg-blue-50 text-blue-600" },
          { label: "社区技能", value: INDEX.count, sub: "SOLO 创作赛索引", tone: "bg-emerald-50 text-emerald-600" },
          {
            label: "原版 SKILL.md",
            value: packages.length > 0 ? packages.length : "—",
            sub: packages.length > 0 ? "装完即按原指令执行" : "需 Python 服务在线",
            tone: "bg-purple-50 text-purple-600",
          },
          { label: "已安装", value: installed.length, sub: "本地即装即用", tone: "bg-orange-50 text-orange-600" },
        ].map((s) => (
          <div key={s.label} className="min-w-[150px] flex-1 rounded-lg border border-stone-200 bg-white px-3.5 py-2.5" data-testid={`skills-stat-${s.label}`}>
            <div className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${s.tone}`}>{s.label}</div>
            <div className="mt-1 text-xl font-semibold text-stone-800">{s.value}</div>
            <div className="text-[10px] text-stone-400">{s.sub}</div>
          </div>
        ))}
        <div className="min-w-[220px] flex-[1.4] rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <div className="text-[11px] font-semibold text-amber-700">✦ 合规说明</div>
          <div className="mt-1 text-[10px] leading-4 text-amber-700/90">
            {INDEX.license_note} 采集于 {INDEX.fetchedAt.slice(0, 10)}，
            <a href={INDEX.source} target="_blank" rel="noreferrer" className="underline">
              来源论坛
            </a>
            。
          </div>
        </div>
      </div>

      <Segmented
        options={[
          { label: `精选技能 ${FEATURED.length}`, value: "featured" },
          { label: `社区技能 ${INDEX.count}`, value: "market" },
          { label: `已安装 ${installed.length}`, value: "installed" },
        ]}
        value={tab}
        onChange={(v) => setTab(v as "featured" | "market" | "installed")}
        data-testid="skills-tab"
      />

      {tab === "featured" && (
        <>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="skills-featured-cats">
            {FEATURED_CATEGORIES.map((cat) => {
              const count = cat === "全部" ? FEATURED.length : FEATURED.filter((f) => f.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFeaturedCat(cat)}
                  className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                    featuredCat === cat
                      ? "bg-stone-800 text-white"
                      : "bg-white text-stone-500 ring-1 ring-stone-200 hover:text-stone-700"
                  }`}
                >
                  {cat} {count}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2" data-testid="skills-featured-grid">
            {FEATURED.filter((f) => featuredCat === "全部" || f.category === featuredCat).map((f) => {
              const done = isInstalled(installed, `trae-market/${f.id}`);
              return (
                <div key={f.id} className="flex gap-3 rounded-lg border border-stone-200 bg-white p-3.5" data-testid={`featured-skill-${f.id}`}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-stone-100 text-sm font-semibold text-stone-500">
                    {f.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-stone-800">{f.name}</span>
                      <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>{f.category}</Tag>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-stone-500">{f.description}</div>
                    <div className="mt-1 text-[10px] text-stone-400">by {f.author}</div>
                  </div>
                  <div className="shrink-0 self-center">
                    {done ? (
                      <Tag color="success" style={{ marginInlineEnd: 0 }}>
                        ✓
                      </Tag>
                    ) : (
                      <Button size="small" type="primary" ghost icon={<DownloadOutlined />} onClick={() => installFeatured(f)}>
                        安装
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "installed" && (
        <div className="space-y-2.5" data-testid="skills-installed-list">
          {installed.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没安装技能 — 到「精选技能」或「社区技能」装一个，装完立即可试跑"
            />
          ) : (
            installed.map((s) => (
              <InstalledSkillCard
                key={installKeyOf(s)}
                skill={s}
                onUninstall={(key) => setInstalled((prev) => uninstallSkill(prev, key))}
              />
            ))
          )}
        </div>
      )}

      {tab === "market" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input.Search
              allowClear
              placeholder="搜索标题 / 摘要 / 作者"
              style={{ maxWidth: 320 }}
              onSearch={setQuery}
              onChange={(e) => {
                if (!e.target.value) setQuery("");
              }}
              data-testid="skills-search"
            />
            <Segmented
              options={KIND_FILTERS.map((f) => ({
                ...f,
                label:
                  f.value === "all" ? `全部 ${INDEX.count}` : `${f.label} ${kindCounts[f.value] ?? 0}`,
              }))}
              value={kind}
              onChange={(v) => setKind(String(v))}
              data-testid="skills-kind-filter"
            />
          </div>

          <Table<SkillIndexItem>
            size="small"
            rowKey="topicId"
            dataSource={items}
            pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 项` }}
            expandable={{
              expandedRowRender: (it) => (
                <div className="space-y-1.5 py-1 text-xs text-stone-600">
                  <div>{it.excerpt || "（无摘要）"}</div>
                  {packagesOfRow(it).length > 1 && (
                    <div className="space-y-1 rounded bg-stone-50 p-2 ring-1 ring-stone-200">
                      <div className="text-[10px] font-medium text-stone-500">
                        合集仓库 · {packagesOfRow(it).length} 个原版技能（可单装）
                      </div>
                      {packagesOfRow(it).map((pkg) => (
                        <div key={pkg.id} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-medium text-stone-700">{pkg.name}</span>
                            {pkg.description && (
                              <span className="ml-1.5 text-[10px] text-stone-400">{pkg.description.slice(0, 60)}</span>
                            )}
                          </span>
                          {isInstalled(installed, pkg.id) ? (
                            <Tag color="success" style={{ marginInlineEnd: 0, fontSize: 10 }}>
                              ✓
                            </Tag>
                          ) : (
                            <Button size="small" type="link" onClick={() => installPackage(pkg)}>
                              安装
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {(it.repos.length > 0 || it.pans.length > 0 || it.attachments.length > 0) && (
                    <div className="flex flex-wrap gap-2">
                      {[...it.repos, ...it.pans, ...it.attachments].map((link) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[10px] text-blue-600 hover:underline"
                        >
                          {link.length > 72 ? `${link.slice(0, 72)}…` : link}
                        </a>
                      ))}
                    </div>
                  )}
                  {it.tags.length > 0 && (
                    <div>
                      {it.tags.map((t) => (
                        <Tag key={t} style={{ fontSize: 10 }}>
                          {t}
                        </Tag>
                      ))}
                    </div>
                  )}
                </div>
              ),
            }}
            columns={[
              {
                title: "技能",
                dataIndex: "title",
                ellipsis: true,
                render: (_: unknown, it: SkillIndexItem) => (
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-stone-800 hover:text-blue-600"
                    title="打开原帖（技能获取以原帖为准）"
                  >
                    {it.title}
                  </a>
                ),
              },
              {
                title: "作者",
                dataIndex: "author",
                width: 120,
                ellipsis: true,
                sorter: (a, b) => a.author.localeCompare(b.author, "zh"),
              },
              {
                title: "获取渠道",
                dataIndex: "sourceKind",
                width: 106,
                filters: KIND_FILTERS.filter((f) => f.value !== "all").map((f) => ({
                  text: f.label,
                  value: f.value,
                })),
                onFilter: (v, it) => it.sourceKind === v,
                render: (v: string) => {
                  const meta = KIND_META[v] ?? KIND_META.none;
                  return (
                    <Tooltip title={v === "none" ? "原帖仅图文介绍，未附交付物" : "展开行可见链接"}>
                      <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
                        {meta.label}
                      </Tag>
                    </Tooltip>
                  );
                },
              },
              {
                title: "浏览",
                dataIndex: "views",
                width: 78,
                sorter: (a, b) => a.views - b.views,
                defaultSortOrder: "descend",
              },
              {
                title: "赞",
                dataIndex: "likeCount",
                width: 62,
                sorter: (a, b) => a.likeCount - b.likeCount,
              },
              {
                title: "发布",
                dataIndex: "createdAt",
                width: 100,
                sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
                render: (v: string) => <span className="text-stone-400">{v.slice(0, 10)}</span>,
              },
              {
                title: "",
                key: "__install",
                width: 104,
                render: (_: unknown, it: SkillIndexItem) => {
                  // 优先原版技能包（完整 SKILL.md）；无包退语义档案；都没有诚实禁用
                  const rowPkgs = packagesOfRow(it);
                  if (rowPkgs.length === 1) {
                    const pkg = rowPkgs[0];
                    return isInstalled(installed, pkg.id) ? (
                      <Tag color="success" style={{ marginInlineEnd: 0 }}>
                        ✓ 已安装
                      </Tag>
                    ) : (
                      <Tooltip title="原版 SKILL.md 指令，装完即用">
                        <Button
                          size="small"
                          type="primary"
                          icon={<DownloadOutlined />}
                          onClick={() => installPackage(pkg)}
                          data-testid={`skill-install-${it.topicId}`}
                        >
                          安装
                        </Button>
                      </Tooltip>
                    );
                  }
                  if (rowPkgs.length > 1) {
                    const fresh = rowPkgs.filter((p) => !isInstalled(installed, p.id));
                    return fresh.length === 0 ? (
                      <Tag color="success" style={{ marginInlineEnd: 0 }}>
                        ✓ 已装 {rowPkgs.length}
                      </Tag>
                    ) : (
                      <Tooltip title={`合集仓库含 ${rowPkgs.length} 个技能（展开行可单装），点击全部安装`}>
                        <Button
                          size="small"
                          type="primary"
                          icon={<DownloadOutlined />}
                          onClick={() => fresh.forEach(installPackage)}
                          data-testid={`skill-install-${it.topicId}`}
                        >
                          装 {fresh.length} 技能
                        </Button>
                      </Tooltip>
                    );
                  }
                  const sem = SEMANTICS_BY_TOPIC.get(it.topicId);
                  if (!sem) {
                    return (
                      <Tooltip title="该帖未提供可安装的技能定义（无 SKILL.md 也无语义档案）">
                        <Button
                          size="small"
                          disabled
                          icon={<DownloadOutlined />}
                          data-testid={`skill-install-disabled-${it.topicId}`}
                        >
                          安装
                        </Button>
                      </Tooltip>
                    );
                  }
                  const done = isInstalled(installed, sem.repo);
                  return done ? (
                    <Tag color="success" style={{ marginInlineEnd: 0 }}>
                      ✓ 已安装
                    </Tag>
                  ) : (
                    <Tooltip title="未抓到 SKILL.md，按语义档案安装（转述驱动）">
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        icon={<DownloadOutlined />}
                        onClick={() => handleInstall(sem)}
                        data-testid={`skill-install-${it.topicId}`}
                      >
                        安装
                      </Button>
                    </Tooltip>
                  );
                },
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

export default SkillsLibraryPage;
