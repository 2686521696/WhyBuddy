/**
 * SkillsLibraryPage — 技能库（精选 / 已安装 两层）。
 *
 * 布局：全宽（16:9 屏一行三卡）、统一 SkillCard 风格、统计卡真数据。
 *
 * 2026-07-27 下架「社区技能」层，一并移除 889 条论坛索引、855 份完整
 * SKILL.md 正文、543 份语义档案与三个采集脚本（约 11.7MB）。两个理由：
 *   1. 协议敞口——正文那批 49% 的原仓库没有 LICENSE 文件（另有 2 条
 *      GPL-3.0），当初是 owner 兜底收录；本次直接把敞口清零。
 *   2. 装了会伤产品——社区技能同样走"必须产出一条绑定真实数据模型字段
 *      的 aigc 能力"硬约束，而小红书卡片/学术论文写作/软著生成这类根本
 *      绑不上，装了要么闭环被结构门拦，要么模型硬编一个无意义能力卡。
 * 生成期的软参考通道（v5_skill_reference）保留代码不动——它设计上就是
 * 语料缺失即返回空、prompt 不加块，行为回到收录之前。
 */

import React from "react";
import {
  Button,
  Empty,
  Input,
  message,
  Tag,
  Tooltip,
} from "antd";
import {
  BookOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
} from "@ant-design/icons";
import featuredSkills from "@/data/featured-skills.json";
import {
  installKeyOf,
  installSkill,
  isInstalled,
  loadInstalledSkills,
  uninstallSkill,
  type InstalledSkill,
} from "./installed-skills";

interface FeaturedSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
}

const FEATURED = (featuredSkills as { items: FeaturedSkill[] }).items;
const FEATURED_CATEGORIES = ["全部", ...new Set(FEATURED.map(f => f.category))];

// 字母头像统一浅冷色（用户反馈：多彩色轮太刺眼，对齐效果图的柔和图标底）
function avatarToneOf(_name: string): string {
  return "bg-[#edf2f9] text-[#526176]";
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
      className="flex gap-3 rounded-lg border border-slate-200/80 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:border-slate-300/90 hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)]"
      data-testid={testid}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${avatarToneOf(name)}`}
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
              className="truncate text-sm font-semibold text-slate-900! hover:text-[#3b5bdb]!"
              title="打开原帖（技能获取以原帖为准）"
            >
              {name}
            </a>
          ) : (
            <span className="truncate text-sm font-semibold text-slate-900">
              {name}
            </span>
          )}
          {tags}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">
          {description || "（无摘要）"}
        </div>
        {/* 底行：作者/统计信息 + 右下角动作（用户反馈：按钮与信息同一行，右下角） */}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span>by {author}</span>
          {meta}
          <span className="ml-auto shrink-0">{action}</span>
        </div>
      </div>
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
  // 试跑区默认收起（TRAE Work 式紧凑卡片；点「试跑」展开输入/输出）
  const [open, setOpen] = React.useState(false);

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
      className="flex flex-col rounded-lg border border-slate-200/80 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
      data-testid={`installed-skill-${skill.repo}`}
    >
      <div className="flex gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold ${avatarToneOf(skill.name)}`}
        >
          {skill.name
            .replace(/[^\p{L}\p{N}]/gu, "")
            .slice(0, 1)
            .toUpperCase() || "S"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-[#14295E]">
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
                <Tag
                  color="default"
                  style={{ fontSize: 10, marginInlineEnd: 0 }}
                >
                  语义档案
                </Tag>
              </Tooltip>
            )}
            <Tag color="default" style={{ fontSize: 10, marginInlineEnd: 0 }}>
              {skill.license}
            </Tag>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-stone-500">
            {skill.description}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-stone-400">
            {skill.url ? (
              <a
                href={skill.url}
                target="_blank"
                rel="noreferrer"
                className="truncate font-mono hover:text-blue-600"
              >
                {skill.repo}
              </a>
            ) : (
              <span className="truncate font-mono">{skill.repo}</span>
            )}
            <span className="ml-auto flex shrink-0 items-center">
              <Button
                size="small"
                type="link"
                icon={<PlayCircleOutlined />}
                onClick={() => setOpen(v => !v)}
                data-testid="installed-skill-toggle"
              >
                试跑
              </Button>
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => onUninstall(installKeyOf(skill))}
                title="卸载（只移除本地安装，不影响原仓库）"
              />
            </span>
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-2.5 border-t border-stone-100 pt-2.5">
          {skill.ioHints.length > 0 && (
            <div className="mb-1.5 space-y-0.5">
              {skill.ioHints.slice(0, 3).map(h => (
                <div key={h} className="font-mono text-[10px] text-stone-400">
                  {h}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-start gap-2">
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
      )}
    </div>
  );
}

export function SkillsLibraryPage({
  initialTab = "featured",
}: {
  /** 初始 tab（测试用；产品默认精选层） */
  initialTab?: "featured" | "installed";
} = {}) {
  const [tab, setTab] = React.useState<"featured" | "installed">(
    initialTab
  );
  const [featuredCat, setFeaturedCat] = React.useState("全部");
  const [query, setQuery] = React.useState("");
  // kind/sort/page/pageSize 四个 state 与 /skill-packages 拉取都是社区层的
  // 筛选、分页与技能包元数据，随该层一并移除。
  const [installed, setInstalled] = React.useState<InstalledSkill[]>(() =>
    loadInstalledSkills()
  );

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

  // 「可执行 SKILL.md」统计卡随技能包语料一起下架：语料删干净后它恒为
  // "—"，副标题却写着"需 Python 服务在线"——服务在线也永远是 0，留着就是
  // 一句假话。
  const STATS = [
    {
      icon: <StarOutlined />,
      label: "精选技能",
      value: FEATURED.length,
      sub: "官方/大厂出品",
      tone: "bg-[#e8eeff] text-[#3b5bdb]",
    },
    {
      icon: <SafetyCertificateOutlined />,
      label: "已安装",
      value: installed.length,
      sub: "本地环境可用技能",
      tone: "bg-amber-50 text-amber-700",
    },
  ];

  const chipClass = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition ${
      active
        ? "bg-[#e8eeff] text-[#3b5bdb]"
        : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
    }`;

  return (
    <div
      // 壳：顶栏固定 + 列表单独滚动（彻底告别 sticky/padding 露缝）
      className="flex h-full flex-col overflow-hidden bg-[#eef2f7]"
      data-testid="skills-library"
    >
      <div className="shrink-0 space-y-3 px-6 pt-5 md:px-8">
        {/*
          顶栏扁平：标题 | 搜索 | 指南。
          DOM 顺序与视觉/焦点顺序一致（禁止 order-* 重排可聚焦控件）。
          「已安装」不展示搜索——该列表不参与 query 过滤，避免条件泄漏到其他 tab。
        */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5b6cff]">
              <BookOutlined className="text-[18px]" />
            </span>
            <h1 className="text-[18px] font-bold tracking-tight text-slate-900 md:text-[20px]">
              技能库
            </h1>
            <span className="rounded-md bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200/60">
              {FEATURED.length} 项
            </span>
          </div>

          {tab !== "installed" && (
            <div className="w-full min-w-[200px] flex-1 sm:mx-2 sm:max-w-md md:max-w-lg">
              <Input.Search
                allowClear
                placeholder="搜索技能名称 / 关键词 / 作者"
                onSearch={setQuery}
                onChange={e => {
                  if (!e.target.value) setQuery("");
                }}
                data-testid="skills-search"
                className="skills-library-search w-full"
              />
            </div>
          )}

        </div>

        {/* 统计条：轻量卡，真数据 */}
        <div className="flex flex-wrap gap-2.5">
          {STATS.map(s => (
            <div
              key={s.label}
              className="min-w-[140px] flex-1 rounded-lg border border-slate-200/70 bg-white/80 px-3.5 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              data-testid={`skills-stat-${s.label}`}
            >
              <div
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${s.tone}`}
              >
                {s.icon}
                {s.label}
              </div>
              <div className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                {s.value}
              </div>
              <div className="text-[10px] text-slate-400">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Tab + 筛选：固定在壳顶，不参与列表滚动 */}
        <div
          className="flex flex-col gap-2.5 border-b border-slate-200/80 pb-3"
          data-testid="skills-tab"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { key: "featured", label: "精选技能", count: FEATURED.length },
                { key: "installed", label: "已安装", count: installed.length },
              ] as const
            ).map(t => (
              <button
                key={t.key}
                type="button"
                data-testid={`skills-tab-${t.key}`}
                aria-pressed={tab === t.key}
                onClick={() => setTab(t.key)}
                className={chipClass(tab === t.key)}
              >
                {t.label}
                <span
                  data-testid={`skills-tab-count-${t.key}`}
                  className={`tabular-nums text-[11px] ${
                    tab === t.key ? "text-[#3b5bdb]/80" : "text-slate-400"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {tab !== "installed" && (
            <div className="flex flex-wrap items-center gap-1.5">
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
                        className={chipClass(featuredCat === cat)}
                      >
                        {cat}
                        <span
                          className={`tabular-nums text-[11px] ${
                            featuredCat === cat
                              ? "text-[#3b5bdb]/80"
                              : "text-slate-400"
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
            </div>
          )}
        </div>
      </div>

      {/* 仅列表区滚动 */}
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-6 pb-6 pt-3 md:px-8">
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
                      type="link"
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

      {/* 已安装层 */}
      {tab === "installed" && (
        <div className="space-y-2.5" data-testid="skills-installed">
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
              description="还没安装技能 — 到「精选技能」装一个，装完立即可试跑"
            />
          ) : (
            /* 来源分组。第二组只可能是社区层下架前装进 localStorage 的存量，
               不再有新增入口，所以如实标注来源已下架，而不是静默藏起来。 */
            [
              {
                label: "来自精选技能",
                list: installed.filter(s => s.repo.startsWith("trae-market/")),
              },
              {
                label: "早前安装（来源已下架）",
                list: installed.filter(s => !s.repo.startsWith("trae-market/")),
              },
            ]
              .filter(g => g.list.length > 0)
              .map(g => (
                <div key={g.label} className="space-y-2">
                  <div className="text-xs font-medium text-stone-500">
                    {g.label} · {g.list.length}
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
                    {g.list.map(s => (
                      <InstalledSkillCard
                        key={installKeyOf(s)}
                        skill={s}
                        onUninstall={key =>
                          setInstalled(prev => uninstallSkill(prev, key))
                        }
                      />
                    ))}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
      </div>
    </div>
  );
}

export default SkillsLibraryPage;
