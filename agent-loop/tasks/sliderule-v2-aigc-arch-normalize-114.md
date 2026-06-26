# SlideRule V2 AIGC 114.00: arch normalize for Skill landing

## Execution status
- Status: DONE_REVIEWED
- Goal: normalize the AIGC V2 architecture diagram into a Skill-landable spec before implementing AIGC-Skill code.
- Required gate: `slideruleV2AigcArchNormalize114Gates`

## Context
Queue 113 completed the runtime-less Skill layer for DataModel, RBAC, Workflow, Page, and AppBundle. AIGC is the next capability, but it must enter as a PEP execution point, not as a heavy runtime or a new PDP/SSOT/assembly root.

This prep task upgrades the AIGC V2 diagram so the next implementation tasks can map it directly into model fields, validators, projection, resolve surfaces, crossRefs, publish gate, and impact graph.

## Allowed files
- `docs/rbac-skill/AIGC 中台 · V2标准详图（样板）.md`
- `agent-loop/tasks/sliderule-v2-aigc-arch-normalize-114.md`
- `agent-loop/scripts/sliderule-v2-aigc-114-queue.json`
- This task file

## Do not
- Do not implement AIGC-Skill code in this task.
- Do not modify the five completed V2 Skills.
- Do not modify AgentLoop settings UI or dashboard.
- Do not stage unrelated local SPEC docs or workspace WIP.
- Do not add raw provider secrets, keys, or examples that look like real API keys.

## Implementation steps
- [x] Keep AIGC classified as PEP: it delegates permission decisions to RBAC PDP and binds data fields to DataModel SSOT.
- [x] Add explicit Skill-landable nodes for Field Binding, Output Schema, Provider KeyRef/SecretRef, Retrieval Policy, Citation Policy, and Trace Evidence.
- [x] Correct the Flow Publish Gate edge so dependency closure points to kernel ④ instead of being mislabeled as ⑤.
- [x] Expand Trace evidence edges for Prompt, Model Router, RAG/citation, Tool Sandbox, Provider Adapter, and Flow Result.
- [x] Make AppBundle composition/version-pin responsibility explicit for AIGC flow/prompt/tool/model artifacts.
- [x] Add a concise mapping table from the diagram to future AIGC-Skill fields and gates.
- [x] Validate Mermaid fence/subgraph balance and run mojibake checks on touched markdown.

## Required validation
- Mermaid fence/subgraph balance check for `docs/rbac-skill/AIGC 中台 · V2标准详图（样板）.md`
- Keyword gate for: `Model Datasource / Field Binding`, `Output Schema`, `Provider KeyRef / SecretRef`, `Retrieval Policy`, `Citation Policy`, `Trace Evidence`, `AigcCapability`, `FLOW_PUBLISH_GATE -.④`
- `node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-aigc-arch-normalize-114.md docs/rbac-skill/AIGC 中台 · V2标准详图（样板）.md`
- `git diff --name-only`

## Review evidence
- Mermaid fence/subgraph balance: 207 lines, 2 fences, 5 subgraphs, 5 `end` lines.
- Keyword gate: found `Model Datasource / Field Binding`, `Output Schema`, `Provider KeyRef / SecretRef`, `Retrieval Policy`, `Citation Policy`, `Trace Evidence`, `AigcCapability`, and `FLOW_PUBLISH_GATE -.④`.
- `node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-aigc-arch-normalize-114.md docs/rbac-skill/AIGC 中台 · V2标准详图（样板）.md`: No mojibake findings.
- `vitest run client/src/lib/skills --reporter=dot` via the main workspace binary: 9 test files, 115 tests passed.
- `tsc --noEmit --pretty false` via the main workspace binary: exit 0.
- `git diff --name-only` plus untracked scan: only the AIGC V2 doc, this task file, and `agent-loop/scripts/sliderule-v2-aigc-114-queue.json`.

## Acceptance criteria
- The AIGC diagram remains valid Mermaid markdown with balanced fences and subgraphs.
- The diagram clearly shows AIGC as a PEP execution point.
- The diagram exposes the exact model/gate surfaces needed by the next AIGC-Skill task wave.
- No runtime implementation or unrelated workspace changes are included.
