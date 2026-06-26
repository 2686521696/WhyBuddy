# SlideRule Runtime-Less Skills

这个目录是 SlideRule Intent-to-App 的轻量 Skill 内核样板。它不启动数据库、不连 Redis、不跑后端服务，而是把重型低代码平台里的五个系统蒸馏成“纯数据模型 + 纯校验函数 + 图投影”。

目标很直接：用户输入“我要一个 XX 平台”后，SlideRule 先生成结构化 SPEC，再让五个 Skill 校验它是否自洽，并自动投影出架构图、关联关系图、发布门禁结果和影响分析结果。

## 五个 Skill

- `datamodel`：数据中台，负责实体、字段、字段版本、生命周期和关系。它是 SSOT，也就是字段和实体的唯一事实源。
- `rbac`：权限内核，负责角色、权限、菜单、用户、部门、岗位、数据规则、SoD 和 fail-closed 决策。它是 PDP，也就是统一权限决策点。
- `workflow`：工作流执行点，负责开始、审批、分支、结束节点，以及可达性、终止性和分支兜底校验。它是 PEP，审批人和权限检查都委托 RBAC。
- `page`：页面设计器执行点，负责组件、字段绑定、角色可见性、按钮权限和联动规则。它也是 PEP，字段绑定委托 DataModel，权限渲染委托 RBAC。
- `appbundle`：应用中心组装根，负责把实体、角色、流程、页面、菜单和页面-流程绑定打包成一个应用闭包，并做发布门禁和版本钉选。

## 统一接口

每个 Skill 都暴露同一组能力：

- `generate(intent, ctx)`：从意图生成样例模型。目前是 deterministic sample，后续才接 LLM。
- `validate(model, ctx)`：纯函数 gate，检查本系统和跨系统引用是否成立。
- `project(model)`：纯函数投影，把模型变成图节点、图边和 Mermaid。
- `resolve(model)`：导出可被其它 Skill 引用的稳定能力面，例如角色、权限、实体、字段、流程、页面。
- `crossRefs(model)`：声明自己引用了哪些外部资源，供编排器拼总图、闭包校验和 impact graph 使用。

编排器 `orchestrator` 本身不认识具体业务，只按注册顺序串联这些接口：DataModel -> RBAC -> Workflow -> Page -> AppBundle。

## 已验证的端到端样例

目前有两个 deterministic Intent-to-App 样例：

- `leave approval`：请假审批平台，覆盖员工、主管、请假单、主管审批、请假页面和应用包。
- `purchase approval`：采购审批平台，覆盖 requester、department manager、finance、procurement、采购申请、部门、供应商、经理审批、财务审批、采购履约、采购页面和应用包。

这两个样例都验证了：

- 五个 Skill 都能生成模型并进入统一 SPEC。
- DataModel 字段和实体能被 RBAC、Workflow、Page、AppBundle 正确引用。
- RBAC 角色和权限能被 Workflow、Page、AppBundle 正确引用。
- Workflow 和 Page 能被 AppBundle 正确组装。
- 总 Mermaid 图没有 ghost ref，也就是没有“未接入”的跨系统引用。

## 已支持的 Gate

- DataModel gate：实体/字段重复、字段版本冲突、字段生命周期、OLAP 非 SSOT、关系引用完整性。
- RBAC gate：角色/权限/菜单/数据规则引用完整性、角色继承环、SoD 冲突、fail-closed 决策。
- Workflow gate：唯一开始节点、可达性、可终止性、分支兜底、审批人角色、PEP 委托、SSOT 字段绑定。
- Page gate：组件 id、字段绑定、角色/权限渲染、PEP 绕过、联动源和目标合法性。
- AppBundle gate：跨系统引用闭包、版本钉选、runtime snapshot、PEP 绕过阻断。
- Publish gate：应用发布前的总门禁，要求所有 Skill gate 通过，并且所有跨系统引用都闭合。
- Impact graph：从角色、字段、流程或页面反向追踪所有下游影响面，返回直接和多跳 affected paths。

## 当前验证命令

截至 task 113.16，最后一轮验证命令为：

```powershell
pnpm exec vitest run client/src/lib/skills --reporter=dot
pnpm exec tsc --noEmit --pretty false
node agent-loop/src/check-mojibake.js client/src/lib/skills/README.md docs/intent-to-app/skill-v2-migration-status.md
```

最后记录结果：

- Skill tests：9 个测试文件，115 个测试通过。
- TypeScript：`tsc --noEmit --pretty false` 退出码 0。
- Mojibake：README/status 文档无乱码发现。

## 明确非目标

- 当前不接真实 LLM。`generate()` 仍是样例驱动，真实推演会在后续任务接入。
- 当前不物化到重型低代码平台，不写数据库，不生成真实页面运行时。
- 当前不加入 AIGC Skill 的影响分析；AIGC 仍属于下一轮能力。
- 当前不改 AgentLoop 设置页、任务队列 UI 或 V2 架构图源文件。
- 当前不承诺业务设计一定正确；gate 保证“结构自洽、引用闭合、可发布”，业务合理性仍需要人审。

