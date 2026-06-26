# SlideRule V2 AIGC 114.06: PEP RBAC gate

## Execution status
- Status: PENDING
- Goal: enforce that AIGC delegates all role, permission, retrieval, and tool authorization to RBAC PDP.
- Required gate: `slideruleV2AigcPepRbacGate114Gates`

## Context
AIGC is a PEP execution point. It may enforce decisions, but it does not own decisions. Roles and permissions must resolve through the RBAC Skill surface.

## Allowed files
- `client/src/lib/skills/aigc/aigcModel.ts`
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/aigc/aigcSkill.test.ts`
- `agent-loop/tasks/sliderule-v2-aigc-pep-rbac-gate-114.md`

## Do not
- Do not add local-only allow/deny logic.
- Do not modify RBAC unless a tiny exported surface fix is truly required.
- Do not bypass missing RBAC surfaces silently.

## Implementation steps
- [ ] Add explicit PEP metadata on AIGC capability or model.
- [ ] Validate `allowedRoleRefs` against `ctx.external.rbac.role`.
- [ ] Validate `permissionRefs`, retrieval permission refs, and tool permission refs against `ctx.external.rbac.permission`.
- [ ] Add findings `AIGC_PEP_BYPASS`, `AIGC_ROLE_UNRESOLVED`, `AIGC_ROLE_MISSING`, `AIGC_PERMISSION_UNRESOLVED`, and `AIGC_PERMISSION_MISSING`.
- [ ] Add tests using `rbacSkill.resolve(leaveApprovalRbac)` or `rbacSkill.resolve(purchaseApprovalRbac)` as the PDP surface.

## Required validation
- `$p='client/src/lib/skills/aigc/aigcSkill.ts'; foreach($m in 'AIGC_PEP_BYPASS','AIGC_ROLE_MISSING','AIGC_PERMISSION_MISSING','AIGC_PERMISSION_UNRESOLVED'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills/rbac/rbacSkill.test.ts client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/aigc/aigcSkill.ts client/src/lib/skills/aigc/aigcSkill.test.ts`

## Acceptance criteria
- AIGC emits warnings when RBAC is not wired and errors when wired RBAC lacks refs.
- Local-only authorization is blocked.
- Existing RBAC tests stay green.

