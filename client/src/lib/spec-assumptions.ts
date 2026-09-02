/**
 * 伴随式澄清：推演中「我替你定了什么」（纯逻辑层）。
 *
 * ## 这一层治的是哪一句抱怨
 *
 * > 澄清部分，就一次问答，问题不是根据指令动态生成的，也不是伴随式的。
 *
 * 点火**之前**那一轮问答（控制面 clarify）能问的只有粗维度——谁用、在哪用、
 * 核心流程、本期边界。因为那时候还没人开始画，更细的分叉根本不存在。
 *
 * 真正让产品长得不一样的分叉是**画到第 2 步才浮出来的**：员工登录用手机号
 * 还是工号、审批一级还是两级、库存下单扣还是发货扣。它们此前一直是静默的：
 * 模型自己定了，一个字不说，用户十分钟后打开成品才发现做错了。
 *
 * ## 2026-09-02：改成选完再继续
 *
 * 真机上「只摊开不拦」不好用——用户对着一排改成 X 不知道怎么往下走。
 * 产品裁决：做成跟点火前澄清卡同一套权力，一题一题选，点「确认继续」
 * 才放行。工厂用现成的协作式暂停（run_pause）在安全点等，不再边跑边点。
 */

export type SpecAssumption = {
  id: string;
  /** 这件事是什么：「员工怎么登录」 */
  topic: string;
  /** 模型定成了什么：「手机号 + 短信验证码」 */
  decision: string;
  /** 这个行业里真会有人选的其他做法。可以为空——那就只是"知会一声"。 */
  alternatives: string[];
  why: string;
};

/**
 * 模型给的「字符串清单」→ string[]；形状真的不认识才返回 null。
 *
 * 抄的标准答案：grok-build `xai-tool-types/src/serde_lenient.rs`
 *
 *     //! Lenient deserializers for tool arguments whose wire shape models get
 *     //! wrong in predictable ways.
 *     /// - array of strings/numbers → each element as a string (`228` → `"228"`),
 *     /// - bare string or number → one-element list,
 *     /// - `null` → empty list.
 *     /// Booleans, objects, and nested arrays are rejected (`None`).
 *
 * ⚠ 跟 Python 侧 `sliderule_llm.structured.lenient_string_list` 是**同一张表**
 *   （CLAUDE.md §4）。两边都要有，是因为服务端洗过之后这条流还接老后端和
 *   续播缓存；两边口径必须一致，否则同一份数据在两处渲染出两个结果。
 *   改任一边都得回来改另一边——判据 `alternatives 的宽容口径两边一致` 盯着。
 *
 * 要害是**裸字符串 → 单元素数组**，不是空数组。上一版两边都写的是
 * `Array.isArray(x) ? x : []`，模型把 alternatives 写成 "工号或扫码" 时那条
 * 备选被静静扔掉，卡退化成"知会一声"，用户想改都没得点。
 */
export function lenientStringList(value: unknown): string[] | null {
  const one = (v: unknown): string | null => {
    if (typeof v === "boolean") return null;
    if (typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return null;
  };
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      const text = one(item);
      if (text === null) return null;
      out.push(text);
    }
    return out;
  }
  const text = one(value);
  return text === null ? null : [text];
}

/**
 * 新到的假设并进已有的。
 *
 * ⚠ **按 id 去重，这条不是可选的**：run_registry 的 subscribe 会把整段事件
 *   日志从 since 补播一遍（刷新页面、切走再回来、网络抖动重连都会）。不去重
 *   的话，用户刷一次页面面板上就多出一整份重复的卡。
 *   同款形状在 specPages 上已经踩过一次（"同一页第二次到达 → 覆盖不是追加"）。
 *
 * 后到的同 id 覆盖先到的，并且**留在原来的位置**——面板上的卡不许因为一次
 * 重连就重新洗牌。
 */
export function mergeAssumptions(
  prev: readonly SpecAssumption[],
  incoming: readonly SpecAssumption[],
  settledIds?: ReadonlySet<string>
): SpecAssumption[] {
  const next = prev.slice();
  for (const row of incoming) {
    if (!row || !row.id) continue;
    if (settledIds?.has(row.id)) continue;
    const i = next.findIndex(p => p.id === row.id);
    if (i < 0) next.push(row);
    else next[i] = row;
  }
  return next;
}

/**
 * 用户点了另一种做法 → 排队里那句话。
 *
 * ⚠ 必须**同时说出"改成什么"和"不要什么"**。只说"改成工号"，下游读到的是
 *   一条追加要求，而原来那条（手机号）在上一版 spec 里还立着——真机上
 *   出现过两种登录入口并存的页面。用户原话本来就是两句一起说的：
 *   「登录页面**不要手机号**，**改成工号**」。
 */
export function revisePhrase(row: SpecAssumption, alternative: string): string {
  const alt = String(alternative ?? "").trim();
  if (!alt) return "";
  const topic = String(row?.topic ?? "").trim();
  const decision = String(row?.decision ?? "").trim();
  const head = topic ? `${topic}：` : "";
  if (!decision || decision === alt) return `${head}改成${alt}`;
  return `${head}不要${decision}，改成${alt}`;
}

/**
 * 用户处理完（改了 / 就这样）→ 从面板上撤掉。找不到就原样返回，不抛。
 *
 * ⚠ 光从列表里删**不够**，调用方必须同时把这个 id 记进「已处理」集合，
 *   再把集合传给 mergeAssumptions（见上面那个参数）。理由是同一条：
 *   续播恒从 since=0 全量补播（sliderule-marathon-driver：「恒从 since=0
 *   全量补播」），所以刷新页面 / 切走再回来 / 网络抖动重连之后，
 *   **用户刚处理掉的那张卡会原样回来**。2026-08-27 审查探针实测：
 *       settleAssumption([row],"a1") → 0 张
 *       mergeAssumptions(那 0 张, [row]) → 1 张   ← 又回来了
 *   点过「改成工号」的用户再点一次，同一句补充就排进队列两遍。
 *
 * 抄的标准答案：grok-build `xai-grok-pager/src/app/dispatch/interject.rs`
 *     /// Our own broadcast echoes back carrying the same id; the id is
 *     /// recorded in `self_interjection_ids` so `handle_interjection` drops
 *     /// the echo instead of rendering a duplicate.
 *     /// (Optimistic-echo + reconcile-by-id, mirroring the shared prompt queue.)
 *   —— 自己处理过的事，按 id 记下来，回声照着 id 丢掉。
 */
export function settleAssumption(
  list: readonly SpecAssumption[],
  id: string
): SpecAssumption[] {
  return list.filter(row => row.id !== id);
}

/**
 * SSE / 落库 spec 两头同一份清洗。形状不对宁可少一张，不许把 undefined 摊上屏。
 *
 * ⚠ 2026-09-02 真机：P1-1 spec-only hop 结束很快，`spec_assumption` 事件
 *   有时没赶上前端还在听的那截流，卡整轮不出现。spec 已经写进
 *   specFirstPages.spec.assumptions——落库那份必须也能把卡摊出来。
 */
export function parseSpecAssumptions(rows: unknown): SpecAssumption[] {
  const list = Array.isArray(rows) ? rows : [];
  return (
    list.filter(r => !!r && typeof r === "object") as Array<Record<string, unknown>>
  )
    .map((r, i) => ({
      id: String(r.id || `a${i + 1}`),
      topic: String(r.topic || "").trim(),
      decision: String(r.decision || "").trim(),
      alternatives: (lenientStringList(r.alternatives) ?? [])
        .map(a => a.trim())
        .filter(Boolean),
      why: String(r.why || "").trim(),
    }))
    .filter(r => r.topic && r.decision);
}

/**
 * 面板抬头：**说这一刻真会发生的事**（2026-08-28）。
 *
 * ## 事故
 *
 * 卡不随推演结束而消失，是这个模块**有意**的设计（AssumptionStrip 头注：
 * 「它就该一直待在输入框上方，直到用户处理掉」，resetSpecAssumptions 只在
 * 开新一轮和切会话时调用）。这条不改。
 *
 * 问题在于**同一张卡在两个时刻意思完全不同，外观却一模一样**：
 *
 *     推演中   「我正打算这么做，你现在改还来得及」→ 改动进中途排队，本轮结束发出
 *     推演完   「这一轮已经这么做了」            → 改动是开新一轮的事
 *
 * 而抬头一直写着「推演中我替你定了这几件事」。真机（截图那场）推演早已
 * closed，抬头照旧说"推演中"——用户以为还在改眼前这一轮。
 *
 * ⚠ 修的是**这张卡说什么**，不是让它消失。让它消失会撞上面那条有意设计；
 *   而继续说"推演中"是在骗人。两者之间的正解是改口。
 *
 * 抄的标准答案还是 grok-build：它给不同种类的交互配不同的收场话术与可关性
 * （`PromptBlocked` 那类按 Esc 关不掉，会 toast「choose Edit, Resend, or
 * Discard」——把"你现在能做什么"直说出来），而不是同一张卡从头到尾一句话。
 */
export function assumptionsHeading(count: number, isRunning: boolean): string {
  return isRunning
    ? `待确认（${count}）· 选完再继续`
    : `请确认这些假设（${count}）· 选完再继续`;
}
