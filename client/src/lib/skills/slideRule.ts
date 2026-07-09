// The default SlideRule instance.

import { Orchestrator } from "./orchestrator";
import { aigcSkill } from "./aigc/aigcSkill";
import { appBundleSkill } from "./appbundle/appBundleSkill";
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
  .use(pageSkill)
  .use(aigcSkill)
  .use(appBundleSkill);

/** One call: 一句话意图 → 统一 SPEC + 总关联图 + 汇总 gate 报告。 */
export function deriveApplication(intent: string) {
  return slideRule.run(intent);
}

/** 跨系统影响分析：给定"改/删某个资源"，算出全平台受影响的产物。 */
export function analyzeImpact(
  models: Record<string, unknown>,
  target: import("./orchestrator").ResourceRef,
) {
  return slideRule.impact(models, target);
}
