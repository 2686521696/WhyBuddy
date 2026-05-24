import type {
  CoordinationSubmission,
  CoordinationTriggerSource,
} from "../../AutopilotCoordinator.js";

export function createMockCoordinationSubmission(
  triggerSource: CoordinationTriggerSource,
  overrides: Partial<CoordinationSubmission> = {}
): CoordinationSubmission {
  return {
    triggerSource,
    apply: () => undefined,
    ...overrides,
  };
}
