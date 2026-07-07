# 活系统蓝图 v3：浏览器运行时——六系统像 ECharts 一样"渲染"出来

> 状态：方案定稿（v3，浏览器运行时），M0 施工中。
> 用户定调（2026-07-08）：**"我不想用数据库就会太重，能不能像 ECharts 这样，渲染出来的，
> 只是这些系统就会大一些。"**
> v1（五前端 iframe）、v2（后端引擎 + MySQL）被本版取代；两份 zip 的摸底结论
> （数据契约、执行语义）作为**参考实现**继续指导本版设计，见 git 历史与文末附录。

## 一、心智模型

```
ECharts:            echarts.setOption(optionJSON)   → 一张可交互的图
SlideRule Runtime:  runtime.mount(五系统模型 JSON)   → 一套可操作的企业应用
```

- **零数据库、零新进程**：运行时状态（实体行、流程实例、审批日志）就是内存里的 JSON，
  持久化 = 挂进现有会话存档（python 会话 JSON / localStorage），刷新可恢复。
- **系统 = 渲染器 + 极小执行内核**：执行语义（审批状态机、动态表 CRUD、字段权限）
  用纯 TS 实现——参考后端引擎已验证的语义（workflowEngine 状态机、schemaManager 动态表），
  但不背它的 MySQL/Express。
- **加功能 = 改 JSON**：运行时只认模型，模型是唯一事实源。导出格式一字不变。

## 二、运行时内核（纯 TS，`client/src/pages/sliderule/live-runtime/`）

| 模块 | 职责 | 语义参考（backend zip 已验证） |
|---|---|---|
| `live-runtime.ts` | RuntimeState：`entities[entityId].rows[]`、`instances[]`、日志；initRuntimeState(model) | schemaManager 动态表 → 内存行数组 |
| 同上 | 行 CRUD：类型感知（string/number/date/enum/ref），必填校验 | dynamicDataService + validation |
| 同上 | **审批状态机**：startInstance / advance(approve\|reject)；沿 transitions 推进，分支时给选择；assigneeRole 记账；terminal completed/rejected | workflowEngine.moveToNextNode |
| `runtime-persistence.ts` | 会话级持久化（localStorage v0 → python 会话字段 v1） | — |

不追求的（诚实边界）：会签/或签百分比、子流程、自动节点 HTTP 调用、行级 SQL 权限
——排练运行时不需要企业级完备，需要"业务闭环可走通"。

## 三、六系统的"试运行"面（右栏各屏新增模式）

每个系统屏加「示意 ⟷ 试运行」切换，试运行面直连运行时内核：

| 屏 | 试运行能力 | 阶段 |
|---|---|---|
| Workflow | 发起实例 → 按当前节点的 assigneeRole 通过/驳回 → 分支选择 → 完成/驳回终态 + 全程日志 | **M0** |
| DataModel | 每实体一张可编辑表格：按字段类型生成表单，增删改行 | **M0/M1** |
| Page | fieldBindings 渲染成真表单，提交 = 写实体行（可选联动发起流程实例）| M1 |
| RBAC | 「以角色预览」：切换角色看菜单/字段可见性变化 | M2 |
| AIGC | 能力卡"试跑一次"（复用现有 LLM 通道，输入字段→输出字段）| M2 |
| AppBundle | 装配运行：菜单→页面→表单→流程 全链路走一遍（打通面）| M2 |

**全打通的验收剧本（北极星场景）**：
健身房话题闭环 → Page 试运行填一张「会员卡核销单」→ 数据进实体表 →
自动发起审批实例 → 切到 Workflow 以 `manager` 角色点「通过」→
DataModel 表格里那行状态变更 → 导出交付包，格式与今天逐字节同构。

## 四、分阶段

- **M0（施工中）**：运行时内核（状态机 + 行 CRUD，纯函数 + 单测）+ Workflow 屏试运行面
  （发起/通过/驳回/分支/日志）+ localStorage 持久化。
- **M1**：DataModel 可编辑表格 + Page 真表单提交 + 提交联动流程。
- **M2**：RBAC 角色预览、AIGC 试跑、AppBundle 装配运行（全链路）。
- **M3**：运行时数据快照作为附件进交付包（格式主体不变）。

## 五、两份 zip 的定位（参考实现，不进运行链路）

- `backend.zip`（rbac-backend）：执行语义的**权威参考**——审批状态机推进规则、
  动态表类型映射、应用版本快照结构。本版的 TS 内核按它的语义写，行为对得上，
  未来若要"长成真系统"（v2 路线）随时可接回。
- `web.zip`（五前端）：交互形态参考（X6 设计器、antd 表格/表单范式）。
  需要专业编辑体验时可按 v1 方案单独嵌一个，不常驻。
