# SlideRule V2 AIGC 114.04: RAG retrieval and citation policy

## Execution status
- Status: PENDING
- Goal: model RAG knowledge sources, retrieval policy, and citation policy with gates.
- Required gate: `slideruleV2AigcRagPolicy114Gates`

## Context
RAG is a PEP surface: retrieval authorization is delegated to RBAC PDP, and knowledge source metadata is validated without running a vector database.

## Allowed files
- `client/src/lib/skills/aigc/aigcModel.ts`
- `client/src/lib/skills/aigc/aigcSkill.ts`
- `client/src/lib/skills/aigc/aigcSkill.test.ts`
- `agent-loop/tasks/sliderule-v2-aigc-rag-policy-114.md`

## Do not
- Do not add Qdrant, embedding, or reranking runtime.
- Do not fetch documents.
- Do not bypass RBAC for retrieval policy.

## Implementation steps
- [ ] Add or refine `KnowledgeSource`, `RetrievalPolicy`, and `CitationPolicy` model types.
- [ ] Add capability refs for `knowledgeSourceRefs`, `retrievalPolicyRef`, and `citationPolicyRef`.
- [ ] Add validator findings `AIGC_RAG_SOURCE_MISSING`, `AIGC_RETRIEVAL_POLICY_MISSING`, `AIGC_RETRIEVAL_PEP_BYPASS`, and `AIGC_CITATION_REQUIRED`.
- [ ] Add tests that missing knowledge source or missing citation policy is rejected when citations are required.
- [ ] Add tests that retrieval policy declares RBAC role/permission refs but does not make local auth decisions.

## Required validation
- `$p='client/src/lib/skills/aigc/aigcSkill.ts'; foreach($m in 'AIGC_RAG_SOURCE_MISSING','AIGC_RETRIEVAL_POLICY_MISSING','AIGC_RETRIEVAL_PEP_BYPASS','AIGC_CITATION_REQUIRED'){ if(-not (Select-String -LiteralPath $p -Pattern $m -SimpleMatch -Quiet)){ throw ('missing '+$m+' in '+$p) } }`
- `pnpm exec vitest run client/src/lib/skills/aigc/aigcSkill.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js {{taskFile}} client/src/lib/skills/aigc/aigcModel.ts client/src/lib/skills/aigc/aigcSkill.ts client/src/lib/skills/aigc/aigcSkill.test.ts`

## Acceptance criteria
- RAG assets are pure metadata.
- Retrieval policy is clearly PEP and delegates authorization to RBAC.
- Citation-required capabilities cannot omit citation policy.

