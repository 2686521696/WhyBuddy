# 槽位约束审查：结构门连拦 4 次同类违规（2026-08-01）

只读审查，未改动代码。起因：2026-08-01 跑首轮耗时基线时（诊所话题，
`scripts/fresh_topic_shot.py`），结构门 `passed=False`，4 条 findings **全部
是同一类**——区块放错槽位：

```
page.pages[today_overview].layout.primary:
  block 'today_queue' (type ActivityFeed) is not allowed in slot 'primary';
  catalog allows: activity/secondary
page.pages[today_overview].layout.secondary:
  block 'appointment_stages' (type WorkflowTimeline) not allowed in 'secondary';
  catalog allows: primary/content
page.pages[appointment_calendar].layout.secondary: 同上（WorkflowTimeline）
page.pages[followup_board].layout.secondary:      同上（WorkflowTimeline）
```

同一类错误在一次生成里重复 4 次，不像随机失误。查下来是**两个问题叠加**：
约束表里有无渲染依据的限制，加上提示词只说"不能怎样"、不说"为什么"。

## 一、严重性：这会真的拦住应用发布

`v5_model_gate.py:1123` 是 `return {"passed": len(findings) == 0, ...}`
——**任何一条 finding 都 fail-closed**。生产链路：

```
生成 → 结构门拦 → E37 门裁决回喂，有界重生成一次 → 仍不过 → MODEL_GATE_BLOCKED
```

即再犯一次整个应用就发布失败。这是用户可见的硬故障，不是警告。

## 二、渲染层实测：5 个槽位名，只有 4 种视觉行为

实测自 `client/src/pages/sliderule/live-runtime/AppRuntimeScreen.tsx:1490-1532`：

| 槽位 | 实际渲染 |
| --- | --- |
| `summary` | `flex flex-wrap` 横向一行铺开 |
| `primary` | `flex-[2]` → 2/3 宽栏 ┐ 同一行并排 |
| `secondary` | `flex-1` → 1/3 窄栏 ┘ |
| `activity` | `flex flex-col gap-2` 通栏全宽 |
| `content` | `flex flex-col gap-2` 通栏全宽 |

两条关键事实：

1. **`activity` 与 `content` 的 className 逐字节相同**，只差垂直顺序
   （activity 在 content 之前渲染）。视觉上是同一种区域。
2. **`renderBlock` 不接收 slot 参数**（`AppRuntimeScreen.tsx:1420-1432`）——
   区块自身怎么渲染跟它在哪个槽完全无关，槽位只决定放进哪个容器 div。

所以"某区块能不能放某槽"的唯一物理依据是**宽度**，除此之外没有别的机制。

## 三、按这个依据核对全部 8 个通电区块

| 区块 | allowedSlots | 有无依据 |
| --- | --- | --- |
| MetricGrid | summary, primary | — |
| TrendChart | primary, secondary | — |
| RankedList | primary, secondary | — |
| **ActivityFeed** | activity(全宽), secondary(1/3) | ⚠️ **宽度区间有洞**：禁了中间的 primary(2/3) |
| **DataTable** | primary, content(全宽) | ⚠️ 禁 activity，但 activity 与 content 渲染相同 |
| QuickActionPanel | summary, primary | — |
| FilterBar | summary | — 合理（筛选条就该在顶部） |
| **WorkflowTimeline** | primary, content(全宽) | 禁 secondary **有依据**；禁 activity 无依据 |

两类无依据的限制：

- **宽度区间有洞（ActivityFeed）**：它被允许放在 1/3 窄栏，也被允许放在
  全宽通栏，唯独禁掉中间的 2/3 主栏。若一个区块窄能放、宽也能放，中间档
  必然也能放——这条限制不存在物理解释。
  （ActivityFeed 的 `variant: timeline|row` 是**模型自己填的 prop**，不由
  槽位派生，所以也不是"变体选择依赖槽位"造成的。）
- **activity/content 二选一**：三个区块各自只开了其中一个。既然两者渲染
  逐字节相同，开一个禁一个没有任何效果差异，纯属任意。

唯一站得住的限制是 **WorkflowTimeline 禁 secondary**：目录里它的描述原文是
"**横向**连接的流程阶段条"，塞进 1/3 窄栏确实会挤坏。

## 四、根因：装饰性元数据一夜之间变成了阻断规则

`v5_model_gate.py:1063-1065` 的注释自己写清楚了：

> 每个区块类型早就声明了自己能放哪些槽位（allowedSlots），此前这里只查
> "槽位名合法 + 区块 id 存在"，从没拿这份数据交叉核对过——一个 RankedList
> 塞进 activity 槽也不会被拦。

即 `allowedSlots` **长期只是文档**，没有任何东西读它。2026-07-30 的 `6fe1c13`
把它接进结构门变成硬校验，但**这些值本身没有被重新审过**。

这正是"未经审计的文档值被提升为法律"的典型：写这些值的时候它们不生效，
所以没人推敲；生效那天它们直接成了阻断规则。

## 五、本轮两类违规，责任不同

- **ActivityFeed → primary：模型是对的，目录是错的。**
  诊所应用的 `today_overview` 页，"今日候诊队列"本来就是这一页的主内容，
  放 2/3 主栏是正确的设计判断。是那个无依据的洞把它拦下来了。
- **WorkflowTimeline → secondary ×3：模型是错的**，约束本身正确。
  但提示词只给了 `slots=primary,content` 这张表，**没给理由**。模型退回
  语义直觉（"流程条是辅助信息 → 放 secondary"），而正确答案的依据是
  "它是横向的、窄栏放不下"——这条理由不在 prompt 里。

## 六、建议（需产品决策，故未改动代码）

1. **补 `ActivityFeed` 的 `primary`**——填上宽度区间的洞。
2. **`activity`/`content` 的限制统一**：要么三处都同时开放，要么正视
   "这两个槽渲染完全相同"这一事实、考虑合并成一个槽位名。保持现状等于
   让模型去猜一个没有差别的差别。
3. **WorkflowTimeline 保持禁 `secondary`，但在 prompt 里写出理由**：
   把 `slots=primary,content` 这种裸表，改成带一句"因为它是横向流程条，
   1/3 窄栏放不下"。

第 3 条有本仓库自己的先例支撑，措辞方式在这个项目里反复被证明会决定模型
行为：
- `schema_legal.py:407-409` 记着：写成许可式（"You MAY emit…"）时七个通电
  区块一个都没被用，同目标连跑三次全是 0，换成祈使式并说清"不用的代价"
  之后才有产出。
- `GEN5` 节点注释记着：binding 哨兵词写 `"none"` 时模型把它当成要填的值，
  QuickActionPanel 全产出 `entityRef:"none"`。

## 七、复现

```
cd slide-rule-python
.venv/bin/python scripts/fresh_topic_shot.py "社区诊所的患者预约与复诊随访管理" /tmp/out
# 观察 [fresh] gate passed=False findings=4
```

注意这个脚本不 fail-closed（拦了也继续跑增强），所以能看到完整链路；
生产路径会在这里走 E37 回喂重试。
