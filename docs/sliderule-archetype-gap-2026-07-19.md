# SlideRule 应用形态差距分析(2026-07-19)

> 一句话:SlideRule 生成的应用**千人一面**,根因不是"生成能力弱",而是**顶层只有一种模子**——所有应用都被浇进同一个"后台管理系统"骨架,只换了颜色和图标。

## 对比:当前 vs 目标

- 当前效果:`docs/workbench.png`(应用中心,15+ 个应用卡片,形态完全一致)
- 目标稿:`docs/assets/Illustration.png`(应用中心,多形态:桌面大盘 / 移动 App / 代码助手 IDE / CRM 表格 / 流程画布)

| 维度 | workbench.png(当前) | Illustration.png(目标) |
|---|---|---|
| 应用形态 | **只有 1 种**:后台管理系统 | **多种**:桌面大盘 / 移动 App / 代码助手 / CRM / 流程画布 |
| 外壳(Shell) | 全部"左菜单 + 工作台 + CRUD" | 有的无侧栏(移动手机壳)、有的是画布、有的是暗色 IDE |
| 首页 | 全部硬编码"审批 + 实体行数" | 大盘首页是图表墙,待办首页是任务流,CRM 首页是客户表 |
| 差异来源 | 只有配色 / 图标 | 骨架本身不同 |

目标稿约 4~5 类原型(archetype):
- **analytics_monitor**(经营大盘 / 用户增长 / 销售报告)— 首页即图表,弱 CRUD
- **workflow_inbox**(待办事项 / 消息中心)— 首页是任务流 / 审批流
- **mobile_app**(9:41 手机壳那几张)— **无侧栏**,竖屏,卡片式
- **canvas_designer**(流程设计器)— 画布 + 节点,没有表格
- **management_workspace / code_assistant**(AI 代码助手 / CRM)— 当前唯一能生成的那类

**当前架构只覆盖最后一类,且把其他所有应用硬套进这一类。**

## 根因:模子写死在哪

关键文件 `client/src/pages/sliderule/live-runtime/app-runtime-schema.ts`。开头注释即露馅:

> 五系统模型 → 一份可直接渲染成**完整后台系统**的 JSON schema(el-form-renderer / el-data-table 哲学:菜单、表格列、表单项全部 JSON 化,渲染器照 schema 出**真系统长相**)

`AppRuntimeSchema` 是焊死的后台骨架:

```
appName + identity(theme/icon/nav:side|top) + roles + home(工作台) + menus + pages
```

三处致命的"写死":

1. **每个应用强制有"工作台"首页,且首页内容硬编码**(`deriveAppRuntimeSchema` 的 home 段,约 508–555 行):4 张统计卡永远是"前两个实体行数 + 进行中审批 + 累计流程实例",2 张图永远是"各实体数据量(bar) + 审批状态分布(donut)"。一个"小学生暑假计划"应用首页也硬塞"进行中审批 / 流程实例"——这就是 workbench.png 里每张卡顶部三个数字框都一样的原因。**这是千人一面最大的元凶。**

2. **每个页面本质都是"表格 + 表单 + 详情抽屉"的 CRUD 页**(`columns / formFields / detailFields`)。`view.kind`(kanban / calendar / dashboard / wizard / monitor,约 108–114 行)只是同一"左菜单 + 工作台 + 实体 CRUD"外壳内的变体。

3. **`identity` 只能换三样**(约 559–567 行):`theme`(颜色)、`icon`(图标)、`nav`(侧栏 / 顶栏)。这正是 **tweakcn 换皮天花板**——破得了颜色统一,破不了布局统一。

## 为什么"只做身份段 / 换皮"救不了

差异不在颜色,在**结构层级**。当前能调的旋钮(theme / icon / nav)全在最表层。要产生目标稿的多样性,得在**比 identity 更高的层级**引入决定"这是什么形态的应用"的东西——即 **experienceShell(外壳)+ archetype(原型)**。

## 破法(按北极星"不铺摊子"原则排序)

三刀都满足:不新增 6 Skill 之外的产品概念、可被 `verify:sliderule-v5` 覆盖。

**第一刀 — 把"形态"提升为一等公民(改动最小、收益最大)**

在 `AppRuntimeSchema` 顶层加 `archetype` 字段(先枚举 4~5 种),由它决定两件当前写死的事:

- **Shell**:`management`(左菜单)/ `mobile`(手机壳无侧栏)/ `canvas`(画布)/ `analytics`(大盘优先)
- **Home 怎么长**:不再无脑塞"审批 + 实体行数"。analytics 型首页 = 页面声明的 charts / stats 铺满;inbox 型首页 = feed 流;mobile 型首页 = 卡片竖排。

关键:拆掉 `home` 的硬编码(约 508–555 行),改成"由模型 / archetype 驱动"。

**第二刀 — 让推演阶段真的选 archetype**

当前 LLM 生成五系统模型时大概率没有"这应用该是什么形态"这一步,所以永远默认后台。需要在 `slide-rule-python/services/v5_llm_generate.py` / 页面 Skill 的 prompt 里,先让模型**基于意图判定 archetype**(法律助手→management、暑假计划→mobile、流程工具→canvas),再往下生成。这一步过 gate(archetype 必须在合法枚举内)。

**第三刀 — Shell 对应的渲染器**

`AppRuntimeScreen.tsx` 当前只渲染一种外壳,需按 archetype 分渲染器。移动端壳、画布壳是新的,工作量在这里。可先做 `mobile` + `analytics` 两种把差异拉开,其余留 backlog。

## 与上游参考的关系

上一轮讨论的 json-render(扁平 Spec / Catalog 派生)、A2UI(增量协议)、tweakcn(designRecipe)都属于**下游工程**——等形态多起来、组件种类爆炸时才需要。**当前卡点不在那,在"顶层只有一个模子"。** 先补 archetype + Shell,再谈下游。

## 相关文档

- 北极星:`docs/NORTH_STAR.md`(黄金路径、决策清单)
- 能力池:`docs/SlideRuleV5CapabilityPool.md`
- 长期记忆:`~/.claude/.../memory/sliderule-single-archetype-gap.md`(AI 跨会话自动读取)

