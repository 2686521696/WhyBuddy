# SlideRule V2 AIGC 114.02: provider router and no-secret contract

## Execution status
- Status: PENDING
- Goal: add provider/model router validation and enforce KeyRef/SecretRef instead of raw secrets.
- Required gate: `slideruleV2AigcProviderRouter114Gates`

## Context
AIGC may reference model providers, model names, and budgets, but this runtime-less layer must never carry raw API keys. Provider secrets are represented only by `keyRef` or `secretRef`.

## Allowed files
- `client/src/lib/skills/aigc/aigcModel.ts`
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/aigc/aigcSkill.test.ts`
- `agent-loop/tasks/sliderule-v2-aigc-provider-router-114.md`

## Do not
- Do not add real keys, fake `sk-...` examples, or `.env` reads.
- Do not call external provider APIs.
- Do not modify non-AIGC Skills.

## Implementation steps
- [ ] Extend provider/model route types with `providerRef`, `modelRef`, `tokenBudget`, `keyRef`, and `secretRef`.
- [ ] Add validator findings `AIGC_PROVIDER_MISSING`, `AIGC_MODEL_MISSING`, `AIGC_TOKEN_BUDGET_INVALID`, and `AIGC_RAW_SECRET`.
- [ ] Treat `apiKey`, `secret`, or `rawKey` fields on provider config as hard errors.
- [ ] Add tests that a valid provider route passes and a raw key fails.
- [ ] Add tests that a missing provider/model route fails.

## Required validation
- `$p='client/src/lib/skills/aigc/aigcSkill.ts'; foreach($m in 'AIGC_PROVIDER_MISSING','AIGC_MODEL_MISSING','AIGC_TOKEN_BUDGET_INVALID','AIGC_RAW_SECRET'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/aigc/aigcModel.ts client/src/lib/skills/aigc/aigcSkill.ts client/src/lib/skills/aigc/aigcSkill.test.ts`

## Acceptance criteria
- Provider/model references are validated as pure metadata.
- Raw secrets are always rejected.
- No network/provider runtime is added.

