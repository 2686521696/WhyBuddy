# 阶段④ · amis 批量灌区块：量完之后的结论

2026-08-08。执行顺序里阶段④写的是「灌第二类：amis 的 290+」，前提是
「135 个页面例子 + 157 篇组件文档」能批量变成区块。

**动手前先把供给量了一遍，前提不成立。**这篇记录量到了什么、因此改做了什么。

---

## 一、量出来的数（`/home/user/oss-blocks/amis`，本地 clone）

统计口径：`docs/zh-CN/components/**/*.md` 里所有 `"type": "xxx"` 出现。
组件文档正文就是一段段可运行的 schema，这是 amis 真正的语料。

| 指标 | 数 |
|---|---|
| 组件文档 | **157** 篇（其中 `form/` 目录 **72** 篇） |
| 不同 `type` 词汇 | **190** 种 |
| 含页面级组件（crud/table/chart/cards/list）的文档 | **28** 篇 |
| `input-*` 表单控件 | **37** 种 |

出现频次（前 20）：

```
form 918   button 545   input-text 455   page 299   tpl 244
service 179   select 175   crud 115   divider 114   text 78
table2 76    static 62    table 61    action 55    input-number 52
input-table 52   avatar 51   icon 45   combo 42   container 41
```

**这就是结论所在**：语料的重心压在 `form` / `button` / `input-text` /
`tpl` / `divider` 这一层——**字段和零件**。真正页面级的
`crud`(115) + `table`(61) + `table2`(76) + `cards`(12) + `list`(17) 加起来
不到 `form` 一项的三分之一，而且它们绝大多数是同一个 CRUD 反复演示不同参数
（分页方式、列类型、工具栏位置），不是 200 个**不同形状的区块**。

对照我们的三层：

```
基础组件 ──► 区块 ──► 模板
   ▲          ▲
   │          └── 目标 200 个；amis 这边真正能对上的形状 < 20
   └── 目标 300~500；amis 这边有 190 种词汇、37 种表单控件
```

**amis 的供给在基础组件/表单控件那一层，不在区块那一层。**
指望它产出 200 个区块，是把"文档篇数"当成了"区块个数"。

---

## 二、映射表：amis 词汇 → 我们这边

按层分。**状态列只有三种**：已有 / 可接（零件在，线没接）/ 不适用。

### 页面与容器（→ 我们的页面范式与区域，不是组件）

| amis | 我们这边 | 状态 |
|---|---|---|
| `page` | 页面范式（list/dashboard/detail/form/…） | 已有 |
| `form` | RecordForm / RecordFormDialog / StepsForm | 已有 |
| `crud` | DataTable + FilterBar + BatchActionBar 的组合 | 已有 |
| `service` | 运行时数据层（state.entities） | 已有 |
| `container` `wrapper` `hbox` `flex` `grid` | 区域 + band 布局 | 已有 |
| `tabs` `collapse` | 区域 tabs / 折叠 | 部分 |
| `wizard` | pageKind = wizard | 已有 |
| `dialog` `drawer` | pagePipes（openCreate / openRecord） | 已有 |

### 区块级

| amis | 我们这边 | 状态 |
|---|---|---|
| `table` `table2` | DataTable | 已有 |
| `crud` toolbar | BatchActionBar / ColumnSettingPanel | 已有 |
| `cards` | 卡片列表 | 已有 |
| `list` | RankedList | 已有 |
| `chart` | TrendChart / ProportionPie | 已有 |
| `timeline` | ActivityFeed / WorkflowTimeline | 已有 |
| `nav` | 应用壳的菜单 | 已有 |
| `search-box` | SearchBox | 已有 |
| `input-table` `combo` | EditableSubTable | 已有 |
| `condition-builder` | — | **不适用**（我们的筛选是声明式 targets，不做自由条件树） |
| `office-viewer` `qr-code` `signature` | — | 不适用（业务系统里是长尾） |

### 基础组件级

`button` / `tag` / `avatar` / `icon` / `image` / `images` / `progress` /
`alert` / `divider` / `card` / `spinner` / `tooltip` / `dropdown-button` /
`status` / `mapping` —— **全部已有对应**（antd 现成件，见
`base-components/base-catalog.tsx` 的 67 个桌面档基础组件）。

### 表单控件级 —— **这一层是真缺口，也是这一轮真正兑现的地方**

amis 有 37 种 `input-*`。我们这边**判定档位**在
`live-runtime/field-value-type.ts`，是全站单一判定表。

| amis | 我们的档位 | 零件 | 阶段④前 | 现在 |
|---|---|---|---|---|
| `input-text` | text | ProFormText | ✅ | ✅ |
| `textarea` | textarea | ProFormTextArea | ✅ | ✅ |
| `input-number` | digit | ProFormDigit | ✅ | ✅ |
| `select` | select | ProFormSelect | ✅ | ✅ |
| `input-date` | date | ProFormDatePicker | ✅ | ✅ |
| `input-datetime` | dateTime | ProFormDateTimePicker | ❌ 文本框 | ✅ |
| `input-password` | password | ProFormText.Password | ❌ 文本框 | ✅ |
| `input-rating` | rate | ProFormRate | ❌ 数字框 | ✅ |
| `input-range` | progress | ProFormSlider | ❌ 数字框 | ✅ |
| （金额） | money | ProFormMoney | ❌ 数字框 | ✅ |
| （百分比） | percent | ProFormDigit + % | ❌ 数字框 | ✅ |
| （评分） | score | ProFormDigit + 分 | ❌ 数字框 | ✅ |
| `switch` `checkbox` | switch | ProFormSwitch | ❌ 文本框 | ✅ |
| `button-group-select` | segmented | ProFormSegmented | ❌ 一律下拉 | ✅ |
| `radios` | radio | ProFormRadio.Group | ❌ 一律下拉 | ✅ |
| `input-tag` | tags | ProFormSelect mode=tags | ❌ 文本框 | ✅ |
| `picker` / 关联选择 | ref | ProFormSelect（候选=另一张表的行） | ❌ 手打行 id | ✅ |
| `input-image` `input-file` | — | ProFormUploadButton | ❌ | **待办**（缺附件存储，见下） |
| `input-color` | — | ProFormColorPicker | ❌ | 待办（业务系统里低频） |
| `input-verification-code` | — | ProFormCaptcha | ❌ | 不适用（生成的是内部系统，不做短信验证） |
| `input-tree` `tree-select` `transfer` | — | ProFormTreeSelect | ❌ | 待办（要先有层级实体声明） |
| `input-formula` `input-excel` `input-kv` … | — | — | ❌ | 不适用 |

---

## 三、所以阶段④实际做了什么

不是"把 amis 灌进来"，是**把 amis 照出来的那根断线接上**。

### 发现

`field-value-type.ts` 早就是全站的单一判定表，文件头写着它存在的理由——
「不会出现读的时候是进度条、写的时候是裸数字框」。读侧（`FieldValue`）、
内置表单（`FieldEditor`）、手机档（`PhoneFormField`）三处共读它。

**区块的表单族是第四处，而且自己写了一套更差的**：

```
枚举      一律 Select（2 个取值也要点开才知道有什么）
boolean   掉进兜底 → 文本框（要用户手打 true/false）
ref       掉进兜底 → 文本框（要用户手打一个行 id）
datetime  掉进兜底 → 文本框
format    压根不读 → 金额/评分/进度全是裸数字框
```

零件一个都不缺：`ProFormRate` / `ProFormSlider` / `ProFormSwitch` /
`ProFormSegmented` / `ProFormMoney` 全在 `@ant-design/pro-components` 里，
**装着没用过**。声明也一个都不缺：`five_system_legal.json` 早就有
`numberFormats` / `stringFormats`，运行时 schema 早就带着 `format` 和
`refEntityId`。**中间那根线没接。**

### 改动

1. `formItemFor` 改成读 `resolveValueType`，自己一行判断都不留。
   控件档位 **5 种 → 17 种**。
2. 渲染器契约上开一扇门 `fieldSchemaOf`（字段声明整个传下去），**替代**
   本来要加的 `fieldFormatOf`。理由在契约注释里：本来已经有
   `fieldLabelOf` / `fieldTypeOf` / `enumOptionsOf` 三个查询从同一个对象上
   摘东西，加 `format` 是第四个，加 `refEntityId` 是第五个——这正是②阶段
   复盘钉下来的形状，**"加一样东西要改几处"才是要找的东西**。
3. 两个宿主（真实运行时 + 装配预览）各开这扇门，归一化在宿主做
   （坏声明不进渲染器）。
4. 护栏：`block-props-wiring.test.ts` 加一组，其中一条**从判定表的类型
   定义里读档位清单**——那边加一档，这里自动要求有零件接着。
5. 接线台加第四页（`order_form`），一屏摆齐三条路：格式分档、枚举三档、
   ref 下拉。

### 浏览器实测（`/runtime-wiring.html` → 新建订单（格式））

```
✓ 金额 money       → ¥ 1,234,567（千分位）
✓ 周涨幅 percent    → 数字框 + % 后缀
✓ 履约完成度 progress → 滑杆
✓ 健康分 score      → 数字框 + 分后缀
✓ 服务星级 rating    → 星星
✓ 联系电话 masked    → 密码框
✓ 状态 3 个取值     → Segmented
✓ 渠道 5 个取值     → Radio.Group
✓ 大区 8 个取值     → Select
✓ 关联母单 ref      → 下拉，候选是订单表的真实行
✓ 下单日期 date     → 日期选择器
✓ 门店（无 format） → 普通文本框
```

---

## 四、阶段④剩下的、和不做的

**剩下的**（都在表单控件层，不在区块层）：

- `input-image` / `input-file` → `ProFormUploadButton`。卡在**没有附件存储**：
  运行时状态整份 `JSON.stringify` 进 localStorage，塞不下文件。要先决定
  附件放哪，这是产品决策不是接线。
- `tree-select` / `transfer` → 要先有**层级实体**的声明（现在数据模型是平的），
  同样是先改契约再接线。
- `input-color` → 零件有（`ProFormColorPicker`），只是业务系统里低频，
  等真的有字段需要再说。

**不做的**：`condition-builder`（我们的筛选是声明式 targets，不做自由条件
树）、`input-formula`、`input-excel`、`office-viewer`、`input-verification-code`
—— 都不在"生成内部业务系统"这个靶子上。

**执行顺序那张图要改的一条**：

```
原： ② 搬 60~80 ──► ③ 注册表+渲染器 ──► ④ 灌 amis 290+
改： ② 搬 60~80 ──► ③ 注册表+渲染器 ──► ④ 已改道（见本文）
                                          └─► 区块要到 200，供给得另找
```

区块要到 200 个，amis 供不出来。真正的区块供给还是②那条路——
NocoBase / ant-design-pro / refine 的真实页面形状，一个一个搬。
amis 的价值在**基础组件与表单控件的词汇表**：它把"一个字段该用哪个控件"
做成了声明，这一点我们抄对了。
