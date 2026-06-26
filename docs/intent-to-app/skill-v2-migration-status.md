# Intent-to-App Skill V2 迁移状态

本文档是 AgentLoop 队列 `sliderule-v2-skills-113` 的收口记录。目标是把 V2 架构里的五系统闭包落到 runtime-less Skill 层：RBAC=PDP，DataModel=SSOT，Workflow/Page=PEP，AppBundle=组装根，并具备 publish gate 与 impact graph。

## 最终状态

- 状态：16/16 task 已完成并进入 `DONE_REVIEWED` 流程。
- 覆盖面：Skill contract、RBAC、DataModel、Workflow、Page、AppBundle、publish gate、impact graph、第二个 purchase approval 端到端样例、最终 handoff。
- 当前样例：`leave approval` 与 `purchase approval`。
- 当前非目标：真实 LLM 生成、数据库物化、AIGC impact、AgentLoop 设置页改造、V2 架构图源文件改造。

## Task 表

| Task | 状态 | 主要成果 | 证据 |
|---|---|---|---|
| 113.01 `sliderule-v2-skill-contract-113` | DONE_REVIEWED | V2 共享 Skill contract，包含 PDP/SSOT/PEP、DependencyRef、VersionPin、PublishGateReport、ImpactReport。 | `pnpm exec vitest run client/src/lib/skills/kernel.test.ts --reporter=dot`; committed `31ff137b` |
| 113.02 `sliderule-v2-rbac-pdp-model-113` | DONE_REVIEWED | RBAC 模型补齐角色继承、SoD、PolicyContext、failClosed。 | `pnpm exec vitest run client/src/lib/skills/rbac/rbacSkill.test.ts --reporter=dot`; committed `0f1aa2a4` |
| 113.03 `sliderule-v2-rbac-pdp-gate-113` | DONE_REVIEWED | RBAC PDP 决策、角色继承环、SoD、fail-closed gate。 | `pnpm exec vitest run client/src/lib/skills --reporter=dot`; committed `763039ca` |
| 113.04 `sliderule-v2-rbac-pdp-project-resolve-113` | DONE_REVIEWED | RBAC projection/resolve 暴露 role、permission、policy、decision。 | RBAC + orchestrator tests; committed `40b823f6` |
| 113.05 `sliderule-v2-datamodel-ssot-model-113` | DONE_REVIEWED | DataModel SSOT 字段 identity、version、lifecycle、storageRole、namespace。 | DataModel tests + tsc; committed `b11ec2bf` |
| 113.06 `sliderule-v2-datamodel-ssot-gate-113` | DONE_REVIEWED | DataModel 字段版本、deprecated/removed、OLAP 非 SSOT gate。 | Full skills tests; committed `6eba157b` |
| 113.07 `sliderule-v2-datamodel-ssot-project-resolve-113` | DONE_REVIEWED | DataModel field/entity projection 与 resolve，供 Workflow/Page/RBAC 引用。 | DataModel + orchestrator tests; committed `f44a8fb8` |
| 113.08 `sliderule-v2-workflow-pep-model-113` | DONE_REVIEWED | Workflow PEP 模型补 actorRoleRef、policyCheckRefs、fieldRefs、traceSpan。 | Workflow tests + tsc; committed `b5e4b641` |
| 113.09 `sliderule-v2-workflow-pep-gate-project-113` | DONE_REVIEWED | Workflow 审批人委托 RBAC、字段委托 DataModel、PEP bypass gate。 | Workflow + orchestrator + full skills tests; committed `5e533daa` |
| 113.10 `sliderule-v2-page-pep-model-113` | DONE_REVIEWED | Page PEP 模型补 BindingSchema、PermissionRender、componentVersion、traceSpan。 | Page tests + tsc; committed `365da934` |
| 113.11 `sliderule-v2-page-pep-gate-project-113` | DONE_REVIEWED | Page 字段绑定、权限渲染、PEP bypass 与 linkage 校验。 | Page + orchestrator + full skills tests; committed `c184e96d` |
| 113.12 `sliderule-v2-appbundle-version-pins-113` | DONE_REVIEWED | AppBundle versionPins、publishManifest、runtimeSnapshot。 | AppBundle tests + full skills tests; committed `21609919` |
| 113.13 `sliderule-v2-appbundle-publish-gate-113` | DONE_REVIEWED | AppBundle publish gate 阻断未闭合引用、未钉版本、ghost ref、PEP bypass。 | AppBundle + orchestrator + full skills tests; committed `0be7610e` |
| 113.14 `sliderule-v2-impact-graph-113` | DONE_REVIEWED | 全局 dependency graph 与 multi-hop impact paths。 | `pnpm exec vitest run client/src/lib/skills/impact.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`; committed `37eec60d` |
| 113.15 `sliderule-v2-e2e-purchase-approval-113` | DONE_REVIEWED | 第二个 purchase approval 端到端样例，覆盖四角色、采购数据、流程、页面、AppBundle、publish gate、impact。 | `pnpm exec vitest run client/src/lib/skills/purchaseApproval.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`; committed `21aa44cd` |
| 113.16 `sliderule-v2-verification-handoff-113` | DONE_REVIEWED | README 与迁移状态 handoff，最终验证记录。 | `pnpm exec vitest run client/src/lib/skills --reporter=dot`; `pnpm exec tsc --noEmit --pretty false`; mojibake check |

## 最终验证

本轮收口前在隔离 worktree 中执行：

```powershell
pnpm exec vitest run client/src/lib/skills --reporter=dot
pnpm exec tsc --noEmit --pretty false
node agent-loop/src/check-mojibake.js client/src/lib/skills/README.md
git diff --name-only
```

结果：

- `pnpm exec vitest run client/src/lib/skills --reporter=dot`：9 个测试文件，115 个测试通过。
- `pnpm exec tsc --noEmit --pretty false`：退出码 0。
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/README.md`：No mojibake findings。
- `git diff --name-only`：写文档前为空；写文档后仅包含本 task 允许的 README、status doc、task markdown。

## Handoff

下一轮可以从三个方向继续：

- 接真实 LLM：把 `generate()` 从 deterministic sample 改成受 schema/gate 约束的模型生成。
- 接物化：把通过 publish gate 的 AppBundle SPEC 写入重型低代码平台或由 AgentLoop 生成补充代码。
- 接 AIGC Skill：把 AIGC 作为 PEP 执行点接入同一套 resolve/crossRefs/publish gate/impact graph。

