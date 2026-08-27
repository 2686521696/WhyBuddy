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
 * ## 为什么不是"再弹一张卡等回答"
 *
 * 因为它**不该拦**。工厂中途停下来等回答会撞上闭环的 fail-closed 语义
 * （停下来算不算没闭环、恢复算不算同一轮）。所以这里选的是：推演照跑，
 * 决定摊开摆着，用户想改就把那条改动接进**已经验证过的中途排队**
 * （midrun-queue，本轮结束自动发出）。「用户 → AI」那条路一行没动。
 *
 * ⚠ 所以本模块**不产生任何新的等待状态**。没有 pending、没有 blocking，
 *   用户从头到尾可以什么都不点。不点 = 就按模型定的做，这是个合法结局。
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
  incoming: readonly SpecAssumption[]
): SpecAssumption[] {
  const next = prev.slice();
  for (const row of incoming) {
    if (!row || !row.id) continue;
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

/** 用户处理完（改了 / 就这样）→ 从面板上撤掉。找不到就原样返回，不抛。 */
export function settleAssumption(
  list: readonly SpecAssumption[],
  id: string
): SpecAssumption[] {
  return list.filter(row => row.id !== id);
}
