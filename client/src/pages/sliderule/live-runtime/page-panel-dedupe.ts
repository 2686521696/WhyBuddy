/**
 * page-panel-dedupe — 同一份数据只画一次。
 *
 * 起因是真跑逮到的：健身房应用首页把「近期出勤动态」声明了两遍——
 *
 *   page.blocks[2]  ActivityFeed  entityRef=attendance_record
 *                                 timeFieldRef=check_in_time
 *                                 levelFieldRef=status
 *   page.feeds[0]   近期出勤动态   entity=attendance_record
 *                                 timeField=…check_in_time
 *                                 levelField=…status
 *
 * 绑定逐字段相同，只有名字不同，于是两条渲染路径（体验区块脚手架 /
 * monitorDynamicLists）各画一张卡，首页出现两个一模一样的动态流。
 *
 * 根因是**结构性**的：我们的页面 schema 有五条并行声明通道
 * （stats / charts / rankings / feeds / blocks），同一个东西在哪条通道里
 * 声明都合法，没有任何一层保证它只出现一次。
 *
 * 对照 Grafana 的仪表盘 JSON 模型（官方文档 view-dashboard-json-model）：
 * 那边**只有一个扁平的 `panels` 数组**是面板的唯一来源，所有类型（stat /
 * timeseries / table…）都是这个数组里的对象，靠 `id` 保唯一——不存在"同一块
 * 内容可以从两个地方声明出来"这回事。我们短期改不动 schema（那是另一档的
 * 工程量），但可以在渲染层把那条约束补上：**先把多通道声明归一成一份带
 * 唯一键的面板清单，同键只留一个**。
 *
 * 判定用「内容指纹」而不是 id：模型给两处起了不同的 id 和名字，靠 id 永远
 * 判不出重复；真正决定"画出来是不是同一个东西"的是类型 + 绑定的实体 + 绑定
 * 的关键字段。
 *
 * 谁赢：**保留积木（block）那一份**。它带槽位摆放信息（layout.summary/
 * secondary/activity），渲染器也是新的那套（antd Card + 主题 token）；
 * legacy 的 rankings/feeds 声明只能落到固定骨架的位置上。
 */

import type {
  AppPageFeedSchema,
  AppPageRankingSchema,
} from "./app-runtime-schema";
import type { ExperienceBlockInstance } from "./block-registry";

/** 字段引用可能带实体前缀（"attendance_record.status"），比对前统一剥掉。 */
function bareField(ref: unknown): string {
  const s = String(ref ?? "").trim();
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot + 1) : s;
}

/**
 * 面板的内容指纹：决定"画出来是不是同一个东西"的那几维。
 *
 * 故意**不含** id / 名字 / 排序方向 / 条数上限——同一份数据取前 5 名还是
 * 前 10 名、叫「即将到期会员」还是「续费提醒」，画出来仍是同一张榜，
 * 摆两张就是重复。
 */
function rankingKey(entityId: string, sortFieldId: string): string {
  return `RankedList|${entityId}|${bareField(sortFieldId)}`;
}

function feedKey(entityId: string, timeFieldId: string, levelFieldId?: string): string {
  return `ActivityFeed|${entityId}|${bareField(timeFieldId)}|${bareField(levelFieldId ?? "")}`;
}

/** 积木实例/blockRef → 指纹（不是排行/动态流类型，或绑定不全的，返回 null）。 */
export function blockPanelKey(
  block: Pick<ExperienceBlockInstance, "type" | "binding">
): string | null {
  const binding = (block.binding ?? {}) as {
    entityRef?: string;
    sortByRef?: string;
    timeFieldRef?: string;
    levelFieldRef?: string;
  };
  const entity = String(binding.entityRef ?? "").trim();
  if (!entity) return null;
  if (block.type === "RankedList") {
    const sortBy = String(binding.sortByRef ?? "").trim();
    return sortBy ? rankingKey(entity, sortBy) : null;
  }
  if (block.type === "ActivityFeed") {
    const timeField = String(binding.timeFieldRef ?? "").trim();
    return timeField ? feedKey(entity, timeField, binding.levelFieldRef) : null;
  }
  return null;
}

export interface LegacyPanelLists {
  rankings: AppPageRankingSchema[];
  feeds: AppPageFeedSchema[];
}

/**
 * 把 legacy 的 rankings/feeds 里跟积木撞车的那些摘掉。
 *
 * 返回新数组；没有撞车时返回**原数组引用**，调用方可以据此跳过重渲染。
 */
export function dropLegacyPanelsCoveredByBlocks(
  lists: LegacyPanelLists,
  blocks: readonly ExperienceBlockInstance[],
  /** freeform 设计树里 blockRef 摆过的指纹（嵌了就外面不画） */
  alreadyPlaced?: ReadonlySet<string>
): LegacyPanelLists {
  const taken = new Set<string>(alreadyPlaced ?? []);
  for (const b of blocks) {
    const key = blockPanelKey(b);
    if (key) taken.add(key);
  }
  if (taken.size === 0) return lists;

  const rankings = lists.rankings.filter(
    r => !taken.has(rankingKey(r.entityId, r.sortFieldId))
  );
  const feeds = lists.feeds.filter(
    f => !taken.has(feedKey(f.entityId, f.timeFieldId, f.levelFieldId))
  );
  const changed =
    rankings.length !== lists.rankings.length || feeds.length !== lists.feeds.length;
  return changed ? { rankings, feeds } : lists;
}

/**
 * 走一遍 freeformOverview 的设计树，把里面 blockRef 摆的积木指纹收出来。
 *
 * 2026-07-29：有了 blockRef 之后，同一份榜/流可能出现在**三个**位置——
 * freeform 设计树里、page.blocks 里、page.rankings/feeds 里。语义是
 * **「嵌了就外面不画」**：设计者已经把它摆进版式了，外面再来一张就是重复，
 * 而且破坏它设计的留白节奏。
 *
 * 深度上限跟渲染层同值（FREEFORM_MAX_DEPTH=6 那套的保守值），坏数据不至于
 * 把这里转晕；不认识的形状一律跳过，不抛。
 */
export function collectFreeformBlockRefKeys(
  freeformContent: { root?: unknown } | null | undefined
): Set<string> {
  const keys = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 8 || !node || typeof node !== "object") return;
    const n = node as {
      blockRef?: { type?: string; binding?: Record<string, unknown> };
      children?: unknown;
    };
    if (n.blockRef?.type) {
      const key = blockPanelKey({
        type: String(n.blockRef.type),
        binding: (n.blockRef.binding ?? {}) as ExperienceBlockInstance["binding"],
      });
      if (key) keys.add(key);
    }
    if (Array.isArray(n.children)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(freeformContent?.root, 0);
  return keys;
}

/**
 * 积木自己内部也可能重复（模型把同一份榜声明两次）——同指纹只留第一个。
 * 指纹为 null 的（其余区块类型）一律保留，不参与去重。
 *
 * `alreadyPlaced` 是已经在别处（freeform 设计树里）摆过的指纹，一并跳过。
 */
export function dedupeBlocksByPanelKey(
  blocks: readonly ExperienceBlockInstance[],
  alreadyPlaced?: ReadonlySet<string>
): ExperienceBlockInstance[] {
  const seen = new Set<string>(alreadyPlaced ?? []);
  const out: ExperienceBlockInstance[] = [];
  for (const b of blocks) {
    const key = blockPanelKey(b);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(b);
  }
  return out;
}
