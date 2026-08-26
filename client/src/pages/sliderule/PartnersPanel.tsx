/**
 * PartnersPanel — 「扩展中心」页里的伙伴层。
 *
 * 伙伴 = 一套预置好的能力组合 + 一句起手意图（见 partners.ts 头注：
 * 这里不做人设，人设是最容易造出一堆看着丰满、其实什么都不接的东西的地方）。
 *
 * ⚠ 每个伙伴的每一件依赖都**当场核对**：连接器在不在、技能装没装。
 *   缺什么就明说缺什么，按钮也不给按——一个看着能用、点了没反应的东西
 *   比没有这个东西更糟。
 *
 * ---
 *
 * 2026-08-26 按用户给的效果图重做版式，与技能/连接器两层拉齐：顶部标题 +
 * 搜索 + 「我的伙伴」，下面分类条，再下面一行四个的卡片墙，卡右侧一颗圆钮。
 *
 * ## 跟效果图**故意不一样**的三处
 *
 * 1. **只有 3 个，不是 40 个。** 效果图上是数据分析师、PPT 制作专家、
 *    UI 设计师…几十个职业名。我们只有 3 个真的能一键装配起来的组合，
 *    因为底下只有 2 个真连接器。摆 40 个点了没反应的，就是这条链路存在的
 *    理由要杀掉的东西（跟连接器页砍掉那 22 个假连接器同一条）。
 *
 * 2. **头像不画人。** 见 partner-art 的头注：头像由它装配的东西拼出来，
 *    换掉依赖头像跟着换，不会出现"图标说天气、实际接的是行情"。
 *
 * 3. **分类从依赖里汇出来，不是自己编一套。** 「出行生活」「金融」是连接器
 *    自己声明的 category（services/connectors.py），不是这一页硬写的词表。
 *    只有一种分类时不画这条——一个永远只能选它自己的筛选条，占着一行却
 *    什么也筛不动。
 *
 * ## 「我的伙伴」这次真的能攒了
 *
 * ⚠ 2026-08-26 发现的半截活：空态一直写着"在输入框里用 / 挂几个能力，再回
 *   这里存成小队"，而**存的入口根本不存在**——`partnerFromCurrent()` 早就
 *   写好也测过，就是没有任何地方调它。空态在教一条走不通的路，比空着更糟。
 *   这次把「存成伙伴」接上（顶栏那颗按钮），空态那句话才成立。
 */

import React from "react";
import { Button, Empty, Input, Modal, Tag, Tooltip, message } from "antd";
import { Check, Plus, Search, Trash2 } from "lucide-react";

import {
  BUILTIN_PARTNERS,
  partnerFromCurrent,
  partnerReadiness,
  type Partner,
  type PartnerNeed,
} from "./partners";
import { PartnerAvatar } from "./partner-art/partner-avatar";
import { TruncatedText } from "./TruncatedText";
import type { ConnectorSpec } from "./connectors-client";
import type { SlashItem } from "./composer-slash";

const ALL = "全部";

const needKey = (n: { kind: string; key: string }) => `${n.kind}:${n.key}`;

function PartnerCard({
  partner,
  icons,
  ready,
  missing,
  attached,
  onUse,
  onDelete,
}: {
  partner: Partner;
  icons: string[];
  ready: boolean;
  missing: PartnerNeed[];
  attached: boolean;
  onUse: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      data-testid="partner-card"
      data-partner={partner.id}
      data-ready={ready ? "1" : "0"}
      /* ⚠ 「已挂上」在 DOM 里是**一直存在**的一行小字（没挂时透明），
         所以判据不能钉那三个字——钉这个属性。 */
      data-attached={attached ? "1" : "0"}
      className="flex flex-col rounded-2xl border border-[#eef1f5] bg-white p-4 transition hover:border-[#dbe2ea] hover:shadow-[0_4px_14px_rgba(15,23,42,0.05)]"
    >
      <div className="flex items-center gap-3">
        {/* 头像由依赖拼出来，不画人 —— 见 partner-art 的头注 */}
        <PartnerAvatar icons={icons} className="h-11 w-11" />
        <TruncatedText
          text={partner.name}
          data-testid="partner-name"
          className="min-w-0 flex-1 text-[14.5px] font-semibold text-stone-800"
        />
        {/* ⚠ 圆钮就是「用这个伙伴」本身（挂能力 + 填起手意图 + 跳回推演），
            依赖没齐时按不动。效果图上那颗 + 是"加到我的"，我们这颗是"照这个
            开一局"——所以底下留一行小字说清它会做什么，别让人猜。 */}
        <Tooltip
          title={
            ready
              ? "挂上它要的能力，把起手意图填进输入框，跳回推演"
              : `依赖还没齐：还缺 ${missing.map(m => m.name).join("、")}`
          }
        >
          <span className="shrink-0">
            <button
              type="button"
              data-testid="partner-use"
              disabled={!ready}
              onClick={onUse}
              className="flex flex-col items-center gap-1 pt-1 disabled:cursor-not-allowed"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                  !ready
                    ? "border-[#eef0f3] text-stone-300"
                    : attached
                      ? "border-[#bfe6cd] bg-[#eef9f2] text-[#0a8f52]"
                      : "border-[#e5e7eb] text-stone-400 hover:border-[#b9c6d6] hover:bg-[#f7f9fc] hover:text-stone-700"
                }`}
              >
                {attached ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </span>
              <span
                className={`text-[11px] leading-4 ${attached && ready ? "text-stone-400" : "text-transparent"}`}
              >
                已挂上
              </span>
            </button>
          </span>
        </Tooltip>
      </div>

      <TruncatedText
        as="div"
        lines={2}
        text={partner.description || "（没有说明）"}
        data-testid="partner-desc"
        className="mt-2.5 text-[12.5px] leading-[20px] text-stone-500"
      />

      {/* 它装配了什么：连接器绿、技能蓝，跟 `/` 面板同一套配色 */}
      <div className="mt-2 flex flex-wrap gap-1">
        {partner.needs.map(n => (
          <Tag
            key={needKey(n)}
            color={n.kind === "connector" ? "green" : "blue"}
            style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "18px" }}
          >
            {n.name}
          </Tag>
        ))}
      </div>

      {/*
        起手意图：点下去输入框里会出现的正是这段，先给人看见。

        ⚠ **内边距和夹断必须分两层。** 2026-08-26 真机截图逮到的：把
          `px-2.5 py-1.5` 和 `-webkit-line-clamp:2` 放同一个元素上，夹断算的是
          两行的**内容高度**，而 padding 又给了它额外空间——第三行会从底部
          padding 里露出小半截（截图上是"使，和气 天的路水概率"这种半截字）。
          没有报错、没有告警，只是看着像渲染坏了。外层管留白、内层管夹断。
      */}
      <div className="mt-2.5 rounded-lg bg-[#f7f8fa] px-2.5 py-1.5" data-testid="partner-opener-box">
        <TruncatedText
          as="div"
          lines={2}
          text={partner.opener || "（没有起手意图）"}
          data-testid="partner-opener"
          className="text-[11.5px] leading-[18px] text-stone-500"
        />
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-stone-400">
        {/* ⚠ 缺什么就明说缺什么，别只给一个灰按钮 */}
        {ready ? (
          <span className="min-w-0 flex-1">
            {partner.builtin ? "内置" : "我攒的"}
          </span>
        ) : (
          <TruncatedText
            data-testid="partner-missing"
            text={`还缺：${missing.map(m => m.name).join("、")}`}
            className="min-w-0 flex-1 text-[#d46b08]"
          />
        )}
        {onDelete ? (
          <button
            type="button"
            data-testid="partner-delete"
            onClick={onDelete}
            title="删掉这个伙伴（只删本地存档）"
            className="shrink-0 rounded p-1 text-stone-400 transition hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 「存成伙伴」：把这一轮挂着的能力 + 一句起手意图存成自己的伙伴。 */
function SaveDialog({
  open,
  turnCaps,
  onClose,
  onSave,
}: {
  open: boolean;
  turnCaps: readonly SlashItem[];
  onClose: () => void;
  onSave: (p: Partner) => void;
}) {
  const [name, setName] = React.useState("");
  const [opener, setOpener] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setName("");
      setOpener("");
    }
  }, [open]);

  const submit = () => {
    const p = partnerFromCurrent(name, turnCaps, opener);
    /* ⚠ partnerFromCurrent 一个能力都没挂就返回 null（存出来是个空壳）。
       这里按它的判断走，不自己再写一遍规则——两处规则迟早分叉。 */
    if (!p) {
      message.warning("给它起个名字，并且这一轮至少挂着一个连接器或技能");
      return;
    }
    onSave(p);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="存成我的伙伴"
      okText="存下来"
      cancelText="取消"
      onOk={submit}
      onCancel={onClose}
      destroyOnHidden
    >
      <p className="mb-3 text-[12.5px] text-stone-500">
        存的是<b>这一轮挂着的能力</b>加你写的这句起手意图。下次点它，这套东西
        原样回来。
      </p>
      <div className="mb-3 flex flex-wrap gap-1">
        {turnCaps.length === 0 ? (
          <span className="text-[12px] text-[#d46b08]">
            这一轮一个能力都没挂——先在输入框里用 / 挂上连接器或技能
          </span>
        ) : (
          turnCaps.map(c => (
            <Tag
              key={needKey(c)}
              color={c.kind === "connector" ? "green" : "blue"}
              style={{ marginInlineEnd: 0 }}
            >
              {c.name}
            </Tag>
          ))
        )}
      </div>
      <Input
        autoFocus
        value={name}
        maxLength={24}
        onChange={e => setName(e.target.value)}
        placeholder="给它起个名字，比如「晨会看板」"
        data-testid="partner-save-name"
      />
      <Input.TextArea
        className="mt-2"
        value={opener}
        onChange={e => setOpener(e.target.value)}
        autoSize={{ minRows: 3, maxRows: 6 }}
        placeholder="起手意图：下次点它，这段话会填进输入框（可以留空）"
        data-testid="partner-save-opener"
      />
    </Modal>
  );
}

export function PartnersPanel({
  custom,
  connectors,
  skillKeys,
  attachedKeys,
  turnCaps,
  onUse,
  onSave,
  onDelete,
}: {
  custom: Partner[];
  /** 后端报上来的连接器清单（要它的 category 和 icon，不只是 id） */
  connectors: ConnectorSpec[];
  skillKeys: string[];
  /** 这一轮已经挂着的能力，形如 `connector:weather` */
  attachedKeys: string[];
  turnCaps: SlashItem[];
  onUse: (p: Partner) => void;
  onSave: (p: Partner) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(ALL);
  const [mineOnly, setMineOnly] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const specById = React.useMemo(
    () => new Map(connectors.map(c => [c.id, c])),
    [connectors]
  );
  const connectorIds = React.useMemo(
    () => connectors.filter(c => c.available).map(c => c.id),
    [connectors]
  );

  /** 这个伙伴归哪些分类：从它接的连接器自己声明的 category 汇出来。 */
  const catsOf = React.useCallback(
    (p: Partner) => {
      const out: string[] = [];
      for (const n of p.needs) {
        if (n.kind !== "connector") continue;
        const c = specById.get(n.key)?.category;
        if (c && !out.includes(c)) out.push(c);
      }
      return out;
    },
    [specById]
  );

  /** 头像用的图稿名，顺序跟 needs 一致（拿不到 spec 的跳过，不占位）。 */
  const iconsOf = React.useCallback(
    (p: Partner) =>
      p.needs
        .map(n => (n.kind === "connector" ? specById.get(n.key)?.icon : undefined))
        .filter((x): x is string => !!x),
    [specById]
  );

  const all = React.useMemo(
    () => [...custom, ...BUILTIN_PARTNERS],
    [custom]
  );

  const categories = React.useMemo(() => {
    const seen: string[] = [];
    for (const p of all) {
      for (const c of catsOf(p)) if (!seen.includes(c)) seen.push(c);
    }
    /* ⚠ 只有一种分类时不画这条筛选条（跟连接器层同一条判断）。 */
    return seen.length > 1 ? [ALL, ...seen] : [];
  }, [all, catsOf]);

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(p => {
      if (mineOnly && p.builtin) return false;
      if (category !== ALL && !catsOf(p).includes(category)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.opener.toLowerCase().includes(q) ||
        p.needs.some(n => n.name.toLowerCase().includes(q))
      );
    });
  }, [all, mineOnly, category, query, catsOf]);

  const mine = shown.filter(p => !p.builtin);
  const builtin = shown.filter(p => p.builtin);

  const card = (p: Partner) => {
    const { ready, missing } = partnerReadiness(p, { connectorIds, skillKeys });
    return (
      <PartnerCard
        key={p.id}
        partner={p}
        icons={iconsOf(p)}
        ready={ready}
        missing={missing}
        attached={
          p.needs.length > 0 &&
          p.needs.every(n => attachedKeys.includes(needKey(n)))
        }
        onUse={() => onUse(p)}
        {...(p.builtin ? {} : { onDelete: () => onDelete(p.id) })}
      />
    );
  };

  const GRID =
    "grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div data-testid="partners-list">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="m-0 text-[20px] font-semibold text-stone-800">
              伙伴
            </h2>
            {/* ⚠ 照实数。效果图上那几十个我们没有。 */}
            <span className="text-[13px] text-stone-400" data-testid="partner-count">
              {all.length} 个
            </span>
          </div>
          <p className="mb-0 mt-1 text-[12.5px] text-stone-500">
            伙伴是<b>一套装配好的能力 + 一句起手意图</b>
            ；点一下就把它要的连接器/技能挂到这一轮，并把起手意图填进输入框——
            你可以再改再发
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            allowClear
            size="middle"
            style={{ width: 200 }}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索伙伴"
            data-testid="partner-search"
            prefix={<Search className="h-3.5 w-3.5 text-stone-400" />}
          />
          <Button
            type={mineOnly ? "primary" : "default"}
            ghost={mineOnly}
            data-testid="partner-mine"
            onClick={() => setMineOnly(v => !v)}
          >
            我的伙伴{custom.length > 0 ? ` ${custom.length}` : ""}
          </Button>
          {/* ⚠ 这颗按钮是这次补上的半截活（见文件头注）。挂了能力才存得出
              东西，所以没挂时按不动，并且**说清**先去干什么——不是灰着不说话。 */}
          <Tooltip
            title={
              turnCaps.length > 0
                ? "把这一轮挂着的能力存成你自己的伙伴"
                : "这一轮还没挂能力：先在输入框里用 / 挂上连接器或技能，再回来存"
            }
          >
            <span>
              <Button
                type="primary"
                disabled={turnCaps.length === 0}
                data-testid="partner-save-open"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setSaving(true)}
              >
                存成伙伴
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>

      {categories.length > 0 ? (
        <div className="mt-3.5 flex flex-wrap gap-2" data-testid="partner-cats">
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              data-testid="partner-cat"
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
                {cat === ALL
                  ? all.length
                  : all.filter(p => catsOf(p).includes(cat)).length}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-5 space-y-6">
        {mine.length > 0 ? (
          <section data-testid="partners-mine">
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="m-0 text-[15px] font-semibold text-stone-800">
                我攒的
              </h3>
              <span className="text-[12.5px] text-stone-400">{mine.length}</span>
            </div>
            <div className={GRID}>{mine.map(card)}</div>
          </section>
        ) : null}

        {mineOnly && mine.length === 0 ? (
          <Empty
            className="mt-10"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              custom.length === 0
                ? "还没攒过伙伴——在输入框里用 / 挂几个能力，再回这里点「存成伙伴」"
                : `我攒的伙伴里没有匹配「${query || category}」的`
            }
          />
        ) : null}

        {!mineOnly ? (
          <section data-testid="partners-builtin">
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="m-0 text-[15px] font-semibold text-stone-800">
                内置伙伴
              </h3>
              <span className="text-[12.5px] text-stone-400">
                {builtin.length}
              </span>
            </div>
            {builtin.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`没有匹配「${query || category}」的伙伴`}
              />
            ) : (
              /* 一行四个，跟技能/连接器那两面墙一致 */
              <div className={GRID}>{builtin.map(card)}</div>
            )}
          </section>
        ) : null}
      </div>

      <SaveDialog
        open={saving}
        turnCaps={turnCaps}
        onClose={() => setSaving(false)}
        onSave={onSave}
      />
    </div>
  );
}
