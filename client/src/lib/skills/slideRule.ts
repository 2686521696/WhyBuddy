// The default SlideRule instance. Add AppBundle here when the final packaging skill comes online.

import { Orchestrator } from "./orchestrator";
import { dataModelSkill } from "./datamodel/dataModelSkill";
import { pageSkill } from "./page/pageSkill";
import { rbacSkill } from "./rbac/rbacSkill";
import { workflowSkill } from "./workflow/workflowSkill";

// Order = dependency order for generation: DataModel (entities) → RBAC (data rules point at
// entities) → Workflow (assignees point at RBAC roles) → Page (fields + roles).
export const slideRule = new Orchestrator()
  .use(dataModelSkill)
  .use(rbacSkill)
  .use(workflowSkill)
  .use(pageSkill);

/** One call: 一句话意图 → 统一 SPEC + 总关联图 + 汇总 gate 报告。 */
export function deriveApplication(intent: string) {
  return slideRule.run(intent);
}
