// The default SlideRule instance — RBAC first (Workflow's assignees depend on its roles),
// then Workflow. Add DataModel / Page / AppBundle skills here as they come online.

import { Orchestrator } from "./orchestrator";
import { dataModelSkill } from "./datamodel/dataModelSkill";
import { rbacSkill } from "./rbac/rbacSkill";
import { workflowSkill } from "./workflow/workflowSkill";

// Order = dependency order for generation: DataModel (entities) → RBAC (data rules point at
// entities) → Workflow (assignees point at RBAC roles).
export const slideRule = new Orchestrator().use(dataModelSkill).use(rbacSkill).use(workflowSkill);

/** One call: 一句话意图 → 统一 SPEC + 总关联图 + 汇总 gate 报告。 */
export function deriveApplication(intent: string) {
  return slideRule.run(intent);
}
