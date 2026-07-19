# SlideRule 应用形态差距分析(2026-07-19,含两轮审查修正)

> **修订说明**:初版把"现有能力"判断偏低(只读数据层 `app-runtime-schema.ts`,
> 没读渲染层 `AppRuntimeScreen.tsx`),并给出"4~5 种应用类型枚举"的错误方案。
> 第二轮审查进一步指出:方案缺"区块实例 + 数据绑定 + 动作协议"这一层——
> 只补首页与布局,结果只会从"同一个固定工作台"进化成"不同排列的统计卡/图表/榜单/表格",
> 仍到不了素材里的任务工作区、排期工具、专业编辑器。本版据两轮审查重写:
> **核心诊断(硬编码首页)保留**,现有能力据实更正,破法补齐"区块目录 + 动作协议"层,
> 并明确阶段边界。

## 一句话结论(两轮修正后)

SlideRule **已能做页面级形态多样**(3 套外壳 + 6 种页面范式),但**所有页面仍被塞进同一个硬编码的"工作台"首页**;更深一层的缺口是**没有"区块实例 + 数据绑定 + 动作"的可执行协议**——设计菜谱能在 prompt 里建议"好首页长什么样",但除 `appIdentity.nav` 和 `page.kind` 外,首页选择、区块组合、专业组件与交互动作**没有规范字段承接**,因此 Gate 无法校验、渲染器不知道渲染什么。千人一面最直接的元凶是**写死的首页**;要长成素材里的完整应用,还须补上区块与动作协议层。

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

### 3. 设计菜谱只有一部分能落库(关键诊断)

项目已把 37 张视觉稿蒸馏成设计菜谱(`v5_design_reference.py` + `data/design_recipes.json`),向生成 prompt 注入 `navStyle / homeArchetype / widgets / accentHint / namingStyle`。

**准确表述**:`appIdentity.nav` 和 `page.kind` 已经能落库,但设计菜谱中的**首页选择、区块组合、布局结构和部分专业组件建议,没有完整的规范字段承接**。即 Prompt 已告诉模型"好首页长什么样",Schema 却只接得住其中一部分——问题不在 LLM 没有形态意识,在承接形态的字段不全。

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

## 缺失的一层:区块实例 + 数据绑定 + 动作(第二轮审查核心)

初版破法有"体验计划"和"布局组合",但缺"有什么区块"和"能做什么"两环。问题出在 `composition` 只写名字:

```json
"composition": { "primary": ["risk_trend"] }
```

`risk_trend` 在哪定义?若只是名字,**Gate 无法校验、渲染器不知渲染什么、修复器不知坏在哪**——违反项目"合法域单一真相源 + 二元闸"纪律。必须把"区块实例(有什么)"与"布局(摆哪)"拆成两件事:

```json
{
  "id": "risk_overview",
  "kind": "monitor",
  "blocks": [
    {
      "id": "risk_metrics",
      "type": "MetricGrid",
      "binding": { "metrics": ["risk.total", "risk.high"] },
      "actions": ["openDetail"]
    },
    {
      "id": "risk_trend",
      "type": "MultiSeriesTrend",
      "binding": {
        "dimension": "event.createdAt",
        "series": ["positive", "neutral", "negative"]
      },
      "actions": ["drillDown", "changeFilter"]
    }
  ],
  "layout": {
    "summary": ["risk_metrics"],
    "primary": ["risk_trend"]
  }
}
```

**完整关系链(本版据此定型)**:

```text
用户指令
  → 五系统业务模型
  → 体验计划(首页、Shell、页面)
  → 区块实例(有什么)         ← 初版缺
  → 布局组合(摆在哪里)
  → 数据/权限/动作(能做什么)  ← 初版缺
  → 渲染器
```

素材里的差距大量来自**交互而非静态布局**:没有动作协议,CRM 快捷入口、图表钻取、预警处理、日历排期都是假按钮。

## 破法(重排:先拆首页,再补区块+动作,再动态构图,不建固定类型)

### 第一刀:让模型指定落地页(`landingPageRef`)

在五系统模型 `appbundle` 增加 `landingPageRef`(不叫 `homePageRef`——语义更清楚,以后可能有角色化落地页):

```json
{ "landingPageRef": "insight_overview" }
```

运行时:有 → 直接把该页作为落地页(复用现有 monitor/dashboard/ranking/feed/stats/charts);没有 → 保持当前硬编码工作台作老模型降级。**Gate 至少检查**:引用页面必须存在;默认角色必须有权访问;修复失败回退旧工作台;不在菜单中重复生成一个额外"首页";被引用页删除/改名时触发失效修复。

### 第二刀:Experience Block Catalog + 动作协议(同一刀两面)

**命名注意**:不要叫 `Capability Catalog`——`capability` 在 SlideRule 已专指推演能力(`(capability, role)` 对、`V5CapabilityId`),复用会混淆。叫 **`Experience Block Catalog`(体验区块目录)**。

**不另建 Zod 真相源**。项目已有 Python/JSON 合法域 + Gate + Repair + Prompt + 前端同步机制,应扩展现有真相源(参考 json-render 的 Catalog 派生方式,但不要在 TS 再造一个和 Python Gate 竞争的合法域)。每种区块至少描述:

```json
{
  "type": "RiskAlertStream",
  "propsSchema": {},
  "bindingSchema": {},
  "allowedSlots": ["activity", "secondary"],
  "actions": ["openDetail", "acknowledge"],
  "permissionSlots": [],
  "workflowSlots": [],
  "repairHints": {},
  "rendererRef": "RiskAlertStream"
}
```

**动作协议**与区块目录绑在一起做(每个区块声明自己的 `actions`)。第一批不铺大,先支持:`navigate` / `openDetail` / `createRecord` / `updateRecord` / `startWorkflow` / `runAIGC` / `changeFilter` / `drillDown` / `reschedule`。这样 CRM 快捷入口、图表钻取、预警处理、日历排期才不是假按钮。

### 第三刀:页面级布局组合(`layout`,只管摆放)

`layout` 只负责:区块放哪个槽位、区块顺序、跨列与宽度、桌面/平板/手机的响应式排列。**它不定义区块本身**(区块由第二刀的 Block Catalog 实例声明)。模型仍按用户指令动态选材;`layout` 不判"这是什么系统"。

### 第四刀:应用 Shell 与设备分开(两根独立轴)

```json
{ "experienceShell": "navigation | focus" }
{ "preferredDevice": "desktop", "responsiveLayout": { "phone": {} } }
```

- `experienceShell` 先只限 `navigation | focus`。**`canvas` 暂不进枚举**——没有画布协议时它只是空壳。
- **迁移**:必须处理现有 `appIdentity.nav` 的关系——不能让 `identity.nav` 和 `experienceShell` 同时决定导航(双真相源)。定一个权威、另一个派生或废弃。
- 用 `preferredDevice` + `responsiveLayout` 而非 `supportedDevices`:当前运行时本就能手动切 phone 预览,"支持手机"不等于"手机设计得好"(现 `phoneShell` 主要是把同一页压成卡片)。

### 落地顺序

1. `landingPageRef`:拆掉强制工作台
2. `Experience Block Catalog` + 动作协议:让"有什么"和"能做什么"进合法域、过 Gate
3. 页面级 `layout`:模型动态选材构图
4. `experienceShell`(navigation/focus)+ `appIdentity.nav` 迁移
5. `preferredDevice` + `responsiveLayout`:复用现有手机壳
6. `designRecipe`(主题配方,见下节)
7. canvas / IDE:等相应业务协议成熟再做

**不要先建"4~5 种应用类型",也不要先换颜色。**

## 主题配方不能永久 backlog

先做布局与区块、不先换颜色是对的;但若目标是素材完成度,`designRecipe` 不能长期缺席。素材之间除布局外,还有明显的:页面密度、卡片层次、字体尺度、圆角阴影、图表配色、暗色工作区、侧栏与内容区对比。所以它排在动作协议与响应式之后、专业画布之前——**不是现在做,但也不能宣称前三刀做完就达到素材效果**。

## 能达到素材什么程度(阶段边界)

| 素材类型 | 本方案做完的程度 | 仍缺什么 |
|---|---|---|
| 收入经营大盘 | 帮助很大 | 时间筛选、多序列趋势、目标环、同比环比、钻取 |
| CRM 工作台 | 帮助较大 | 今日任务、快捷业务动作、客户卡片、角色化首页 |
| 舆情监控 | 帮助较大 | 词云、渠道矩阵、多序列图、风险预警动作 |
| 内容排期 | 布局可近,交互靠动作协议(`reschedule`) | 拖拽排期、冲突检测、时间槽、右侧属性面板 |
| PRD Agent | focus 外壳 + `runAIGC`/结构化卡可近 | 对话澄清、过程状态、事件链 |
| 低代码/流程画布/IDE | **通用 Schema 拼不出** | 画布协议、拖拽、选中态、属性面板、撤销重做 |

**边界画在"画布类专业编辑器"**:大盘/CRM/舆情/常规日历第一阶段可明显接近;排期/PRD 靠动作协议能再进一步;低代码设计器、流程画布、IDE 属专业编辑器,需专门的画布/编辑协议,不能靠通用页面 Schema 拼出。这不是模型智力问题,是运行时缺可执行协议。

## 发布门(修正:当前不成立,需先补)

`scripts/verify-sliderule-v5.sh` 当前**没有**运行 `app-runtime-schema.test.ts`,浏览器冒烟只测推演主路径,不检查生成应用的首页/Shell/页面范式。

> 正确要求:**每刀必须先把对应单测 + 生成应用浏览器验收加入 `verify:sliderule-v5`**,再做功能(符合北极星决策清单第 4 条)。

## 开源参照(三刀分别抄谁)

**关键结论**:在本次审查的项目中,未发现直接覆盖"业务模型 → 体验规划 → 可执行应用"完整链路的现成实现(SDUI/低代码多默认单一后台形态)。各刀抄成熟机制,"动态选材构图 + 选材可信"这层是 SlideRule 差异化。

| 刀 | 抄什么 | 项目 | 许可/活跃 |
|---|---|---|---|
| 第二刀 Experience Block Catalog 派生方式 | `defineCatalog` 单一真相源 + enum 派生(prompt/validate/schema 同源);**但派生进现有 Python 合法域,勿在 TS 另造** | `vercel-labs/json-render` | MIT · 活跃 ★★★★★ |
| 第二刀 选材约束 gate | 结构化输出约束到枚举 + devtools 的 Pick/Catalog/Stream 面板 | `vercel-labs/json-render` | MIT · 活跃 ★★★★★ |
| 第三刀 分渲染器(区块级) | 按 type 的渲染器注册思路 + 诚实降级 | **Grafana** panel plugin(仅参考"区块注册",非应用 Shell 类比) | AGPL(只读思路)★★★☆☆ |
| 第三刀 跨端(以后) | 一份 spec → 多渲染器、增量更新、给 agent 而非给人 | `google/A2UI`(> DivKit) | Apache-2.0 · v0.8 只抄思想 ★★★★☆ |
| 第四刀 换皮(backlog) | designRecipeRef:token/圆角/阴影/字体配方引用 + registry 分发 | tweakcn / shadcn GitHub Registries | tweakcn Apache-2.0 · 现在别碰 ★★★☆☆ |

**许可证订正(2026-07-19 复核)**:A2UI 是 **Apache-2.0**(非早期误记);tweakcn 是 **Apache-2.0**(不是项目注释里写的 MIT)。json-render 仍为 MIT。

**能力边界提醒**:json-render 能保证"只输出合法枚举",但**不能判断模型是否为用户选对了形态**——第二刀的"正确选材"仍需 SlideRule 自己的 prompt、证据、评测和决策留痕。

## 相关文档

- 北极星:`docs/NORTH_STAR.md`(黄金路径、决策清单)
- 能力池:`docs/SlideRuleV5CapabilityPool.md`(注意:`capability` 已专指推演能力,区块目录勿复用此词)

## 关键代码位置(引用函数/类型名,行号会随改动失效)

- 数据层写死首页:`app-runtime-schema.ts` → `deriveAppRuntimeSchema()`(`home` 段)、`AppHomeSchema` 类型
- 渲染层写死首页 + 三套 Shell + 六种范式:`AppRuntimeScreen.tsx` → `homeContent` / `desktopShell` / `topShell` / `phoneShell` / `defaultPageContent`(内按 `page.view.kind` 分支)
- 五系统模型 Schema(需加 `landingPageRef` / `blocks` / `layout` / `experienceShell` 字段):`system-screens/five-system-model.ts`
- 设计菜谱注入(部分内容无字段承接):`v5_design_reference.py` → `design_reference_block()`
- 发布门(需加生成应用验收):`scripts/verify-sliderule-v5.sh`
- 若代码注释仍写 "tweakcn MIT",应一并改为 Apache-2.0
