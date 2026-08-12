/**
 * 流程主链路派生（2026-08-11）。
 *
 * ## 为什么要单独成模块
 *
 * 同一份 `workflow`（节点 + 迁移）在运行时有**两处**要画成步骤条：
 *
 *   · `WorkflowTimeline` 区块（block-registry）——页面自己声明的流程条
 *   · 向导页的宿主骨架（AppRuntimeScreen）——`kind === "wizard"` 时顶部那条
 *
 * 这两处原来各写一遍，而且写法不同：区块修过（见下面的分支逻辑），宿主那条还是
 * `nodes.slice(0, 8).map(...)`——**按声明数组顺序铺**。于是同一个模型在同一页
 * 上出现两条步骤条，上面那条把「拒绝兑换」画成正向第 4 步，下面那条不画。
 * 一个页面两种说法，哪条对都说不清。
 *
 * 派生逻辑放这里，两处共用一份；顺带把"哪个是分支出口"的判据也统一了。
 *
 * ## 判据：从入口沿"向前"的边走，走不到的就是分支出口
 *
 * 线上截图里「拒绝兑换」是第 4 步、「退回调整」「退回重做」是第 5 步——**驳回被
 * 铺成了正向流程的下一步**，等于告诉用户"走完确认发放就该去拒绝兑换"。
 *
 * 根因是直接 `nodes.map(...)` 完全没读 transitions 的图结构。真实模型的图有
 * 分支和回环，比如告警值班那趟：
 *
 *     alert_routed       → alert_notified   「存在匹配的生效路由策略」
 *     alert_routed       → alert_rejected   「没有匹配的路由策略」   ← 分支
 *     alert_notified     → alert_routed     「超过升级时限，重新路由」← 回环
 *     alert_acknowledged → alert_rejected   「确认后判定为误报」     ← 分支
 *     alert_rejected     → alert_routed     「误报判定被撤回」       ← 回环
 *
 * antd 的 Steps 表达的是**线性进度**，图里的分支塞不进去。成熟做法也是分开：
 * NocoBase 的审批节点把驳回做成**分支**（"可以配置为执行驳回分支后结束流程"），
 * Camunda 用网关——都没有"驳回是第 N+1 步"这种表达。
 *
 * 所以：从入口（没有入边的节点）出发，每步只走**向前**的边（目标在声明序里更
 * 靠后、且没走过）。走不动就停。剩下的节点是分支出口，调用方单独渲染，不进 Steps。
 *
 * ## 岔口选哪条：走**能走得最远**的那条（2026-08-11 实测改）
 *
 * 第一版的判据是"优先无条件边，其余按目标声明序取最近的"。**那条在真实产出上
 * 是错的**，跑一趟"培训机构退费审批"当场翻车：
 *
 *     [0] refund_draft   [1] academic_review  [2] academic_return ← 驳回
 *     [3] finance_review [4] finance_return   [5] payment_pending  [6..7] 打款/归档
 *
 *     academic_review → finance_review    「核算通过」      两条都有条件
 *     academic_review → academic_return   「数据不完整」    ↑
 *
 * 两条都有条件 → 落到"取目标声明序最近的" → 选中下标 2 的 **academic_return**，
 * 也就是**一头拐进驳回分支**；而它只有一条回环边（→ academic_review，已走过），
 * 于是主链路在第 3 步就断了，财务复核/待打款/完成打款/归档 4 个真正的正向节点
 * 全被判成"分支出口"。步骤条只剩 3 步，比不改还糟。
 *
 * 根因是"模型按流程顺序声明节点"这个假设太弱：作者习惯**把驳回节点紧挨着它的
 * 来源写**（教务核算后面立刻写教务退回），所以驳回的下标恒定小于下一个真步骤，
 * "取最近的"必然选中驳回。
 *
 * 换成结构判据：**比较两条边各自还能往前走多远**，取更长的那条。驳回节点通常
 * 只往回连（或直接终止），前向链长 1；真正的下一步后面还挂着整条流程。上例里
 * academic_return 长 1，finance_review 长 4，选后者。告警值班那趟同理
 * （alert_rejected 只回连 → 1，alert_notified 一路到 resolved → 更长）。
 *
 * 长度相同才退回旧判据（无条件边优先 → 目标声明序靠前优先），保证结果确定。
 * 前向图按定义是无环的（下标严格递增），所以链长可以直接记忆化递归算，不会转圈。
 */

/** 迁移边。只用到这三个字段，故意不收窄成某一处的具体类型。 */
export interface WorkflowTransitionLike {
  from?: string;
  to?: string;
  condition?: string;
}

export interface WorkflowMainPath<N> {
  /** 主链路节点，按前进顺序。可以直接铺成 Steps。 */
  mainPath: N[];
  /**
   * 分支出口：主链路走不到的节点，附上"从哪条边、因为什么"进来的。
   * 一个驳回节点常有多个来源（上例 alert_rejected 有两条入边），
   * 只显示节点名说明不了什么。
   */
  branchExits: Array<{ node: N; reasons: string[] }>;
  /**
   * 节点 id → **继续主链路**那条边的条件。
   *
   * ## 这里踩过一个坑，别改回去
   *
   * 原来是 `new Map(transitions.filter(有条件).map(t => [t.from, t.condition]))`
   * ——按 **from** 建键，于是一个节点有多条出边时**只留下最后一条**。
   * `alert_routed` 两条出边里活下来的是「没有匹配的路由策略」，也就是说
   * **正常路径的步骤上显示的是驳回分支的条件**。线上那行橙字正是这么来的。
   * 现在只取"继续主链路那条边"的条件，驳回条件归到 branchExits 里。
   */
  advanceCondition: Map<string, string>;
}

export function deriveWorkflowMainPath<N extends { id?: string }>(
  nodes: readonly N[],
  transitions: readonly WorkflowTransitionLike[]
): WorkflowMainPath<N> {
  const orderOf = new Map(nodes.map((n, i) => [String(n.id), i]));
  const outgoing = new Map<string, Array<{ to: string; condition?: string }>>();
  const incomingCount = new Map<string, number>();
  transitions.forEach(t => {
    const from = String(t.from ?? "");
    const to = String(t.to ?? "");
    if (!from || !to) return;
    (outgoing.get(from) ?? outgoing.set(from, []).get(from)!).push({
      to,
      condition: t.condition ? String(t.condition) : undefined,
    });
    incomingCount.set(to, (incomingCount.get(to) ?? 0) + 1);
  });

  const entry = nodes.find(n => !incomingCount.get(String(n.id))) ?? nodes[0];
  const advanceCondition = new Map<string, string>();
  const walked = new Set<string>();

  /**
   * 从某个节点出发，沿**前向边**还能走多少步（记忆化）。
   *
   * 只看"目标下标更大"的边，所以这张图无环，递归一定收敛——不需要额外的
   * visiting 标记。注意这是**静态**属性：不看 walked，否则同一个节点在走图
   * 过程中会算出不同的长度，岔口的比较就没有可比性了。
   */
  const reachCache = new Map<string, number>();
  const forwardReach = (id: string): number => {
    const cached = reachCache.get(id);
    if (cached !== undefined) return cached;
    const here = orderOf.get(id) ?? -1;
    let best = 0;
    for (const e of outgoing.get(id) ?? []) {
      if ((orderOf.get(e.to) ?? -1) <= here) continue; // 回环/横跳不算"往前"
      best = Math.max(best, 1 + forwardReach(e.to));
    }
    reachCache.set(id, best);
    return best;
  };

  /**
   * 只用 id 走图（不是拿节点对象当游标）。写成 `let cursor: N | undefined` 再从
   * 循环体里回推，会让 TS 推断成环——循环体里的 forward/next 都依赖 cursor 的
   * 类型，而 cursor 的类型又要靠循环体推出来，报 TS7022。走 id 就没有这个纠缠。
   */
  const mainPathIds: string[] = [];
  let cursorId: string | undefined = entry ? String(entry.id) : undefined;
  while (cursorId && !walked.has(cursorId)) {
    walked.add(cursorId);
    mainPathIds.push(cursorId);
    const here = orderOf.get(cursorId) ?? -1;
    const forward = (outgoing.get(cursorId) ?? []).filter(
      e => !walked.has(e.to) && (orderOf.get(e.to) ?? -1) > here
    );
    // 走得最远的那条优先；并列时才回到"无条件优先 → 声明序靠前优先"
    const next: { to: string; condition?: string } | undefined = [...forward].sort(
      (a, b) =>
        forwardReach(b.to) - forwardReach(a.to) ||
        (a.condition ? 1 : 0) - (b.condition ? 1 : 0) ||
        (orderOf.get(a.to) ?? 0) - (orderOf.get(b.to) ?? 0)
    )[0];
    if (next?.condition) advanceCondition.set(cursorId, next.condition);
    cursorId = next?.to;
  }

  const mainPath = mainPathIds.flatMap(id => {
    const hit = nodes.find(n => String(n.id) === id);
    return hit ? [hit] : [];
  });

  const branchExits = nodes
    .filter(n => !walked.has(String(n.id)))
    .map(n => ({
      node: n,
      reasons: transitions
        .filter(t => String(t.to ?? "") === String(n.id) && t.condition)
        .map(t => String(t.condition)),
    }));

  return { mainPath, branchExits, advanceCondition };
}
