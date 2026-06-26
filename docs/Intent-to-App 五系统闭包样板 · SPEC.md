# 里程碑 SPEC · Intent-to-App 五系统闭包样板

> 产品定位：**意图到应用的数字孪生推演平台**——用户说"我要一个 XX 平台"，SlideRule 推演出一个
> 可校验的企业应用元模型世界（RBAC / Workflow / DataModel / Page / AppBundle 五系统闭包），
> 输出 SPEC + 多张关联图谱 + gate 校验报告，再交 AgentLoop 物化为真实项目改动。
>
> 本里程碑只打穿**推演深度**，不追求"直接跑起来的 SaaS"。

---

## 1. 目标与非目标

**目标**：证明"一句话 → 五系统可校验闭包"对**任意业务**成立（用「采购审批平台」作非请假样例打穿）。

**非目标（第一阶段明确不做）**：
- 不生成可运行前端/后端代码。
- 不落 MySQL/Redis/真实服务。
- 不接 rbac 重平台运行时。
- 这些都是"物化问题"，留给后续里程碑与 AgentLoop。

---

## 2. 当前底座（已 grounded · 不重复造）

| 已有 | 状态 |
|---|---|
| 5 个 Skill：datamodel / rbac / workflow / page / appbundle | ✅ 存在且全部注册进 `slideRule` |
| 每个 Skill：`validate()`(gate) / `project()`(图) / `resolve()`(引用面) / `crossRefs` | ✅ |
| Orchestrator：`assemble()` 统一 SPEC + 总关联图 + 汇总 gate | ✅ |
| `impact()` 跨系统影响分析、`publishGate()` 闭包校验门禁 | ✅ |
| DataModel SSOT 字段身份（fieldId/version/lifecycle/storageRole/namespace） | ✅ |
| Page V2 bindingSchema / permissionRender | ✅ |
| **`generate()` 接 LLM、能推演任意意图** | ❌ **仅"请假"桩，别的 throw** ← 本里程碑的核心缺口 |
| **非请假业务的五系统样板** | ❌ 通用性未证明 |
| **完整 SPEC 产物输出（5 SPEC + 5 图 + gate 报告）** | ❌ 未成形 |

**结论：管道全通，缺的是"通用性证明 + generate + SPEC 渲染"。**

---

## 3. 验收标准（可度量）

输入：`"我要一个采购审批平台"`（非请假业务）。输出与判定：

1. **五个 Skill 模型全部产出**（RBAC / DataModel / Workflow / Page / AppBundle）。
2. `validate()` **全部通过**，0 error。
3. 总关联图**无 ghost 节点**（所有跨系统引用解析到真实节点）。
4. `publishGate()` 返回 `publishable=true`；**故意打断一处引用时能精确报出断裂**（`PUBLISH_DANGLING_CROSSREF`）。
5. `impact()` 能回答"删掉 `finance` 角色/`purchase_request.amount` 字段，受影响哪些页面与流程"。
6. 输出一份**中文 SPEC 文档** + 下列图谱（mermaid，从模型自动投影）。
7. AgentLoop 能把 AppBundle SPEC **拆成工程 tasks**（schema/RBAC配置/工作流JSON/页面配置/注册配置/测试）。
8. 全程 **tsc 0 错、测试绿**。

---

## 4. 设计 · 采购审批的五系统模型（确定性样板）

> 先手工建为 fixture（不靠 LLM），证明元模型通用；再让 generate 产出同形。

- **RBAC**：角色 `applicant 申请人 / dept_manager 部门主管 / buyer 采购专员 / finance 财务 / admin 管理员`；
  权限 `purchase:create / purchase:approve_dept / purchase:review_buy / purchase:approve_finance / purchase:view`；
  菜单/按钮挂权限；数据规则：申请人只看自己、主管看本部门、财务可见金额字段。
- **DataModel**：实体 `purchase_request(采购申请单) / vendor(供应商) / material(物料) / budget_account(预算科目)`；
  字段含 `purchase_request.amount(金额) / .vendorId(ref→vendor) / .deptId / .status`；带 SSOT 字段身份。
- **Workflow**：`提交 → 部门主管审批(@dept_manager) → 采购复核(@buyer) → 财务审批(@finance) → 完成`；
  分支按 `purchase_request.amount`（如 >5万 加签管理员）；可达、可终止、分支有默认。
- **Page**：`采购申请页 / 待审批页 / 供应商选择页 / 申请单详情页`；
  组件 `bindingSchema` 绑 `purchase_request.*` 字段；`permissionRender` 按角色控可见（金额字段仅 finance/admin）。
- **AppBundle**：把上面捆成「采购审批应用」——菜单入口、页面↔流程绑定、数据模型引用、角色绑定、版本钉选。

**跨系统闭包要校验的真问题**（= 深度）：
工作流的 `finance` 角色存在吗？页面绑的 `purchase_request.amount` 存在吗？菜单指向的页面存在吗？
按钮引用的权限存在吗？AppBundle 引用的流程存在吗？删字段会塌哪些页面/流程？

---

## 5. 输出物（10 项）

1. RBAC SPEC　2. DataModel SPEC　3. Workflow SPEC　4. Page SPEC　5. AppBundle SPEC
6. 总 Mermaid 架构图　7. 角色-用户-权限关系图　8. 数据字段-页面组件绑定图
9. 工作流-角色-字段引用图　10. publishGate 校验报告

---

## 6. 任务拆分（交 AgentLoop）

| # | 任务 | 验收 |
|---|---|---|
| **T1** | 手工建「采购审批」五系统 fixture（确定性，不靠 LLM） | 5 模型；`validate()` 全绿；无 ghost；`publishGate` 通过；打断引用能报错 |
| **T2** | `orchestrator.renderApplicationSpec()`：从模型自动吐 10 项产物（中文 SPEC + 5 图 + gate 报告） | 一函数产出全部 10 项；图无 ghost |
| **T3** | `generate()` 接主项目 LLM：让"一句话采购审批"推演出 T1 同形，gate 兜底 | LLM 产出经 gate 后等价 T1；失败由 gate 拦截而非静默 |
| **T4** | AgentLoop 消费 AppBundle SPEC → 拆工程 tasks（schema/RBAC/工作流JSON/页面/注册/测试） | 生成可执行 task 队列 |
| T5（后续里程碑） | 物化到 rbac 重平台 / 真实落库 | —— |

**关键顺序**：T1（手工证通用）→ T2（吐 SPEC）→ T3（接 LLM）→ T4（拆 task）。**先证明、后接 LLM、再拆活。**

---

## 7. 主线判据

后续每个任务都用这一句判断：**"它能不能让『一句话生成一个可校验的企业应用数字孪生』更进一步？"** 能就做，不能就放后面。
