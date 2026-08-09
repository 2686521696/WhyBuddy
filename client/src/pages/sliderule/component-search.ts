/**
 * 组件库的**意图搜索**（2026-08-08）。
 *
 * ## 要解决的问题
 *
 * 用户的原话：不只是搜 `Table` / `Select` / `RecordForm`，而是能搜
 *
 *     「我要选择客户」  「做一个订单筛选」  「显示销售趋势」  「上传并预览合同」
 *
 * 此前的搜索是一行 `description.includes(kw)`，而且**只作用于区块那一档**
 * ——基础组件档下敲什么都没反应（实测）。
 *
 * ## 为什么光有全文检索不够
 *
 * 「选择客户」和「下拉选择」之间差的不是拼写，是**语义**。更要命的是基础组件
 * 目录有一条明写的纪律：示例和说明里**不许出现业务词**（「订单」「门店」出现
 * 就是滑回业务积木那一层了）。所以「客户」「合同」「销售」这些词在语料里
 * **一次都不会出现**——纯全文检索永远搜不到。
 *
 * 于是分两层：
 *
 *     ① 意图词表   业务话 → 能力词    「客户/供应商/订单」→「关联 选择 记录」
 *     ② 全文检索   能力词 → 具体组件   BM25 排序，字段加权
 *
 * ① 是这套东西的智商所在，② 只是把它落到具体条目上。
 *
 * ## 为什么用 MiniSearch
 *
 * 拉到本地读过（lucaong/minisearch，MIT，零依赖，约 2200 行）。选它的理由是
 * **IDF**：「选择」在几十条说明里出现（该降权），「签名」只在一条里出现
 * （该升权）。朴素的 includes 计数排不出这个差别——搜「签名」会被一堆含
 * 「选择」的条目淹掉。自己写一遍 BM25 不是不行，但它已经写好、测好，而且
 * 零依赖。
 *
 * **默认分词器不能用**：它按空格和标点切词，中文一整句会变成一个 token。
 * 所以自定义分词（见 tokenize）——这也是选它而不是别家的原因之一，
 * 分词是个明确的注入点，不用去改它的内部。
 */

import MiniSearch from "minisearch";

import {
  BASE_COMPONENTS,
  type BaseComponentDef,
} from "./base-components/base-catalog";
import catalogJson from "@experience-blocks";

/** 一条可被搜到的东西：区块或基础组件。 */
export interface SearchDoc {
  /** 唯一 id：`block:DataTable` / `base:ProFormSelect`（两档可能重名） */
  id: string;
  kind: "block" | "base";
  /** 组件/区块名 */
  name: string;
  /** 中文名。区块没有单独的中文名，用类型名兜底 */
  label: string;
  description: string;
  /** 能力词：分组、族、能力面、用到的基础组件、意图词表命中的词 */
  tags: string;
}

/**
 * CJK 分词：中文按**字 + 相邻两字**切，英文数字按词切。
 *
 * 为什么是 bigram 而不是真正的分词器（jieba 之类）：
 *
 * - 真分词器要带词典，压缩后也有几百 KB，为一个组件库搜索框不值当；
 * - bigram 对「检索」这件事的召回其实**更好**——分词器把「订单筛选」切成
 *   「订单/筛选」，一旦用户打「单筛」就搜不到了；bigram 两边都覆盖。
 * - 代价是索引大一点。250 条文档，无所谓。
 *
 * 同时保留单字：用户搜「表」应该能命中「表格」。
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  // 先把 ASCII 词整体拿出来（ProFormSelect、DataTable 这类要能整词命中）
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) out.push(w);
  // 驼峰拆开：ProFormSelect → pro form select
  for (const w of text.match(/[A-Z][a-z0-9]+/g) ?? []) out.push(w.toLowerCase());
  // CJK：连续汉字串，出单字 + 相邻二字
  for (const run of text.match(/[一-龥]+/g) ?? []) {
    for (let i = 0; i < run.length; i++) {
      out.push(run[i]);
      if (i + 1 < run.length) out.push(run.slice(i, i + 2));
    }
  }
  return out;
}

/**
 * **查询侧**分词：把单个汉字丢掉，只留二字词。
 *
 * 索引侧仍然出单字（搜「表」要能命中「表格」是真实需求），但查询侧留着单字
 * 是灾难——它让「一句话里的每个常用汉字」都去跟整份目录做连连看。
 *
 * 2026-08-09 实测（语料 328 条）：
 *
 *     查询                 单字+二字   只留二字
 *     zzzz不存在              84 条      2 条
 *     显示销售趋势           115 条     26 条
 *     做一个订单筛选         189 条     50 条
 *
 * 「zzzz不存在」原本能出 84 条，是因为「不」「存」「在」这三个字在几乎每条
 * 说明里都有。这不是排序问题，是**这些字压根不该参与检索**。
 *
 * 中文检索里"只用 bigram 不用 unigram"是常规做法（unigram 召回的增量远小于
 * 它带来的噪声）。这里做成**索引侧留、查询侧丢**的不对称，是因为
 * MiniSearch 明确支持 `searchOptions.tokenize` 单独覆盖查询分词
 * （见 minisearch/src/MiniSearch.ts 的 SearchOptions.tokenize：
 * "Function to tokenize the search query. By default, the same tokenizer
 * used for indexing is used."）——两边各取所长，不用牺牲哪一边。
 *
 * 兜底：滤完一个词都不剩（用户就打了一个「表」字）时退回原分词，
 * 否则单字查询会变成"永远搜不到"。
 */
export function tokenizeQuery(text: string): string[] {
  const all = tokenize(text);
  const kept = all.filter(t => !SINGLE_CJK_RE.test(t));
  return kept.length > 0 ? kept : all;
}

const SINGLE_CJK_RE = /^[一-龥]$/;

/**
 * 意图词表：**业务话 → 能力词**。
 *
 * 左边是用户会打出来的词，右边是语料里真实存在的词。这张表是手写的，而且
 * 应该一直是手写的——它编码的是"这个业务动作在我们这套组件里叫什么"，
 * 那是产品知识，不是可以从语料里统计出来的东西。
 *
 * 加词的判据：**用户会这么说，而语料里没有这个词**。语料里已经有的词
 * （「表格」「按钮」）不用进表——全文检索本来就能命中。
 */
/**
 * 意图词的分量。低于 1 = 原话说了算。
 *
 * 0.45 是调出来的：再高「销售→金额」这类间接词会把正主压下去，再低则
 * 「客户」这种语料里压根不存在的词就召不回东西了。
 */
export const INTENT_WEIGHT = 0.45;

/**
 * 区块**排在基础组件前面**。
 *
 * 这不是搜索技巧，是用户定的产品次序（原话）：「基础组件 / ProComponents 更多
 * 作为底层能力」「用户首先看到……真正能直接装进应用的东西」。
 *
 * 一个区块和一个基础组件同样相关时，区块更有用——它是能直接摆进页面的整块，
 * 基础组件还得先被组装。1.6 是量出来的：搜「显示销售趋势」时刚好让
 * MetricGrid / TrendChart / ProportionPie 越过 ProFormMoney（后者只是因为
 * 「销售→金额」间接命中），又不至于让区块无差别霸榜——搜「ProFormRate」
 * 时第一名仍然是它自己。
 */
export const KIND_WEIGHT: Record<SearchDoc["kind"], number> = {
  block: 1.6,
  base: 1,
};

/**
 * 相关度**截断**：低于头名这个比例的丢掉。
 *
 * 这条是实测逼出来的，不是调参：查询走 OR + 前缀 + 中文 bigram，一句
 * 「做一个订单筛选」几乎**跟语料里每一条都有一点点关系**（随便哪条说明里
 * 有个「一」或「个」都算命中）。排序是对的——头几名确实是四个筛选区块——
 * 但**当筛选用就完全失效**：23 个区块全都"匹配"，搜完跟没搜一样多。
 *
 * 所以排序和筛选要分开看：排序靠分数，筛选靠这条线。0.25 是量出来的，
 * 「做一个订单筛选」在这条线下留 8 个区块（四个筛选块 + 几个沾边的），
 * 再松就开始把整份目录放进来。
 */
export const SCORE_CUTOFF = 0.15;

/** 再多就不是"搜到了"而是"列了个表"。 */
export const MAX_HITS = 60;

/**
 * **身份字段**：命中这几个才算真的搜到了，只蹭到说明散文的不算。
 *
 * ## 为什么需要一条绝对判据
 *
 * `SCORE_CUTOFF` 是**相对**的（拿本档头名 ×0.25），它能修剪长尾，但回答不了
 * 「到底搜没搜到」这个问题——因为分母是别的结果，不是查询本身。
 *
 * 成熟方案在这一点上是一致的：
 *
 *   · **Meilisearch** 的 `_rankingScore` 归一化到 0..1，官方文档明写
 *     "A document's ranking score does not change based on the scores of other
 *     documents in the same index"，`rankingScoreThreshold` 因此是绝对的；
 *   · **Fuse.js** 的分数是 `errors / pattern.length`（见
 *     src/search/bitap/computeScore.ts）——**分母是查询，不是语料**，
 *     所以 `threshold: 0.6` 加多少文档都还是那个意思；
 *   · **cmdk**（shadcn 命令面板）分数 0..1，过滤就是 `score > 0`，
 *     一条不过就渲染 `Command.Empty`，**不硬凑**。
 *
 * ## 这个语料上，绝对判据该拿什么当分母
 *
 * 试过按 BM25 分数归一化、按文档频率自动挑停用词，都不干净：328 条的语料里
 * 「存在」「这个」「东西」这类散文词的文档频率也不高，统计上分不出它们和
 * 「筛选」「趋势」的差别。
 *
 * 真正分得开的是**命中在哪个字段**——照 Algolia 的 searchableAttributes 分层
 * 那套（身份属性在前、长文本在后）：
 *
 *     name / label  这东西叫什么
 *     tags          它是什么能力（family / capability / dataKinds 的中文）
 *     description   一段散文，什么词都可能出现
 *
 * 2026-08-09 实测（语料 328 条，加上这条判据前 → 后）：
 *
 *     显示销售趋势      298 → 259     做一个订单筛选   275 → 214
 *     审批记录          231 → 192     批量导出         250 → 187
 *     zzzz不存在         84 →   0     的了吗           159 →   0
 *     这个东西在不在     129 →   0
 *
 * 七句真查询一条没伤到，三句垃圾查询清零。
 */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set(["name", "label", "tags"]);

/** 这条结果是否命中了身份字段（而不是只蹭到说明里的散文）。 */
function matchedIdentityField(match: Record<string, string[]>): boolean {
  for (const fields of Object.values(match)) {
    for (const f of fields) if (IDENTITY_FIELDS.has(f)) return true;
  }
  return false;
}

export const INTENT_LEXICON: Array<[RegExp, string]> = [
  // ── 选择关联记录 ──────────────────────────────────────────────────
  [/客户|供应商|厂商|商户|门店|员工|人员|部门|负责人|经办人/, "关联 选择 下拉 记录 引用"],
  [/订单|单据|工单|合同|发票|凭证|申请单/, "记录 明细 表格 详情 关联"],
  [/选择|选取|挑选|指定|选个|选一个|选中/, "选择 下拉 单选 多选 级联 树"],
  // ── 筛选查询 ─────────────────────────────────────────────────────
  [/筛选|过滤|查询|检索|搜索|找出|按条件/, "筛选 查询 搜索 条件 过滤"],
  [/关键词|关键字|搜一下|搜框/, "搜索 关键词 输入"],
  [/时间范围|日期范围|起止|区间|近七天|本月/, "区间 日期 起止 范围"],
  // ── 统计与趋势 ───────────────────────────────────────────────────
  [/趋势|走势|增长|环比|同比|曲线|变化/, "趋势 走势 折线 图表 迷你 涨跌"],
  [/销售|营收|业绩|金额|成交|收入|流水/, "金额 数值 统计 指标 千分位"],
  [/统计|概览|汇总|总览|大盘|看板|仪表盘|指标|kpi/i, "指标 统计 汇总 卡片 概览 聚合"],
  [/占比|构成|比例|份额|分布/, "占比 饼图 环形 比例 分布"],
  [/排行|排名|榜单|top|前几/i, "排行 排名 列表 进度"],
  // ── 表单录入 ─────────────────────────────────────────────────────
  [/新建|新增|录入|填写|提交|创建|登记/, "表单 录入 提交 新建 字段"],
  [/编辑|修改|更新|改一下/, "编辑 表单 录入 行内"],
  [/分步|向导|一步一步|多步/, "分步 步骤 向导"],
  [/弹窗|对话框|抽屉|浮层/, "弹窗 抽屉 对话框 容器"],
  [/评分|打分|星级|满意度/, "评分 星级 打分"],
  [/开关|启用|禁用|是否/, "开关 布尔 切换"],
  [/密码|脱敏|隐藏|敏感/, "密码 脱敏 遮蔽"],
  [/签名|签字|手写/, "签名 手写 画布"],
  [/验证码|短信码/, "验证码 倒计时"],
  // ── 附件与文档 ───────────────────────────────────────────────────
  [/上传|附件|文件|导入/, "上传 附件 文件 拖拽"],
  [/预览|查看文件|看图|图片/, "预览 图片 缩略图 查看"],
  [/导出|下载|excel|表格文件/i, "导出 下载 表格"],
  [/富文本|正文|文档|说明书|手册/, "文本 长文本 渲染 编辑器"],
  [/代码|脚本|json|sql|公式/i, "代码 编辑器 高亮 语法"],
  // ── 流程与记录 ───────────────────────────────────────────────────
  [/审批|审核|流转|流程|节点|状态机/, "流程 节点 链路 时间轴 审批"],
  [/日志|动态|历史|记录轨迹|操作记录/, "时间轴 动态 记录 历史"],
  [/待办|任务|待处理/, "列表 任务 状态 待办"],
  // ── 批量与列表操作 ───────────────────────────────────────────────
  [/批量|多选操作|一次性|勾选/, "批量 选中 勾选 操作栏"],
  [/列设置|显示哪些列|隐藏列|调整列/, "列 设置 显示 顺序"],
  [/分页|翻页/, "分页 翻页"],
  [/排序|拖动排序|调整顺序/, "排序 拖拽 顺序"],
  // ── 版面 ────────────────────────────────────────────────────────
  [/详情|明细页|查看详情/, "详情 描述 键值 只读"],
  [/卡片|磁贴/, "卡片 容器"],
  [/导航|菜单|侧边栏|面包屑/, "导航 菜单 面包屑 布局"],
  [/提示|警告|通知|报错/, "提示 警告 通知 反馈"],
];

/** 意图词表命中的能力词（**不含原话**）。 */
export function intentTerms(query: string): string {
  return INTENT_LEXICON.filter(([re]) => re.test(query))
    .map(([, w]) => w)
    .join(" ");
}

/** 把一句自然语言展开成"原话 + 能力词"。 */
export function expandIntent(query: string): string {
  const extra = intentTerms(query);
  return extra ? `${query} ${extra}` : query;
}

/** 区块目录的最小形状（只取搜索要用的字段）。 */
interface CatalogBlock {
  type: string;
  description?: string;
  family?: string;
  capability?: string;
  dataKinds?: string[];
  pageKinds?: string[];
  allowedRegions?: string[];
  /** 通用主力还是特定场景件。缺省 = 未标注，按 1 算（见 GENERALITY_BOOST）。 */
  generality?: "generic" | "specific";
}

/**
 * **业务优先级**加权：通用主力排在特定场景件前面。
 *
 * ## 为什么这件事文本分算不出来
 *
 * 2026-08-09 语料从 26 涨到 111 之后，搜「做一个订单筛选」头四名是
 * BookingDirectoryFilter / IssueEventFilter / FacetedFilterPanel /
 * TimelineFilterBar，而 `FilterBar` 掉到第 14。
 *
 * 这不是分词或权重没调好——**这几个在文本上是等价的**：family 全是 `filter`，
 * 能力标签全是同一串「筛选 过滤 查询 条件」，说明里也都在讲筛选。BM25 只能
 * 看词，看不出「大部分应用要的是 FilterBar，只有做预订系统才要
 * BookingDirectoryFilter」——那是产品判断，不在语料里。
 *
 * Algolia 把这件事讲得最清楚（customRanking 的文档）：
 *
 *     "Textual relevance does not include business relevance, which is used to
 *      provide a custom ranking based on non-textual information."
 *     "Custom Ranking acts as a tiebreaker when multiple results are equally
 *      relevant."
 *
 * 也就是：**文本相关性和业务优先级是两个维度，必须分开声明**，指望调权重把
 * 后者从前者里挤出来是徒劳的。
 *
 * ## 挂在哪
 *
 * MiniSearch 原生就有这个钩子——`searchOptions.boostDocument(id, term,
 * storedFields) => number`（见 minisearch/src/MiniSearch.ts:62，返回值直接乘进
 * BM25 分数，返回假值则整条剔除）。所以不需要在外面再套一层重排。
 *
 * ## 现在还没有数据
 *
 * 目录里 `generality` 字段暂时是空的，缺省按 1 算 —— **行为与不加这段完全
 * 一致**。这里先把接口留出来，是为了让"给 111 个区块标通用性"变成一件纯粹的
 * 数据活儿（可以由 LLM 出初稿、人过一遍），而不是又一次改排序代码。
 */
const GENERALITY_BOOST: Record<string, number> = {
  generic: 1.25,
  specific: 1,
};

const CATALOG = catalogJson as { blocks: CatalogBlock[] };

/**
 * 区块的能力面 → 中文能力词。
 *
 * 区块目录里 family / capability / dataKinds 全是英文（`filter`、`aggregate`、
 * `entityRows`），而基础组件那边的分组是中文（「数据录入」「数据展示」）。
 * 不补这一层的话，**中文查询在区块那一档只能命中说明正文**，标签字段（权重
 * 是说明的两倍）等于空转——实测「订单筛选」搜不到 FilterBar，而它的能力面
 * 正是 filter。
 *
 * 这是内容缺口，不是排序参数：右边这些词是「这个能力面用中国话怎么说」。
 */
const CAPABILITY_CN: Record<string, string> = {
  filter: "筛选 过滤 查询 条件",
  aggregate: "指标 统计 汇总 聚合 概览",
  series: "趋势 走势 图表 曲线 占比",
  rankedRows: "排行 排名 榜单 列表",
  timelineRows: "时间轴 动态 日志 历史",
  entityRows: "表格 列表 记录 明细",
  action: "操作 按钮 动作",
  form: "表单 录入 填写 编辑",
  chain: "流程 链路 节点 审批",
  container: "容器 卡片 版面",
  outcome: "结果 反馈 结束",
  freeform: "自由 设计 洞察",
};

/** 区块中文名从渲染实现那边的标签表来；查不到就用类型名（不编）。 */
function blockDocs(labelOf: (type: string) => string | undefined): SearchDoc[] {
  return CATALOG.blocks.map(b => ({
    id: `block:${b.type}`,
    kind: "block" as const,
    name: b.type,
    label: labelOf(b.type) ?? b.type,
    description: b.description ?? "",
    tags: [
      b.family,
      b.capability,
      CAPABILITY_CN[b.capability ?? ""] ?? "",
      ...(b.dataKinds ?? []).map(k => CAPABILITY_CN[k] ?? k),
      ...(b.dataKinds ?? []),
      ...(b.pageKinds ?? []),
      ...(b.allowedRegions ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  }));
}

function baseDocs(usesOf: (name: string) => string[]): SearchDoc[] {
  return BASE_COMPONENTS.map((c: BaseComponentDef) => ({
    id: `base:${c.name}`,
    kind: "base" as const,
    name: c.name,
    label: c.label,
    description: c.description,
    // 「被哪些区块用了」也进索引：搜「批量」能顺带找到 BatchActionBar 用到的
    // 那几个基础组件，这正是"区块 + 能力组件 + 基础组件一起给"的意思。
    tags: [c.group, c.source ?? "", c.platform, ...usesOf(c.name)].join(" "),
  }));
}

/**
 * 建索引。
 *
 * 字段加权的道理：名字和中文名是"这东西叫什么"，说明是"它干什么"。
 * 用户打「评分」时，叫「评分」的那条该排在说明里提到评分的前面。
 */
export function buildIndex(
  labelOf: (type: string) => string | undefined,
  usesOf: (name: string) => string[]
): { search: (q: string) => SearchDoc[]; docs: SearchDoc[] } {
  const docs = [...blockDocs(labelOf), ...baseDocs(usesOf)];
  const generalityBoost = new Map<string, number>(
    CATALOG.blocks
      .filter(b => b.generality)
      .map(b => [`block:${b.type}`, GENERALITY_BOOST[b.generality!] ?? 1])
  );
  const mini = new MiniSearch<SearchDoc>({
    idField: "id",
    fields: ["name", "label", "tags", "description"],
    storeFields: ["id"],
    tokenize,
    // 查询侧不做额外处理：expandIntent 已经把意图词拼进去了，
    // 再 stem 一次只会把中文切坏。
    processTerm: t => t,
    searchOptions: {
      boost: { name: 4, label: 4, tags: 2, description: 1 },
      // 前缀匹配：打「Pro」要能出 ProForm*；打「筛」要能出「筛选」
      prefix: true,
      // OR：一句话里命中一个词就该出来，全中才出等于没法用自然语言问
      combineWith: "OR",
      // 查询侧单独分词：索引留单字保召回、查询丢单字去噪（见 tokenizeQuery）
      tokenize: tokenizeQuery,
      // 业务优先级（通用主力 vs 特定场景件），与文本相关性分开（见 GENERALITY_BOOST）
      boostDocument: (id: any) => generalityBoost.get(String(id)) ?? 1,
    },
  });
  mini.addAll(docs);

  const byId = new Map(docs.map(d => [d.id, d]));
  return {
    docs,
    /**
     * 两遍打分：**原话说了算，意图词只帮忙**。
     *
     * 一开始是把原话和意图词拼成一个串搜，实测搜「显示销售趋势」出来的第一名
     * 是 ProFormMoney，而 TrendChart 前八名都进不去——因为「销售」经词表展开
     * 成「金额」，而「金额」在语料里比「趋势」罕见（IDF 高），一个帮忙的词把
     * 正主压下去了。
     *
     * 拆成两遍、原话权重更高，就没这个问题：意图词负责**召回**（把语料里
     * 压根没有的业务词接上），原话负责**排序**。
     */
    search: (q: string) => {
      const kw = q.trim();
      if (!kw) return [];
      const score = new Map<string, number>();
      const passes: Array<[string, number]> = [
        [kw, 1],
        [intentTerms(kw), INTENT_WEIGHT],
      ];
      // 只蹭到说明散文的一律不算命中（判据与实测见 IDENTITY_FIELDS）。
      // 这是**绝对**判据，回答"搜没搜到"；下面的 SCORE_CUTOFF 是相对的，
      // 只负责修剪长尾。两件事分开，语料再涨也不会互相污染。
      const identityHit = new Set<string>();
      for (const [text, weight] of passes) {
        if (!text) continue;
        for (const r of mini.search(text)) {
          const id = String(r.id);
          score.set(id, (score.get(id) ?? 0) + r.score * weight);
          if (matchedIdentityField(r.match)) identityHit.add(id);
        }
      }
      const ranked = [...score.entries()]
        .filter(([id]) => identityHit.has(id))
        .map(([id, sc]) => [byId.get(id), sc] as const)
        .filter((e): e is readonly [SearchDoc, number] => Boolean(e[0]))
        .sort((a, b) => b[1] - a[1]);
      // 空就是空——照 cmdk 的做法渲染空态，不硬凑几条充数。
      if (ranked.length === 0) return [];

      /**
       * 截断**按档各算各的**。
       *
       * 一开始是全局一条线（拿总榜头名算），实测搜「显示销售趋势」时基础组件
       * **一条都不剩**——区块有 1.6 的加权，总榜前几名全是区块，那条线一划下来
       * 把所有基础组件都砍了。而用户要的恰恰是「区块 + 能力组件 + 基础组件」
       * 一起给。
       *
       * 两档各按自己那一档的头名划线，谁也淹不了谁；档间的先后仍由 KIND_WEIGHT
       * 决定（区块在前）。
       */
      const keep: Array<readonly [SearchDoc, number]> = [];
      for (const kind of ["block", "base"] as const) {
        const inKind = ranked.filter(([d]) => d.kind === kind);
        if (inKind.length === 0) continue;
        const floor = inKind[0][1] * SCORE_CUTOFF;
        const above = inKind.filter(([, sc]) => sc >= floor);
        // 过了身份判据的都是**真命中**，这条线只用来修剪长尾，不再"至少凑 N 条"。
        // 原来那条 MIN_HITS_PER_KIND 是给相对截断打的补丁：截断线跟着头名飘，
        // 头名一突出就把近邻全削掉，于是又反过来强行补 3 条。补丁的副作用是
        // **搜不到时也照样端出 3 条**——实测「zzzz不存在」能出 4 条，用户看到
        // 结果就以为这是最接近的，而不是"没找到"。绝对判据接管了"有没有"之后，
        // 这块补丁没有存在理由了。
        keep.push(...above.slice(0, MAX_HITS));
      }
      return keep
        .sort((a, b) => b[1] * KIND_WEIGHT[b[0].kind] - a[1] * KIND_WEIGHT[a[0].kind])
        .map(([d]) => d);
    },
  };
}
