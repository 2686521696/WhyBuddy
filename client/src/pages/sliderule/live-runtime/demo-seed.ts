/**
 * demo-seed — 演示用种子数据（2026-07-28）。
 *
 * 为什么需要：闭环产出的应用第一次打开时每个实体都是零行，于是表格、图表、
 * KPI、体验区块全线出"暂无数据"。那是**诚实空态**，不是 bug——但对展会/试用
 * 场景来说，访客第一眼看到的是一堆空壳，辛苦生成的版式一个都读不出来。
 *
 * 边界（这三条是这个模块存在的前提，改动前先读）：
 *
 * 1. **只填完全为空的实体**。有一行真实数据的实体永远不碰——种子和真实数据
 *    绝不混在同一张表里，否则用户分不清哪条是自己写的。
 * 2. **每行都带 `seed: true` 标记**，渲染层据此出「示例数据」徽标。不做无标注
 *    的假数据：伪造得越像越该标出来。
 * 3. **用户往某实体写第一条真实数据时，该实体的种子整批清掉**
 *    （dropSeedRowsFor）。所以"新建"之后看到的就只有自己那一条。
 *
 * 确定性：值只由 (entityId, fieldId, 行下标) 决定，不用随机数——同一个模型
 * 每次打开看到的示例完全一样，截图/回归可比。唯一的时间依赖是日期字段的
 * 参照点 nowMs（显式传入，单测可钉死）。
 *
 * 逼真度的取舍：enum 走**声明里的真实取值**（徽标颜色/看板列才有意义）、
 * 数字按 format 落在合理量纲（money 四位数、percent 0-100、rating 1-5）、
 * 日期落在最近两周（day 粒度的趋势图才有形状）；只有自由文本是明显合成的
 * 「字段名+序号」——该合成的地方不装真。
 */

import type { FiveSystemEntity, FiveSystemModel } from "../system-screens/five-system-model";
import { guessRefEntityId } from "../system-screens/five-system-model";
import { normalizeFieldFormat, normalizeFieldOptions } from "./field-display";
import type { RuntimeRow, RuntimeState } from "./live-runtime";

/** 每个空实体铺几行。12：够触发表格分页（>10）、够排行取前 5、够趋势图有形状。 */
export const SEED_ROW_COUNT = 12;

/** 日期字段的散布跨度（天）。14 天配 day 粒度 → 14 个桶，不稀不挤。 */
const SEED_DATE_SPAN_DAYS = 14;

const SEED_ID_PREFIX = "seed-";

/** 稳定字符串哈希（确定性、跨平台一致；不求密码学强度）。 */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
  return h;
}

function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 单个字段的示例取值。
 *
 * number 分档看 format：不分档的话 money 会出现 ¥7、rating 会出现 183 分，
 * 一眼假且把 KPI 的量纲带歪。format 归一化复用 field-display 的那份
 * （类型不匹配的 format 在那里已经丢弃），不另起一套判定。
 */
function seedValueFor(
  entityId: string,
  field: NonNullable<FiveSystemEntity["fields"]>[number],
  index: number,
  nowMs: number,
  entities: FiveSystemEntity[]
): unknown {
  const type = String(field.type ?? "string").toLowerCase();
  const h = hashOf(`${entityId}:${field.id}`);
  const label = field.name || field.id;

  if (type === "enum") {
    const options = normalizeFieldOptions("enum", field.options);
    // 没有声明取值时不瞎编枚举——留空，渲染层按"未填"处理
    if (options.length === 0) return "";
    return options[(index + h) % options.length].id;
  }

  if (type === "number") {
    const fmt = normalizeFieldFormat("number", field.format);
    const step = (h + index * 17) % 100;
    if (fmt === "money") return 1200 + ((h + index * 37) % 40) * 350;
    if (fmt === "percent" || fmt === "progress") return step;
    if (fmt === "rating") return 1 + ((h + index) % 5);
    if (fmt === "score") return 60 + ((h + index * 9) % 41);
    return 10 + ((h + index * 13) % 240);
  }

  if (type === "date") {
    // 步长必须与跨度互质，否则 12 行只会落到少数几天上：第一版写的是
    // `index * 7 % 14`，7 和 14 不互质 → 只有 0 和 7 两个余数，真跑出来的
    // 「月度收款趋势」整条折线只有两个点。3 与 14 互质，12 行落 12 天。
    const back = (index * 3 + h) % SEED_DATE_SPAN_DAYS;
    const d = new Date(nowMs);
    d.setDate(d.getDate() - back);
    return localDateKey(d);
  }

  if (type === "ref") {
    // 存的是**目标实体那一行的显示名**，不是行 id。
    //
    // 一开始存的是 id（`seed-member-5`），想着这样详情/下拉能对上。真跑一看，
    // 动态流的标题、看板卡、表格单元格全是原样打印 row.values，于是首页动态
    // 流整列写着 "seed-member-5 / seed-member-7"——运行时压根没有"ref 值 →
    // 目标行显示名"的解析，值落到哪儿就原样显示到哪儿。既然如此，直接把
    // 解析后的样子存进去，看到的就是「成员 5」。
    const target = guessRefEntityId(
      field.id,
      entities.map(e => e.id)
    );
    const targetEntity = target ? entities.find(e => e.id === target) : undefined;
    if (!targetEntity) return `${label} ${index + 1}`;
    return seedDisplayNameOf(targetEntity, (index + h) % SEED_ROW_COUNT);
  }

  if (type === "text") return `「${label}」的示例内容，用于展示版式与信息密度。`;

  return `${label} ${index + 1}`;
}

function seedRowId(entityId: string, index: number): string {
  return `${SEED_ID_PREFIX}${entityId}-${index + 1}`;
}

/**
 * 某实体第 index 行的"显示名"——取第一个 string 字段，拼出与那一行自己
 * 生成的值**逐字相同**的字符串（见下面 string 分支的 `${label} ${i+1}`）。
 * 对不上就成了指向一条不存在的记录，比留 id 更糟。
 *
 * 只看 string：text 字段的种子值是一整句话，当名字太长；ref 不看，免得
 * 两个实体互相引用时递归绕不出来。
 */
function seedDisplayNameOf(entity: FiveSystemEntity, index: number): string {
  const named = (entity.fields ?? []).find(
    f => f?.id && String(f.type ?? "string").toLowerCase() === "string"
  );
  if (!named) return `${entity.name || entity.id} ${index + 1}`;
  return `${named.name || named.id} ${index + 1}`;
}

/**
 * 这一行是种子吗。
 *
 * 只认 `seed` 标记，**不拿 id 前缀兜底**：种子行被用户编辑过之后
 * （updateRow 会摘掉标记）id 还是 seed-xxx，靠前缀判就会把已经装着真实
 * 输入的行继续当示例。判定权只给一个字段。
 */
export function isSeedRow(row: RuntimeRow | null | undefined): boolean {
  return row?.seed === true;
}

/** 这张表里还剩几行是种子。 */
export function seedRowCount(
  state: RuntimeState | null | undefined,
  entityId: string | null | undefined
): number {
  if (!state || !entityId) return 0;
  const rows = state.entities[entityId];
  return Array.isArray(rows) ? rows.filter(isSeedRow).length : 0;
}

/**
 * 这个实体现在**还在展示**种子吗——用 some 不用 every：一张表里混着 1 条
 * 真实数据 + 11 条种子时，"整表都是真的"显然不成立，徽标必须继续挂着。
 * 零行返回 false：零行是诚实空态，不是示例。
 */
export function entityShowsSeed(
  state: RuntimeState | null | undefined,
  entityId: string | null | undefined
): boolean {
  return seedRowCount(state, entityId) > 0;
}

/** 给一个实体造一批种子行。createdAt 也按下标回溯，动态流才有先后。 */
export function buildSeedRows(
  entity: FiveSystemEntity,
  /** 全部实体（ref 字段要拿目标实体的字段定义来拼显示名） */
  allEntities: FiveSystemEntity[],
  nowMs: number,
  count = SEED_ROW_COUNT
): RuntimeRow[] {
  const fields = entity.fields ?? [];
  return Array.from({ length: count }, (_, i) => {
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      if (!field?.id) continue;
      values[field.id] = seedValueFor(entity.id, field, i, nowMs, allEntities);
    }
    return {
      id: seedRowId(entity.id, i),
      values,
      createdAt: new Date(nowMs - i * 36e5 * 5).toISOString(),
      seed: true as const,
    };
  });
}

/**
 * 给状态铺种子：**只动完全为空的实体**，其余原样返回。
 *
 * 幂等：铺过一次之后实体非空，再调不会重复铺。所以三个运行时入口
 * （运行应用 / 实体数据面板 / 工作流试运行）都可以在 hydrate 时无脑调一次，
 * 谁先谁后都收敛到同一份状态——否则某个面板存了一份没种子的状态，
 * 另一个面板加载到它就再也铺不上了。
 *
 * 一行都没改时返回原对象（引用相等），避免白触发一次 re-render/持久化。
 */
export function seedRuntimeState(
  state: RuntimeState,
  model: FiveSystemModel | null | undefined,
  nowMs: number = Date.now()
): RuntimeState {
  const entities = model?.datamodel?.entities ?? [];
  if (entities.length === 0) return state;

  let changed = false;
  const next: Record<string, RuntimeRow[]> = { ...state.entities };
  for (const entity of entities) {
    if (!entity?.id) continue;
    const existing = next[entity.id];
    if (Array.isArray(existing) && existing.length > 0) continue;
    next[entity.id] = buildSeedRows(entity, entities, nowMs);
    changed = true;
  }
  return changed ? { ...state, entities: next } : state;
}

/**
 * 清掉某实体的种子行——用户往这张表写第一条真实数据之前调。
 *
 * 不做"保留种子、追加真实行"：两者混在一起之后，表格里哪条是自己刚写的
 * 就得靠眼力找，而「示例数据」徽标也没法再如实描述整张表。
 */
export function dropSeedRowsFor(
  state: RuntimeState,
  entityId: string | null | undefined
): RuntimeState {
  if (!entityId) return state;
  const rows = state.entities[entityId];
  if (!Array.isArray(rows) || !rows.some(isSeedRow)) return state;
  return {
    ...state,
    entities: { ...state.entities, [entityId]: rows.filter(r => !isSeedRow(r)) },
  };
}
