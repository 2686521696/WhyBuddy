/**
 * SkillsLibraryPage — 技能库（「扩展中心」的技能层）。
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
 *
 * ---
 *
 * 2026-08-26 按用户给的效果图重做版式，与连接器层拉齐：顶部标题 + 搜索 +
 * 「我的技能」，下面分类条，再下面**一行四个**的卡片墙，卡上一颗圆钮装/卸。
 *
 * ## 跟效果图**故意不一样**的三处
 *
 * 1. **没有「+ 新建技能」。** 自建技能这条链路没有——技能目录是仓里那份
 *    featured-skills.json，没有创建入口、没有存储、没有审校。放一颗打不开
 *    任何东西的按钮，跟连接器层砍掉的那颗是同一个毛病（见 ConnectorsPanel
 *    头注第 2 条）。做出来那天再加。
 *
 * 2. **分类照数据里的来，不照效果图。** 效果图上是「金融/法律/办公协作/
 *    设计开发」，我们数据里的 10 个分类是界面设计/内容创作/交互体验…
 *    摆一个点进去永远是空的分类，跟摆一个连不上的连接器一样。
 *
 * 3. **两段是「已安装」+「全部技能」，不是「精选」+「全部」。** 79 条里
 *    分不出哪些更"精选"——真要分只能瞎标一批。而"装没装"是真的、是用户
 *    自己造成的、也正是他回到这一页最想先看到的。
 *
 * ## 装/卸那颗圆钮是什么
 *
 * 「安装」= 把技能语义档案落进本地已安装列表（localStorage），下次推演会
 * 注入（最多前 6 个）。跟连接器那颗「+」**不是**一回事：连接器挂的是"这一轮"，
 * 技能装的是"以后每一轮"。所以文案一个叫「已添加」、一个叫「已安装」，
 * 别对齐成同一个词。
 */

import React from "react";
import { Button, Empty, Input, message, Tag, Tooltip } from "antd";
import { Check, Play, Plus, Search, Trash2 } from "lucide-react";
import featuredSkills from "@/data/featured-skills.json";

import { SkillIcon } from "./skill-art/skill-icons";
import { TruncatedText } from "./TruncatedText";
import {
  channelOf,
  installKeyOf,
  installSkill,
  isInstalled,
  loadInstalledSkills,
  uninstallSkill,
  type InstalledSkill,
  type SkillChannel,
} from "./installed-skills";

interface FeaturedSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  /** 消费通道（见 installed-skills.ts）：决定装进推演后走哪条 prompt 路径 */
  channel?: SkillChannel;
  /** 绑定形状（仅 aigc 通道）：读写字段的类型，不是字段名 */
  binding?: { inputTypes: string[]; outputType: string };
}

const FEATURED = (featuredSkills as { items: FeaturedSkill[] }).items;

/** 安装键 ← → 目录项。已安装记录里没存分类，图稿要靠它反查。 */
const REPO_OF = (id: string) => `trae-market/${id}`;
const BY_REPO = new Map(FEATURED.map(f => [REPO_OF(f.id), f]));

/**
 * 通道标（2026-07-27）：装之前就说清这条技能装了会发生什么，别让用户装完
 * 才发现它绑不上任何字段。「精选」那个金标只说明来源，不说明用途，替掉。
 */
const CHANNEL_META: Record<
  SkillChannel,
  { label: string; color: string; title: string }
> = {
  aigc: {
    label: "可绑字段",
    color: "green",
    title: "装进推演后会落成一条 AIGC 能力，读写你这个应用里真实的实体字段",
  },
  experience: {
    label: "设计指导",
    color: "blue",
    title: "装进推演后影响生成的视觉与版式（配色/布局），不产出业务能力",
  },
  unbound: {
    label: "仅作参考",
    color: "default",
    title: "没验证出它能绑到哪个实体字段，只作为生成时的软参考，不发硬要求",
  },
};

function ChannelTag({ skill }: { skill: { channel?: SkillChannel } }) {
  const meta = CHANNEL_META[channelOf(skill)];
  return (
    <Tooltip title={meta.title}>
      <Tag
        color={meta.color}
        style={{ fontSize: 10, marginInlineEnd: 0, lineHeight: "16px" }}
        data-testid={`skill-channel-${channelOf(skill)}`}
      >
        {meta.label}
      </Tag>
    </Tooltip>
  );
}

const ALL = "全部";

/**
 * 卡片外壳：图稿 + 名字 + 圆钮一行，描述与底行**通栏**。
 *
 * ⚠ 2026-08-26 真机量出来的：一行四个之后每张卡 ~270px，去掉内边距只剩
 *   248px；再让描述和底行跟图稿、圆钮挤同一列，可用宽度只有 ~144px——
 *   底行 79 张卡**全部**出省略号（"界面设计 · by A…"），等于每张卡都在
 *   藏作者。描述和底行挪到图稿下方通栏之后，同一批文案一条都不截断。
 *   名字那行没得选（必须跟圆钮同排），所以它保留省略号 + 悬浮看全文。
 */
function CardShell({
  category,
  name,
  description,
  footer,
  action,
  testid,
  attr,
  open,
  children,
}: {
  category?: string;
  name: string;
  description: string;
  footer: React.ReactNode;
  action: React.ReactNode;
  testid?: string;
  attr?: Record<string, string>;
  open?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white transition ${
        open
          ? "border-[#d6e4ff] shadow-[0_8px_24px_rgba(15,23,42,0.07)]"
          : "border-[#eef1f5] hover:border-[#dbe2ea] hover:shadow-[0_4px_14px_rgba(15,23,42,0.05)]"
      }`}
      data-testid={testid}
      {...attr}
    >
      <div className="p-4">
        <div className="flex items-center gap-3">
          {/* 真图稿（多色 SVG），不是字母头像 —— 见 skill-art 的头注 */}
          <SkillIcon category={category} className="h-10 w-10" />
          <TruncatedText
            text={name}
            data-testid="skill-name"
            className="min-w-0 flex-1 text-[14.5px] font-semibold text-stone-800"
          />
          {action}
        </div>
        <TruncatedText
          as="div"
          lines={2}
          text={description || "（无摘要）"}
          data-testid="skill-desc"
          className="mt-2.5 text-[12.5px] leading-[20px] text-stone-500"
        />
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-400">
          {footer}
        </div>
      </div>
      {children}
    </div>
  );
}

/** 圆钮：装 / 已装（照效果图做成圆钮 + 底下一行小字）。 */
function RoundToggle({
  on,
  onLabel,
  title,
  onClick,
  testid,
}: {
  on: boolean;
  onLabel: string;
  title: string;
  onClick: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className="flex shrink-0 flex-col items-center gap-1 pt-1"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
          on
            ? "border-[#bfe6cd] bg-[#eef9f2] text-[#0a8f52]"
            : "border-[#e5e7eb] text-stone-400 hover:border-[#b9c6d6] hover:bg-[#f7f9fc] hover:text-stone-700"
        }`}
      >
        {on ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </span>
      <span
        className={`text-[11px] leading-4 ${on ? "text-stone-400" : "text-transparent"}`}
      >
        {onLabel}
      </span>
    </button>
  );
}

/** 目录卡（未装/已装同一张，右侧圆钮切换）。 */
function FeaturedCard({
  skill,
  installed,
  onToggle,
}: {
  skill: FeaturedSkill;
  installed: boolean;
  onToggle: () => void;
}) {
  return (
    <CardShell
      testid={`featured-skill-${skill.id}`}
      attr={{ "data-installed": installed ? "1" : "0" }}
      category={skill.category}
      name={skill.name}
      description={skill.description}
      /* ⚠ 分类**不摆在名字那一行**（效果图上是摆的）：名字那行要跟圆钮挤，
         只剩 ~150px，再塞一枚分类标就轮到名字全员省略号。效果图上的名字是
         四个汉字，我们这批是最长 29 个字符的英文 id。分类挪到通栏底行。 */
      footer={
        <>
          <ChannelTag skill={skill} />
          <TruncatedText
            text={`${skill.category} · by ${skill.author}`}
            data-testid="skill-meta"
            className="min-w-0 flex-1"
          />
        </>
      }
      action={
        <RoundToggle
          testid="skill-install"
          on={installed}
          onLabel="已安装"
          title={installed ? "已安装，点一下卸载" : "安装（以后每轮推演都注入）"}
          onClick={onToggle}
        />
      }
    />
  );
}

/** 已安装卡：输入 → 试跑（原版 SKILL.md 走 /skill-package-tryrun，语义档案走 /aigc-tryrun） */
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
  // 试跑区默认收起（紧凑卡片；点「试跑」展开输入/输出）
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
    <CardShell
      testid={`installed-skill-${skill.repo}`}
      open={open}
      category={BY_REPO.get(skill.repo)?.category}
      name={skill.name}
      description={skill.description}
      footer={
        <>
          <ChannelTag skill={skill} />
          <Tooltip
            title={
              skill.kind === "package"
                ? "试跑时原作者的完整 SKILL.md 指令作为 system prompt 执行"
                : "按语义档案（名称/描述）驱动执行"
            }
          >
            <Tag
              color={skill.kind === "package" ? "green" : "default"}
              style={{
                marginInlineEnd: 0,
                fontSize: 11,
                lineHeight: "16px",
                flexShrink: 0,
              }}
            >
              {skill.kind === "package" ? "原版 SKILL.md" : "语义档案"}
            </Tag>
          </Tooltip>
          {skill.url ? (
            <a
              href={skill.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate font-mono hover:text-blue-600"
            >
              {skill.repo}
            </a>
          ) : (
            <TruncatedText
              text={skill.license}
              className="min-w-0 flex-1 font-mono"
            />
          )}
          <button
            type="button"
            data-testid="installed-skill-toggle"
            onClick={() => setOpen(v => !v)}
            title="试跑：真 LLM，走服务端通道"
            className="shrink-0 rounded p-1 text-stone-400 transition hover:bg-[#f1f5fb] hover:text-[#1677ff]"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        </>
      }
      action={
        <RoundToggle
          testid="skill-uninstall"
          on
          onLabel="卸载"
          title="卸载（只移除本地安装，不影响原仓库）"
          onClick={() => onUninstall(installKeyOf(skill))}
        />
      }
    >
      {open ? (
        <div className="border-t border-[#f1f3f6] px-4 py-3">
          {skill.ioHints.length > 0 && (
            <div className="mb-1.5 space-y-0.5">
              {skill.ioHints.slice(0, 3).map(h => (
                <div key={h} className="font-mono text-[10px] text-stone-400">
                  {h}
                </div>
              ))}
            </div>
          )}
          {/* ⚠ 一行四个之后卡只有 ~280px，输入框和按钮**竖着**排。
              横排的话按钮会被挤成两个字宽，或者把输入框压到放不下一个词。 */}
          <Input.TextArea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="给这个技能输入内容，立即试跑（真 LLM，走服务端通道）"
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
          <Button
            className="mt-2 w-full"
            size="small"
            type="primary"
            icon={<Play className="h-3 w-3" />}
            loading={running}
            disabled={!input.trim()}
            onClick={run}
            data-testid="installed-skill-run"
          >
            试跑
          </Button>
          {output !== null && (
            <div className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-stone-50 p-2.5 text-xs leading-5 text-stone-700 ring-1 ring-stone-200">
              {output}
            </div>
          )}
          {error !== null && (
            <div className="mt-2 rounded bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600 ring-1 ring-red-200">
              试跑失败：{error}
            </div>
          )}
        </div>
      ) : null}
    </CardShell>
  );
}

/** 段标题：「已安装 · 3」这种。 */
function SectionTitle({
  title,
  count,
  hint,
  testid,
}: {
  title: string;
  count: number;
  hint?: string;
  testid: string;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2" data-testid={testid}>
      <h3 className="m-0 text-[15px] font-semibold text-stone-800">{title}</h3>
      <span className="text-[12.5px] text-stone-400">{count}</span>
      {hint ? <span className="text-[11.5px] text-stone-400">{hint}</span> : null}
    </div>
  );
}

const GRID =
  "grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

export function SkillsLibraryPage({
  /** 初始是否只看「我的技能」（测试用；产品默认看全部） */
  initialMine = false,
}: {
  initialMine?: boolean;
} = {}) {
  const [category, setCategory] = React.useState(ALL);
  const [query, setQuery] = React.useState("");
  const [mineOnly, setMineOnly] = React.useState(initialMine);
  const [installed, setInstalled] = React.useState<InstalledSkill[]>(() =>
    loadInstalledSkills()
  );

  const toggleInstall = (f: FeaturedSkill) => {
    setInstalled(prev => {
      if (isInstalled(prev, REPO_OF(f.id))) {
        message.success(`已卸载「${f.name}」`);
        return uninstallSkill(prev, REPO_OF(f.id));
      }
      const next = installSkill(prev, {
        repo: REPO_OF(f.id),
        url: "",
        license: "官方市场",
        name: f.name,
        description: f.description,
        ioHints: [],
        kind: "semantic",
        channel: channelOf(f),
        ...(f.binding ? { binding: f.binding } : {}),
      });
      if (next !== prev)
        message.success(`已安装「${f.name}」，下次推演会注入，也可以直接试跑`);
      return next;
    });
  };

  const matches = React.useCallback(
    (name: string, description: string, author: string, cat?: string) => {
      if (category !== ALL && cat !== category) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        name.toLowerCase().includes(q) ||
        description.toLowerCase().includes(q) ||
        author.toLowerCase().includes(q)
      );
    },
    [category, query]
  );

  const featuredItems = React.useMemo(
    () => FEATURED.filter(f => matches(f.name, f.description, f.author, f.category)),
    [matches]
  );

  /* 已安装那一段吃同一套筛选条件——只筛一半的话，搜「配色」时上面一段
     筛过了、下面一段还是全量，看着像搜索没生效。分类靠 repo 反查目录项
     （已安装记录里不存分类）。 */
  const installedItems = React.useMemo(
    () =>
      installed.filter(s =>
        matches(s.name, s.description, s.repo, BY_REPO.get(s.repo)?.category)
      ),
    [installed, matches]
  );

  const categories = React.useMemo(() => {
    const seen: string[] = [];
    for (const f of FEATURED) if (!seen.includes(f.category)) seen.push(f.category);
    return [ALL, ...seen];
  }, []);

  const countOf = (cat: string) =>
    cat === ALL ? FEATURED.length : FEATURED.filter(f => f.category === cat).length;

  return (
    <div
      // 壳：顶栏固定 + 列表单独滚动（彻底告别 sticky/padding 露缝）
      className="flex h-full flex-col overflow-hidden bg-white"
      data-testid="skills-library"
    >
      <div className="shrink-0 px-5 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="m-0 text-[20px] font-semibold text-stone-800">
                技能库
              </h2>
              <span
                className="text-[13px] text-stone-400"
                data-testid="skills-count"
              >
                {FEATURED.length} 项
              </span>
            </div>
            <p className="mb-0 mt-1 text-[12.5px] text-stone-500">
              技能是一段做事的方法，装上之后会注入到<b>之后每一轮</b>推演里
              （最多前 6 个）——影响生成的应用怎么设计、怎么写
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              allowClear
              size="middle"
              style={{ width: 220 }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索技能 / 作者"
              data-testid="skills-search"
              prefix={<Search className="h-3.5 w-3.5 text-stone-400" />}
            />
            <Button
              type={mineOnly ? "primary" : "default"}
              ghost={mineOnly}
              data-testid="skills-mine"
              onClick={() => setMineOnly(v => !v)}
            >
              我的技能
              {installed.length > 0 ? ` ${installed.length}` : ""}
            </Button>
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap gap-2" data-testid="skills-cats">
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              data-testid="skills-cat"
              data-cat={cat}
              data-active={category === cat ? "1" : "0"}
              onClick={() => setCategory(cat)}
              className={`rounded-lg px-3 py-1.5 text-[13px] transition ${
                category === cat
                  ? "bg-[#eef4ff] font-medium text-[#1677ff]"
                  : "bg-[#f5f6f8] text-stone-600 hover:bg-[#eceff3]"
              }`}
            >
              {cat}
              <span
                className={`ml-1 tabular-nums text-[11px] ${
                  category === cat ? "text-[#1677ff]/70" : "text-stone-400"
                }`}
              >
                {countOf(cat)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 仅列表区滚动 */}
      <div className="min-h-0 flex-1 space-y-6 overflow-auto px-5 pb-6 pt-4">
        {installedItems.length > 0 ? (
          <section data-testid="skills-installed">
            <SectionTitle
              testid="skills-section-installed"
              title="已安装"
              count={installedItems.length}
              hint="会注入之后每一轮推演（最多前 6 个）；字段绑定仍过门禁硬校验"
            />
            <div className={GRID}>
              {installedItems.map(s => (
                <InstalledSkillCard
                  key={installKeyOf(s)}
                  skill={s}
                  onUninstall={key =>
                    setInstalled(prev => uninstallSkill(prev, key))
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        {mineOnly ? (
          installedItems.length === 0 ? (
            <Empty
              className="mt-10"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                installed.length === 0
                  ? "还没安装技能 — 关掉「我的技能」挑一个，装完立即可试跑"
                  : `已安装的技能里没有匹配「${query || category}」的`
              }
            />
          ) : null
        ) : (
          <section data-testid="skills-featured">
            <SectionTitle
              testid="skills-section-featured"
              title="全部技能"
              count={featuredItems.length}
            />
            {featuredItems.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`没有匹配「${query || category}」的技能`}
              />
            ) : (
              /* 一行四个（用户 2026-08-26 指定）。窄屏逐级降到 3 / 2 / 1——
                 1200px 以下硬塞四个的话每张只有 200 出头，标题都放不下一行。 */
              <div className={GRID} data-testid="skills-featured-grid">
                {featuredItems.map(f => (
                  <FeaturedCard
                    key={f.id}
                    skill={f}
                    installed={isInstalled(installed, REPO_OF(f.id))}
                    onToggle={() => toggleInstall(f)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default SkillsLibraryPage;
