/**
 * SkillsLibraryPage — 技能库 marketplace（精选 / 社区 / 已安装 三层）。
 *
 * 布局（用户效果图裁决）：全宽（不设最大宽度，16:9 屏一行三卡）、
 * 精选与社区统一卡片风格（同一 SkillCard 组件，统一好维护）、
 * 顶部统计卡全部真数据、右上「技能提交指南」直链论坛真实指南帖。
 *
 * 三层语义：
 *   - 精选：官方技能市场清单（72 项，语义档案驱动试跑）；
 *   - 社区：SOLO 创作赛索引（889 项；378 仓库带原版 SKILL.md 可装
 *     855 个原版技能，合集可展开单装；无包退语义档案，都没有诚实禁用）；
 *   - 已安装：装完即用（原版 SKILL.md / 语义档案 两档徽标区分）。
 *
 * 合规定位不变：索引 + 回链，技能本体归原作者；安装的是执行档案。
 */

import React from "react";
import {
  Button,
  Empty,
  Input,
  message,
  Pagination,
  Popover,
  Select,
  Tag,
  Tooltip,
} from "antd";
import {
  BookOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileMarkdownOutlined,
  FileZipOutlined,
  GithubOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
  TeamOutlined,
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

interface FeaturedSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
}

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

const INDEX = skillsIndex as {
  source: string;
  license_note: string;
  fetchedAt: string;
  count: number;
  items: SkillIndexItem[];
};

const SEMANTICS = (skillSemantics as { items: SkillSemanticsItem[] }).items;
const FEATURED = (featuredSkills as { items: FeaturedSkill[] }).items;
const FEATURED_CATEGORIES = ["全部", ...new Set(FEATURED.map(f => f.category))];

// topicId → 语义档案（description 非空才算"可安装定义"）
const SEMANTICS_BY_TOPIC = new Map<number, SkillSemanticsItem>();
for (const sem of SEMANTICS) {
  if (!sem.description) continue;
  for (const tid of sem.topicIds) {
    if (!SEMANTICS_BY_TOPIC.has(tid)) SEMANTICS_BY_TOPIC.set(tid, sem);
  }
}

const KIND_META: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
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

// 字母头像的柔和色轮（按名称哈希稳定取色）
const AVATAR_TONES = [
  "bg-blue-100 text-blue-600",
  "bg-emerald-100 text-emerald-600",
  "bg-purple-100 text-purple-600",
  "bg-orange-100 text-orange-600",
  "bg-pink-100 text-pink-600",
  "bg-cyan-100 text-cyan-600",
];

function avatarToneOf(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/** 统一技能卡（精选/社区共用——统一风格，统一好维护） */
function SkillCard({
  name,
  titleHref,
  tags,
  description,
  author,
  meta,
  action,
  testid,
}: {
  name: string;
  titleHref?: string;
  tags: React.ReactNode;
  description: string;
  author: string;
  meta?: React.ReactNode;
  action: React.ReactNode;
  testid?: string;
}) {
  return (
    <div
      className="flex gap-3 rounded-lg border border-stone-200 bg-white p-3.5"
      data-testid={testid}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold ${avatarToneOf(name)}`}
      >
        {name
          .replace(/[^\p{L}\p{N}]/gu, "")
          .slice(0, 1)
          .toUpperCase() || "S"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {titleHref ? (
            <a
              href={titleHref}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm font-semibold text-stone-800 hover:text-blue-600"
              title="打开原帖（技能获取以原帖为准）"
            >
              {name}
            </a>
          ) : (
            <span className="truncate text-sm font-semibold text-stone-800">
              {name}
            </span>
          )}
          {tags}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-stone-500">
          {description || "（无摘要）"}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-stone-400">
          <span>by {author}</span>
          {meta}
        </div>
      </div>
      <div className="shrink-0 self-center">{action}</div>
    </div>
  );
}

/** 已安装技能卡：输入 → 试跑（原版 SKILL.md 走 /skill-package-tryrun，语义档案走 /aigc-tryrun） */
function InstalledSkillCard({
  skill,
  onUninstall,
}: {
  skill: InstalledSkill;
  onUninstall: (key: string) => void;
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
      const res =
        skill.kind === "package" && skill.packageId
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
        ? ((await res.json()) as {
            ok: boolean;
            output?: string;
            code?: string;
            detail?: string;
          })
        : { ok: false, code: `HTTP_${res.status}`, detail: await res.text() };
      if (!body.ok || body.output === undefined) {
        setError(
          `${body.code ?? "UNKNOWN"}${body.detail ? ` · ${body.detail.slice(0, 160)}` : ""}`
        );
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
      className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm"
      data-testid={`installed-skill-${skill.repo}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-stone-800">
          {skill.name}
        </span>
        {skill.kind === "package" ? (
          <Tooltip title="试跑时原作者的完整 SKILL.md 指令作为 system prompt 执行">
            <Tag color="green" style={{ fontSize: 10, marginInlineEnd: 0 }}>
              原版 SKILL.md
            </Tag>
          </Tooltip>
        ) : (
          <Tooltip title="按语义档案（名称/描述）驱动执行">
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
          <span className="font-mono text-[10px] text-stone-400">
            {skill.repo}
          </span>
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
          {skill.ioHints.slice(0, 3).map(h => (
            <div key={h} className="font-mono text-[10px] text-stone-400">
              {h}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-start gap-2">
        <Input.TextArea
          value={input}
          onChange={e => setInput(e.target.value)}
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
  const [tab, setTab] = React.useState<"featured" | "market" | "installed">(
    initialTab
  );
  const [featuredCat, setFeaturedCat] = React.useState("全部");
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<string>("all");
  const [sort, setSort] = React.useState<"views" | "likes" | "latest">("views");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(21);
  const [installed, setInstalled] = React.useState<InstalledSkill[]>(() =>
    loadInstalledSkills()
  );
  const [packages, setPackages] = React.useState<SkillPackageMeta[]>([]);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/sliderule/skill-packages")
      .then(res => (res.ok ? res.json() : null))
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

  const packagesOfRow = React.useCallback(
    (it: SkillIndexItem): SkillPackageMeta[] => {
      const out: SkillPackageMeta[] = [];
      for (const link of it.repos) {
        const m =
          /https?:\/\/(github\.com|gitee\.com|gitcode\.com)\/([^/\s]+)\/([^/\s#?]+)/.exec(
            link
          );
        if (!m) continue;
        const key = `${m[1]}/${m[2]}/${m[3].replace(/\.git$/, "")}`;
        for (const p of packagesByRepo.get(key) ?? []) {
          if (!out.some(x => x.id === p.id)) out.push(p);
        }
      }
      return out;
    },
    [packagesByRepo]
  );

  const installPackage = (pkg: SkillPackageMeta) => {
    setInstalled(prev => {
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
      if (next !== prev)
        message.success(
          `已安装「${pkg.name}」（原版 SKILL.md），到「已安装」直接试跑`
        );
      return next;
    });
  };

  const installFeatured = (f: FeaturedSkill) => {
    setInstalled(prev => {
      const next = installSkill(prev, {
        repo: `trae-market/${f.id}`,
        url: "",
        license: "官方市场",
        name: f.name,
        description: f.description,
        ioHints: [],
        kind: "semantic",
      });
      if (next !== prev)
        message.success(`已安装「${f.name}」，到「已安装」里直接试跑`);
      return next;
    });
  };

  const installSemantic = (sem: SkillSemanticsItem) => {
    setInstalled(prev => {
      const next = installSkill(prev, {
        repo: sem.repo,
        url: sem.url,
        license: sem.license,
        name: sem.name,
        description: sem.description,
        ioHints: sem.ioHints,
        kind: "semantic",
      });
      if (next !== prev)
        message.success(`已安装「${sem.name}」，到「已安装」里直接试跑`);
      return next;
    });
  };

  // 社区层：筛选 + 排序 + 分页
  const communityItems = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = INDEX.items
      .filter(it => (kind === "all" ? true : it.sourceKind === kind))
      .filter(
        it =>
          !q ||
          it.title.toLowerCase().includes(q) ||
          it.excerpt.toLowerCase().includes(q) ||
          it.author.toLowerCase().includes(q)
      );
    return filtered.sort((a, b) =>
      sort === "views"
        ? b.views - a.views
        : sort === "likes"
          ? b.likeCount - a.likeCount
          : b.createdAt.localeCompare(a.createdAt)
    );
  }, [query, kind, sort]);

  const pagedCommunity = communityItems.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  const featuredItems = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return FEATURED.filter(
      f => featuredCat === "全部" || f.category === featuredCat
    ).filter(
      f =>
        !q ||
        f.name.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.author.toLowerCase().includes(q)
    );
  }, [featuredCat, query]);

  // 真实的投稿指南帖（索引里就有——右上按钮直链，不造假入口）
  const guideUrl = React.useMemo(
    () =>
      INDEX.items.find(it => it.title.includes("投稿指南"))?.url ??
      INDEX.source,
    []
  );

  /** 社区卡的安装动作：原版包 > 语义档案 > 诚实禁用；合集 Popover 单装 */
  const communityAction = (it: SkillIndexItem) => {
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
      const fresh = rowPkgs.filter(p => !isInstalled(installed, p.id));
      if (fresh.length === 0) {
        return (
          <Tag color="success" style={{ marginInlineEnd: 0 }}>
            ✓ 已装 {rowPkgs.length}
          </Tag>
        );
      }
      return (
        <Popover
          trigger="click"
          placement="bottomRight"
          content={
            <div
              style={{ maxHeight: 260, overflow: "auto", width: 320 }}
              className="space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-stone-500">
                  合集 · {rowPkgs.length} 个原版技能
                </span>
                <Button
                  size="small"
                  type="link"
                  onClick={() => fresh.forEach(installPackage)}
                >
                  全部安装
                </Button>
              </div>
              {rowPkgs.map(pkg => (
                <div key={pkg.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-stone-700">
                    {pkg.name}
                  </span>
                  {isInstalled(installed, pkg.id) ? (
                    <Tag
                      color="success"
                      style={{ marginInlineEnd: 0, fontSize: 10 }}
                    >
                      ✓
                    </Tag>
                  ) : (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => installPackage(pkg)}
                    >
                      安装
                    </Button>
                  )}
                </div>
              ))}
            </div>
          }
        >
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            data-testid={`skill-install-${it.topicId}`}
          >
            装 {fresh.length} 技能
          </Button>
        </Popover>
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
    return isInstalled(installed, sem.repo) ? (
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
          onClick={() => installSemantic(sem)}
          data-testid={`skill-install-${it.topicId}`}
        >
          安装
        </Button>
      </Tooltip>
    );
  };

  const STATS = [
    {
      icon: <StarOutlined />,
      label: "精选技能",
      value: FEATURED.length,
      sub: "官方/大厂出品",
      tone: "bg-blue-50 text-blue-600",
    },
    {
      icon: <TeamOutlined />,
      label: "社区技能",
      value: INDEX.count,
      sub: "SOLO 创作赛索引",
      tone: "bg-emerald-50 text-emerald-600",
    },
    {
      icon: <FileMarkdownOutlined />,
      label: "可执行 SKILL.md",
      value: packages.length > 0 ? packages.length : "—",
      sub: packages.length > 0 ? "装完即按原指令执行" : "需 Python 服务在线",
      tone: "bg-purple-50 text-purple-600",
    },
    {
      icon: <SafetyCertificateOutlined />,
      label: "已安装",
      value: installed.length,
      sub: "本地环境可用技能",
      tone: "bg-orange-50 text-orange-600",
    },
  ];

  return (
    <div
      className="h-full space-y-3.5 overflow-auto p-6"
      data-testid="skills-library"
    >
      {/* 头部：标题 + 真实投稿指南直链 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold text-stone-800">技能库</h1>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">
              {FEATURED.length + INDEX.count} 项
            </span>
          </div>
          <div className="mt-0.5 text-xs text-stone-400">
            来自官方技能市场与 TRAE 社区「SOLO 技能创作赛」的优质
            Skill，覆盖产品、研发、设计、运营等多个领域。
          </div>
        </div>
        <Button icon={<BookOutlined />} href={guideUrl} target="_blank">
          技能提交指南
        </Button>
      </div>

      {/* 统计卡（全部真数据，不造假指标） */}
      <div className="flex flex-wrap gap-2.5">
        {STATS.map(s => (
          <div
            key={s.label}
            className="min-w-[160px] flex-1 rounded-lg border border-stone-200 bg-white px-3.5 py-2.5"
            data-testid={`skills-stat-${s.label}`}
          >
            <div
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${s.tone}`}
            >
              {s.icon}
              {s.label}
            </div>
            <div className="mt-1 text-xl font-semibold text-stone-800">
              {s.value}
            </div>
            <div className="text-[10px] text-stone-400">{s.sub}</div>
          </div>
        ))}
        <div className="min-w-[240px] flex-[1.4] rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <div className="text-[11px] font-semibold text-amber-700">
            ✦ 合规说明
          </div>
          <div className="mt-1 text-[10px] leading-4 text-amber-700/90">
            {INDEX.license_note} 采集于 {INDEX.fetchedAt.slice(0, 10)}，
            <a
              href={INDEX.source}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              来源论坛
            </a>
            。
          </div>
        </div>
      </div>

      {/* 三层 tab（下划线风格） */}
      <div
        className="flex items-center gap-5 border-b border-stone-200"
        data-testid="skills-tab"
      >
        {(
          [
            { key: "featured", label: `精选技能 ${FEATURED.length}` },
            { key: "market", label: `社区技能 ${INDEX.count}` },
            { key: "installed", label: `已安装 ${installed.length}` },
          ] as const
        ).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-0.5 pb-2 text-[13px] transition-colors ${
              tab === t.key
                ? "border-blue-600 font-semibold text-blue-600"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 筛选行（精选/社区共用搜索；分档各自出） */}
      {tab !== "installed" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input.Search
            allowClear
            placeholder="搜索技能名称 / 关键词 / 作者"
            style={{ maxWidth: 340 }}
            onSearch={setQuery}
            onChange={e => {
              if (!e.target.value) setQuery("");
            }}
            data-testid="skills-search"
          />
          {tab === "featured" ? (
            <div
              className="flex flex-wrap items-center gap-1.5"
              data-testid="skills-featured-cats"
            >
              {FEATURED_CATEGORIES.map(cat => {
                const count =
                  cat === "全部"
                    ? FEATURED.length
                    : FEATURED.filter(f => f.category === cat).length;
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
          ) : (
            <>
              <div
                className="flex flex-wrap items-center gap-1.5"
                data-testid="skills-kind-filter"
              >
                {KIND_FILTERS.map(f => {
                  const count =
                    f.value === "all"
                      ? INDEX.count
                      : INDEX.items.filter(it => it.sourceKind === f.value)
                          .length;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => {
                        setKind(f.value);
                        setPage(1);
                      }}
                      className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                        kind === f.value
                          ? "bg-stone-800 text-white"
                          : "bg-white text-stone-500 ring-1 ring-stone-200 hover:text-stone-700"
                      }`}
                    >
                      {f.label} {count}
                    </button>
                  );
                })}
              </div>
              <Select
                size="small"
                value={sort}
                style={{ width: 116 }}
                onChange={v => {
                  setSort(v);
                  setPage(1);
                }}
                options={[
                  { value: "views", label: "按浏览量" },
                  { value: "likes", label: "按点赞" },
                  { value: "latest", label: "按最新发布" },
                ]}
              />
            </>
          )}
        </div>
      )}

      {/* 精选层：三列卡片 */}
      {tab === "featured" && (
        <div
          className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-3"
          data-testid="skills-featured-grid"
        >
          {featuredItems.map(f => {
            const done = isInstalled(installed, `trae-market/${f.id}`);
            return (
              <SkillCard
                key={f.id}
                testid={`featured-skill-${f.id}`}
                name={f.name}
                tags={
                  <>
                    <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>
                      {f.category}
                    </Tag>
                    <Tag
                      color="gold"
                      style={{ fontSize: 10, marginInlineEnd: 0 }}
                    >
                      精选
                    </Tag>
                  </>
                }
                description={f.description}
                author={f.author}
                action={
                  done ? (
                    <Tag color="success" style={{ marginInlineEnd: 0 }}>
                      ✓ 已安装
                    </Tag>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      icon={<DownloadOutlined />}
                      onClick={() => installFeatured(f)}
                    >
                      安装
                    </Button>
                  )
                }
              />
            );
          })}
        </div>
      )}

      {/* 社区层：同风格三列卡片 + 分页 */}
      {tab === "market" && (
        <>
          <div
            className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-3"
            data-testid="skills-community-grid"
          >
            {pagedCommunity.map(it => {
              const kindMeta = KIND_META[it.sourceKind] ?? KIND_META.none;
              return (
                <SkillCard
                  key={it.topicId}
                  testid={`community-skill-${it.topicId}`}
                  name={it.title.replace(/^【[^】]*】\s*/, "")}
                  titleHref={it.url}
                  tags={
                    <Tag
                      color={kindMeta.color}
                      icon={kindMeta.icon}
                      style={{ fontSize: 10, marginInlineEnd: 0 }}
                    >
                      {kindMeta.label}
                    </Tag>
                  }
                  description={it.excerpt}
                  author={it.author}
                  meta={
                    <>
                      <span>浏览 {it.views}</span>
                      <span>赞 {it.likeCount}</span>
                      <span>{it.createdAt.slice(0, 10)}</span>
                    </>
                  }
                  action={communityAction(it)}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-stone-400">
              共 {communityItems.length} 项
            </span>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={communityItems.length}
              showSizeChanger
              pageSizeOptions={[21, 42, 63]}
              onChange={(p, ps) => {
                setPage(ps !== pageSize ? 1 : p);
                setPageSize(ps);
              }}
            />
          </div>
        </>
      )}

      {/* 已安装层 */}
      {tab === "installed" && (
        <div className="space-y-2.5" data-testid="skills-installed-list">
          {installed.length > 0 && (
            <div className="rounded bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-700 ring-1 ring-blue-200">
              已安装技能会注入新推演（最多前 6
              个）：下次推演产出的应用会把它们设计成对应的 AIGC
              能力（字段绑定仍过门禁硬校验）。
            </div>
          )}
          {installed.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没安装技能 — 到「精选技能」或「社区技能」装一个，装完立即可试跑"
            />
          ) : (
            installed.map(s => (
              <InstalledSkillCard
                key={installKeyOf(s)}
                skill={s}
                onUninstall={key =>
                  setInstalled(prev => uninstallSkill(prev, key))
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default SkillsLibraryPage;
