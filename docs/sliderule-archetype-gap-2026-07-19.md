# SlideRule 应用形态差距分析(2026-07-19,含同日审查修正)

> **修订说明**:本文档初版把"现有能力"判断偏低(只读了数据层 `app-runtime-schema.ts`,
> 没读渲染层 `AppRuntimeScreen.tsx`),并给出了"4~5 种应用类型枚举"的错误方案。
> 经对着代码逐条核对后重写:**核心诊断(硬编码首页)保留**,现有能力据实更正,
> 破法改为不违背北极星"非固定流水线"原则的动态方案。

## 一句话结论(修正后)

SlideRule **已经能做页面级形态多样**(3 套外壳 + 6 种页面范式),但**所有页面仍被塞进同一个硬编码的"工作台"首页**,而且**模型选出的形态无处落库**——设计菜谱在 prompt 里告诉了模型"好首页长什么样",五系统 Schema 却没有字段保存这个答案。千人一面的最大元凶是**写死的首页**,不是"只有一种模子"。

## 对比:当前 vs 目标

- 当前效果:`docs/workbench.png`(应用中心,15+ 应用卡片,首页高度雷同)
- 目标稿:`docs/assets/Illustration.png`(多形态:桌面大盘 / 移动 App / 代码助手 / CRM / 流程画布)

## 准确的诊断(经代码核对成立)

### 1. 硬编码首页 = 最大元凶(核心结论,不变)

`client/src/pages/sliderule/live-runtime/app-runtime-schema.ts` 的 `deriveAppRuntimeSchema()` 固定生成首页四卡:前两个实体行数、进行中审批、累计流程实例;两图:各实体数据量(bar)、审批状态分布(donut)。

`AppRuntimeScreen.tsx` 的 `homeContent`(约 856 行)在此之上还固定追加"快速入口"和"审批动态"timeline。

**后果**:哪怕用户要的是学习计划、内容创作、舆情监控,首页也带着审批味道。**这是当前最该先拆的地方。**

### 2. Identity 能力偏浅(成立)

当前只能生成 `productName / theme / icon / nav(side|top)`。主题注册表(`identity-themes.ts`)虽有八套色,但主要控主色/背景/三种图表色,**没有字体、密度、阴影、圆角、深浅模式**的完整配方。"只换皮不够"成立。

### 3. 设计菜谱缺少落库位置(全场最准的洞察)

项目已把 37 张视觉稿蒸馏成设计菜谱(`v5_design_reference.py` + `data/design_recipes.json`),向生成 prompt 注入 `navStyle / homeArchetype / widgets / accentHint / namingStyle`。**但五系统 Schema 只能接收 `appIdentity`、页面 `kind`、stats/charts/ranking/feed——`homeArchetype` 等大量菜谱内容没有合法字段可落。**

> 准确表述:不是"LLM 没有形态意识",而是"**Prompt 已告诉模型好首页长什么样,Schema 却没地方保存这个答案**"。

## 初版对现有能力的低估(据代码更正)

以下是初版说错、经 `AppRuntimeScreen.tsx` 核对后更正的判断:

| 初版说法 | 更正(代码事实) |
|---|---|
| 当前只有一种 Shell / 只渲染一种外壳 | **错**。已有三套:`desktopShell`(左侧栏)、`topShell`(`nav==="top"` 顶部导航)、`phoneShell`(手机 App 壳 + 底部 TabBar);平板是桌面的紧凑主从变体。 |
| 只覆盖后台管理系统 | **重了**。已有 6 种页面范式:`workbench` / `kanban`(真看板) / `calendar`(真月历) / `dashboard`(图表升主角) / `wizard`(Steps+页) / `monitor`(stats+主图两栏+侧边榜流)。 |
| 每个页面都是表格+表单+抽屉 | **部分错**。workbench/dashboard/wizard 仍带表格;但 kanban/calendar 已是真正不同的视图。深度不一(wizard 只是顶部加 Steps,下面仍是通用数据页)。 |
| 当前 LLM 没在选形态 | **错**。Prompt 已要求模型选 `appIdentity.nav` 和每页 `kind`,菜谱还注入 `homeArchetype`。 |
| mobile 应作为应用 archetype | **不合适**。`device`(desktop/tablet/phone)是独立于 nav / page kind 的第三根轴——移动端是设备/渠道,不是业务形态。 |
| 当前只能生成 management / code assistant | **错**。`CodeProjectionView` 只是 schema 的只读代码投影,不是生成的 IDE 应用;management 也不能与之归为一类。 |

**正确表述**:当前已能动态选择**页面级**形态,但所有页面仍被放进同一个**应用级首页**与有限外壳中,且部分范式只是浅层变体。

## 方案哲学纠错:不要退化成"固定应用类型"

初版方案(法律助手→management、暑假计划→mobile、流程工具→canvas)是**固定类型分类**,违背北极星"V5 不是固定阶段流水线"。一个动态应用可能同时含:首页 monitor + 任务页 kanban + 日程页 calendar + 配置页 wizard + 数据页 workbench。

- `analytics_monitor` / `workflow_inbox` / `management_workspace` 更适合作**页面构图方式**,不应是整个应用的唯一类型。
- `mobile`(设备)、`canvas`(交互能力)、`code_assistant`(产品工作区)**不在同一分类维度**,不能塞进一个 `archetype` 枚举。

否则只是把"千系统一面"变成"五张固定面孔"——LLM 从五套模板里选一套,仍不是动态生成。

## 破法(重排:先拆首页,再动态构图,不建固定类型)

### 第一刀:让模型指定首页,而不是先加应用类型

在五系统模型 `appbundle` 增加 `homePageRef`:

```json
{ "homePageRef": "insight_overview" }
```

运行时:有 `homePageRef` → 直接把该页作为首页(复用现有 monitor/dashboard/ranking/feed/stats/charts);没有 → 保持当前硬编码工作台作老模型降级;**不再强制所有应用额外出现"审批+实体数量"首页**。改动比加五种应用级 archetype 小,效果最直接,且正好补上"菜谱 homeArchetype 无处落库"的洞。

### 第二刀:加强页面级动态构图(在 `page.kind` 上长)

```json
{
  "id": "risk_overview",
  "kind": "monitor",
  "composition": {
    "summary": ["risk_metrics"],
    "primary": ["risk_trend"],
    "secondary": ["customer_ranking"],
    "activity": ["alert_feed"]
  }
}
```

模型仍按用户指令动态选材;`composition` 只描述本页怎么组织,不判"这是什么系统"。

### 第三刀:应用 Shell 与设备分开(两根独立轴)

```json
{ "experienceShell": "navigation|focus|canvas" }
{ "supportedDevices": ["desktop", "mobile"] }
```

`experienceShell` 只表示导航与工作空间;设备单独声明。手机壳已存在,缺的只是"是否移动优先"的声明,**不用再写一套手机渲染器**。`canvas` 不能只换外壳——它还需节点/边/端口/选择器/属性面板/画布动作等协议,**单独后置**。

### 落地顺序

1. `homePageRef`:拆掉强制工作台
2. 页面级 `composition`:模型动态选材构图
3. `experienceShell`:应用工作空间
4. 设备声明:复用现有手机壳
5. canvas / IDE:等相应业务协议成熟再做

**不要先建"4~5 种应用类型"。**

## 发布门(修正:当前不成立,需先补)

`scripts/verify-sliderule-v5.sh` 当前**没有**运行 `app-runtime-schema.test.ts`,浏览器冒烟只测推演主路径,不检查生成应用的首页/Shell/页面范式。

> 正确要求:**每刀必须先把对应单测 + 生成应用浏览器验收加入 `verify:sliderule-v5`**,再做功能(符合北极星决策清单第 4 条)。

## 开源参照(三刀分别抄谁)

**关键结论:"AI 判定应用形态 → 渲染不同外壳"开源界无现成完整轮子**(SDUI/低代码都默认单一后台形态)。三刀各抄成熟机制,archetype/动态构图这层是 SlideRule 差异化。

| 刀 | 抄什么 | 项目 | 许可/活跃 |
|---|---|---|---|
| 第一刀 homePageRef + 第二刀 composition 合法域 | `defineCatalog` 单一真相源 + Zod enum 派生(prompt/validate/schema 同源) | `vercel-labs/json-render` | MIT · 活跃 ★★★★★ |
| 第二刀 选材约束 gate | 结构化输出约束到枚举 + devtools 的 Pick/Catalog/Stream 面板 | `vercel-labs/json-render` | MIT · 活跃 ★★★★★ |
| 第三刀 分渲染器(区块级) | 按 type 的渲染器注册思路 + 诚实降级 | **Grafana** panel plugin(仅参考"区块注册",非应用 Shell 类比) | AGPL(只读思路)★★★☆☆ |
| 第三刀 跨端(以后) | 一份 spec → 多渲染器、增量更新、给 agent 而非给人 | `google/A2UI`(> DivKit) | Apache-2.0 · v0.8 只抄思想 ★★★★☆ |
| 第四刀 换皮(backlog) | designRecipeRef:token/圆角/阴影/字体配方引用 + registry 分发 | tweakcn / shadcn GitHub Registries | tweakcn Apache-2.0 · 现在别碰 ★★★☆☆ |

**许可证订正(2026-07-19 复核)**:A2UI 是 **Apache-2.0**(非早期误记);tweakcn 是 **Apache-2.0**(不是项目注释里写的 MIT)。json-render 仍为 MIT。

**能力边界提醒**:json-render 能保证"只输出合法枚举",但**不能判断模型是否为用户选对了形态**——第二刀的"正确选材"仍需 SlideRule 自己的 prompt、证据、评测和决策留痕。

## 相关文档

- 北极星:`docs/NORTH_STAR.md`(黄金路径、决策清单)
- 能力池:`docs/SlideRuleV5CapabilityPool.md`
- 长期记忆:`~/.claude/.../memory/sliderule-single-archetype-gap.md`(AI 跨会话自动读取)

## 关键代码位置(实施时按图索骥)

- 数据层写死首页:`client/src/pages/sliderule/live-runtime/app-runtime-schema.ts`(`deriveAppRuntimeSchema` 的 `home` 段)
- 渲染层写死首页 + 三套 Shell + 六种范式:`client/src/pages/sliderule/live-runtime/AppRuntimeScreen.tsx`(`homeContent` / `desktopShell` / `topShell` / `phoneShell`)
- 五系统模型 Schema(需加 `homePageRef` / `composition` / `experienceShell` 字段):`client/src/pages/sliderule/system-screens/five-system-model.ts`
- 设计菜谱注入(homeArchetype 现无处落库):`slide-rule-python/services/v5_design_reference.py`
- 发布门(需加生成应用验收):`scripts/verify-sliderule-v5.sh`
