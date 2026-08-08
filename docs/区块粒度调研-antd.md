# 区块该做多细？—— Ant Design 官方怎么拆的

2026-08-08。用户定下三层链路之后的问题：基础组件有了（139 个），但**组装的时候
哪些该组装成什么**没有依据。于是去 GitHub 看用 antd 做得好的项目怎么拆。

结论先说：**Ant Design 官方自己就是按这三层拆的**，而且第二层官方就叫「区块」。

---

## 一、`ant-design/pro-blocks` —— 官方的「区块」库

29 个，`umi-block.json` 是它的清单。但**它们是整页的**：

| 分类 | 条目 |
|---|---|
| dashboard | 分析页 / 监控页 / 工作台 |
| 列表 | 标准列表 / 卡片列表 / 搜索列表（应用·文章·项目）/ 查询表格 |
| 详情 | 基础详情页 / 高级详情页 |
| 表单 | 基础表单 / 高级表单 / 分步表单 |
| 结果 | 成功页 / 失败页 |
| 异常 | 403 / 404 / 500 |
| 用户 | 注册页 / 注册结果页 |
| 账户 | 个人中心 / 个人设置 |
| 编辑器 | 流程 / 拓扑 / 脑图 |
| 其它 | 空白页 |

官方对「查询表格」的原话：**「一个标准的表格增删改查页面，可以派生出百分之
八十的后台页面。」**

**所以 antd 的「区块」= 我们的「模板」层，不是我们的「区块」层。**

### 它们是代码，不是数据

每个区块的结构：

```
ListTableList/
  src/index.tsx          ← 页面本体
  src/components/*.tsx   ← 区域级部件
  src/service.ts         ← 请求
  src/_mock.ts           ← 假数据
  src/data.d.ts          ← 类型
  snapshot.png
```

`umi block add` 做的是**把源码拷进你的项目**。是脚手架，不是运行时拼装。

这一条直接决定了我们「AI 组装区块」该产出什么：**契约，不是代码**。区块 =
schema + 逻辑 + 关联，逻辑就是代码，代码得人写。

---

## 二、真正对应我们「区块」层的，是每个页面里被抽出来的部件

这才是这次调研的正题。官方自己抽出来的（去掉三个图形编辑器）：

| 部件 | 出处 | 干什么 |
|---|---|---|
| **IntroduceRow** | DashboardAnalysis | 顶部四张指标卡那一排 |
| **ChartCard** | ↑ 的单元 | 五个槽：`title / action / total / children(迷你图) / footer` |
| **Trend** | ↑ | 环比涨跌（up/down + 文字） |
| **Field** | ↑ | 卡片脚注的 `label: value` |
| **SalesCard** | DashboardAnalysis | 带页签（销售额/访问量）+ 时间范围的图表卡 |
| **ProportionSales** | ↑ | 饼图 + 占比 |
| **TopSearch** | ↑ | 排行榜（表格式，带迷你趋势） |
| **OfflineData** | ↑ | 页签切换的多组数据 |
| **StandardFormRow** | ListSearch* | 一行筛选：左边标题，右边一堆控件 |
| **TagSelect** | ↑ | 标签式多选，超过一行可展开 |
| **ListToolBar** | pro-components | `title / subTitle / search / actions / settings / tabs / filter` |
| **Table Alert** | pro-components | 「已选择 N 项 · 清空 · 批量操作」 |
| **ColumnSetting** | pro-components | 列设置 |
| **EditableTable** | pro-components | 可编辑子表 |
| **QueryFilter** | pro-components | 查询表单，带收起/展开 |
| **LightFilter** | pro-components | 轻量筛选（药丸式下拉） |
| **StatisticCard / CheckCard** | pro-components | 指标卡 / 卡片式单选 |
| **AvatarList** | AccountCenter | 头像组 |
| **EditableLinkGroup** | DashboardWorkplace | 快捷链接组 |
| **OperationModal / CreateForm / UpdateForm** | 各列表页 | 弹层表单 |

`ChartCard` 的槽位契约值得单独看 —— 它就是一个标准的区块契约长什么样：

```ts
type ChartCardProps = {
  title: React.ReactNode;      // 指标名
  action?: React.ReactNode;    // 右上角（通常是「指标说明」的 ⓘ）
  total?: ReactNode | number | (() => ReactNode);  // 大数字
  footer?: React.ReactNode;    // 脚注（日销售额 ￥12,423）
  contentHeight?: number;      // 迷你图的高度
  children;                    // 迷你图 / 环比
}
```

---

## 三、对着我们现有的 15 个区块，缺口在哪

| antd 的部件 | 我们 | 差距 |
|---|---|---|
| IntroduceRow + ChartCard + Trend | `MetricGrid` | **缺环比、迷你图、脚注、右上角说明** |
| SalesCard | `TrendChart` | 缺页签切换、时间范围 |
| TopSearch | `RankedList` | 基本齐 |
| ProportionSales | — | **缺饼图/占比** |
| StandardFormRow + TagSelect | `FilterBar` | 我们是 Select 式；**缺标签式 + 可展开** |
| QueryFilter 的收起/展开 | `FilterBar` | 缺 |
| ListToolBar | `PageHeader` | **缺搜索框、缺状态页签** |
| Table Alert | — | **缺批量操作栏** |
| ColumnSetting | — | 缺列设置 |
| EditableTable | — | 缺可编辑子表 |
| ProDescriptions | `RecordDetail` | 基本齐 |
| ModalForm / DrawerForm | `RecordFormDialog` | 齐 |
| StepsForm | `StepsForm` | 齐 |
| EditableLinkGroup | `QuickActionPanel` | 齐 |
| Result 页 | — | **连页面范式都没有** |

用户那张门店订单管理参考图缺的，正好落在带 ✱ 的几条：**统计卡那一排（带环比）、
搜索框、状态页签、批量操作栏**。

---

## 四、这次调研改了什么

1. 确认了「AI 组装区块」产出**契约**而不是代码 —— 跟 antd 官方的分工一致。
   落成 `services/block_proposer.py` + `POST /components/propose-blocks`。
2. 区块粒度有了参照系：**区域大小**，带自己的绑定和逻辑。不是组件，也不是整页。
3. 上面那张缺口表就是接下来补区块的清单。

## 附：仓库

- `ant-design/pro-blocks` — 官方 29 个页面级区块，`umi-block.json` 是清单
- `ant-design/pro-components` — `src/{card,table,form,list,descriptions,layout}`，
  区域级部件都在各自的 `components/` 下
