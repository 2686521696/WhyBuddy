/**
 * 推演中补的话：排队到下一轮（纯逻辑层）。
 *
 * 用户的原话就是产品要求：「对了，登录页面不要手机号，改成工号」——
 * 正常人的理解是**我补充了一条要求**，不是"停掉重来"，更不是"这句话消失"。
 *
 * ⚠ 2026-08-27 真机实测的老形态：推演中点发送 → `queuedTurnRef.current = text`
 *   + `setInput("")`，而那个 ref **没有 state、没导出、没有任何地方渲染**。
 *   于是用户看到的是：输入框清空、整页搜不到这句话、几分钟后它自己发出去。
 *   机制是通的，人是懵的。
 *
 * ⚠ 而且旧写法是**覆盖**：连补两句，第一句被第二句悄悄顶掉。"队列"这个词
 *   本身就是承诺了会累积；覆盖是第二次无声丢失。
 */

/** 追加一条。空白忽略；跟上一条一模一样也忽略（用户连点两下发送）。 */
export function enqueueTurn(
  list: readonly string[],
  text: string
): string[] {
  const t = String(text ?? "").trim();
  if (!t) return [...list];
  if (list.length > 0 && list[list.length - 1] === t) return [...list];
  return [...list, t];
}

/** 撤掉其中一条（用户改主意了）。越界返回原样，不抛。 */
export function removeQueued(list: readonly string[], index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    return [...list];
  }
  return list.filter((_, i) => i !== index);
}

/**
 * 队列 → 下一轮真正要发的那段话。
 *
 * ⚠ 合成**一条**，不是逐条各发一轮：三句补充发三轮 = 烧三次工厂，而且前两轮
 *   的产物立刻被后一轮推翻。用户补的是同一件事的三个细节。
 */
export function mergeQueuedTurns(list: readonly string[]): string {
  return list.map(s => s.trim()).filter(Boolean).join("\n");
}
