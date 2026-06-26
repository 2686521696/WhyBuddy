# SlideRule V2 AIGC 114.05: tool skill config and policy

## Execution status
- Status: PENDING
- Goal: model tool execution metadata, tool whitelist policy, permission refs, and budget gates.
- Required gate: `slideruleV2AigcToolRuntime114Gates`

## Context
AIGC can orchestrate tools, MCP plugins, and API calls, but the runtime-less Skill layer only records tool metadata and validates that tools are whitelisted, permissioned, and budgeted.

## Allowed files
- `client/src/lib/skills/aigc/aigcModel.ts`
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/aigc/aigcSkill.test.ts`
- `agent-loop/tasks/sliderule-v2-aigc-tool-runtime-114.md`

## Do not
- Do not execute tools or call MCP servers.
- Do not add network sandbox runtime.
- Do not confuse Tool-Skill Config with SlideRule runtime-less Skill modules.

## Implementation steps
- [ ] Add tool refs to `AigcCapability`.
- [ ] Add `ToolSkillConfig` fields for `id`, `name`, `kind`, `permissionRefs`, and `budgetPolicyRef`.
- [ ] Add `ToolPolicy` fields for whitelist, timeout/budget metadata, and permission refs.
- [ ] Add validator findings `AIGC_TOOL_MISSING`, `AIGC_TOOL_POLICY_MISSING`, `AIGC_TOOL_PERMISSION_MISSING`, and `AIGC_TOOL_BUDGET_INVALID`.
- [ ] Add tests for missing tool config, missing permission refs, and invalid budget.

## Required validation
- `$p='client/src/lib/skills/aigc/aigcSkill.ts'; foreach($m in 'AIGC_TOOL_MISSING','AIGC_TOOL_POLICY_MISSING','AIGC_TOOL_PERMISSION_MISSING','AIGC_TOOL_BUDGET_INVALID'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/aigc/aigcModel.ts client/src/lib/skills/aigc/aigcSkill.ts client/src/lib/skills/aigc/aigcSkill.test.ts`

## Acceptance criteria
- Tools are represented as governed metadata, not runtime calls.
- Tool permissions are delegated to RBAC through refs.
- Budget/timeout metadata is validated.

