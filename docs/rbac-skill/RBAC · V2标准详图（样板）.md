# RBAC · V2 标准详图（样板）

> 本系统在 V2 中**就是内核 ① PDP 的本体**——其它系统的权限判定全部委托到这里（入站）。
> V2 相对 V1 的关键改动：
> - **新增 角色继承**（P1-4）：装载器解析 User→Roles(含继承)→Permissions。
> - **新增 SoD 职责分离 + Fail-Closed**（◆ 补全）：设计期拦自授自审、运行期异常即 DENY。
> - **行/字段权限只在这里决策**：其它系统不再自带 `FIELD_FILTER/DATA_SCOPE`，改为调用本 PDP。
> - 数据权限里的「字段」引用数据中台 SSOT（P0-3）；角色变更进事件总线、决策证据进统一 Trace。

```mermaid
flowchart TB

subgraph CALLERS["调用方（其它系统委托 PDP·入站）"]
direction LR
  WF["工作流"]:::ext
  PAGE["页面设计器"]:::ext
  DATA["数据中台"]:::ext
  AIGC["AIGC"]:::ext
  APP["应用中心"]:::ext
end

subgraph CONTEXT["请求上下文"]
direction LR
  PRINCIPAL[("Principal<br/>user·tenant·roles")]:::state
  RESOURCE[("Resource<br/>route·model·record·field")]:::state
  ENV[("Environment<br/>ip·device·time·trace")]:::state
  DECISION_INPUT[("Decision Input")]:::state
end

subgraph POLICY["策略控制平面（实体定义）"]
direction LR
  TENANT["Tenant + Quota"]:::policy
  ROLE["Role + 角色继承（V2新增）"]:::policy
  USER_ROLE["UserRole"]:::policy
  PERMISSION["Permission resource+action"]:::policy
  ROLE_PERM["RolePermission"]:::policy
  MENU["Menu + RoleMenu"]:::policy
  ORG["Department / Position / Group"]:::policy
  DATA_SCOPE_DEF["DataScope all/dept/self/custom"]:::policy
  ROW_PERM["RowPermission role+entity+scope"]:::policy
  FIELD_PERM["FieldPermission hidden/readonly/mask"]:::policy
end

subgraph PDP["① PDP 单一决策点（本系统 = 内核 ①）"]
direction TB
  LOADER["权限装载器<br/>User→Roles(含继承)→Permissions"]:::core
  SOD{"SoD 职责分离（V2新增）<br/>禁止自授予·互斥权限·双人复核"}:::gate
  TENANT_MATCH{"租户匹配 Gate"}:::gate
  FUNC_GATE{"功能权限 Gate"}:::gate
  MODEL_GATE{"模型权限 Gate read/write"}:::gate
  ROW_FILTER["行级过滤器"]:::core
  FIELD_FILTER["字段过滤 / 脱敏"]:::core
  PRECEDENCE["决策优先级<br/>租户→身份→功能→模型→行→字段 · Deny 覆盖 Allow"]:::ledger
  FAIL_CLOSED{"Fail-Closed（V2新增）<br/>异常 / 缺上下文 → DENY"}:::gate
  DECISION[("授权决策<br/>ALLOW/DENY/FILTER/MASK<br/>reason·policyVersion·traceId")]:::state
end

subgraph LIFECYCLE["策略生命周期（V2 补全 · 内核 ③联动）"]
direction LR
  DRAFT["Draft"]:::ledger
  REVIEW{"Review Gate 高风险审批"}:::gate
  VERSION["Policy Version 回滚点"]:::ledger
  EFFECTIVE["Effective 生效版本"]:::done
end

KERNEL_SSOT[("② 数据模型 SSOT（外部）")]:::kernel
KERNEL_BUS["③ 平台事件总线（外部）"]:::kernel
KERNEL_DEP["④ 全局失效引擎（外部）"]:::kernel
KERNEL_TRACE["⑤ 统一 Trace（外部）"]:::kernel

WF -.鉴权请求.-> DECISION_INPUT
PAGE -.鉴权请求.-> DECISION_INPUT
DATA -.鉴权请求.-> DECISION_INPUT
AIGC -.鉴权请求.-> DECISION_INPUT
APP -.鉴权请求.-> DECISION_INPUT
PRINCIPAL --> DECISION_INPUT
RESOURCE --> DECISION_INPUT
ENV --> DECISION_INPUT

ROLE --> LOADER
USER_ROLE --> LOADER
ROLE_PERM --> LOADER
ROLE --> SOD
PERMISSION --> SOD
DATA_SCOPE_DEF --> ROW_FILTER
ROW_PERM --> ROW_FILTER
FIELD_PERM --> FIELD_FILTER
TENANT --> TENANT_MATCH
MENU --> FUNC_GATE
ORG --> ROW_FILTER

LOADER --> FUNC_GATE
DECISION_INPUT --> TENANT_MATCH
DECISION_INPUT --> FUNC_GATE
DECISION_INPUT --> MODEL_GATE
DECISION_INPUT --> ROW_FILTER
TENANT_MATCH --> DECISION
FUNC_GATE --> DECISION
MODEL_GATE --> DECISION
ROW_FILTER --> FIELD_FILTER
FIELD_FILTER --> DECISION
PRECEDENCE --> DECISION
FAIL_CLOSED -.兜底.-> DECISION
SOD -.设计期拦截.-> REVIEW

DECISION -->|ALLOW/FILTER/MASK| WF
DECISION -->|ALLOW/FILTER/MASK| PAGE
DECISION -->|ALLOW/FILTER/MASK| DATA
DECISION -->|ALLOW/FILTER/MASK| AIGC
DECISION -->|ALLOW/FILTER/MASK| APP

DRAFT --> REVIEW
REVIEW --> VERSION
VERSION --> EFFECTIVE
EFFECTIVE --> LOADER

ROW_PERM -.字段引用.-> KERNEL_SSOT
FIELD_PERM -.字段引用.-> KERNEL_SSOT
VERSION -.role/permission.changed.-> KERNEL_BUS
KERNEL_DEP -.精准失效.-> EFFECTIVE
DECISION -.决策证据.-> KERNEL_TRACE

classDef kernel fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:1.5px
classDef core fill:#e0e7ff,stroke:#4f46e5,color:#312e81,stroke-width:1.5px
classDef policy fill:#fae8ff,stroke:#c026d3,color:#701a75,stroke-width:1.5px
classDef gate fill:#fde68a,stroke:#d97706,color:#78350f,stroke-width:1.5px
classDef ledger fill:#ccfbf1,stroke:#0f766e,color:#134e4a,stroke-width:1.5px
classDef state fill:#f1f5f9,stroke:#64748b,color:#0f172a,stroke-width:1.5px
classDef ext fill:#f1f5f9,stroke:#94a3b8,color:#334155,stroke-width:1px
classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1.5px
```
