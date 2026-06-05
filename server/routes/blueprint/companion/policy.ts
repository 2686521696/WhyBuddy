/**
 * `blueprint-v4-full-alignment` Module A — CompanionLayerPolicy 默认值（R17）。
 *
 * 纯数据，无方法，遵循现有 *Policy 模式。
 */

import type { CompanionLayerPolicy } from "../../../../shared/blueprint/companion/types.js";

export function createDefaultCompanionLayerPolicy(): CompanionLayerPolicy {
  return {
    fuzzinessThreshold: 0.6,
    maxFindingsPerInvocation: 10,
    enableCritic: true,
    enableGrounding: true,
  };
}
