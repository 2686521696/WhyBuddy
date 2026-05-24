export function createMockJobStore(initialStage = "input") {
  let activeJobStage = initialStage;

  return {
    get activeJobStage() {
      return activeJobStage;
    },
    setActiveJobStage(stage: string) {
      activeJobStage = stage;
    },
  };
}

export function createMockPinStore(initialPin: string | null = null) {
  let urlPin = initialPin;

  return {
    get urlPin() {
      return urlPin;
    },
    setUrlPin(pin: string | null) {
      urlPin = pin;
    },
    resetPin() {
      urlPin = null;
    },
  };
}

export function createMockWorkflowStore(initialOverride: string | null = null) {
  let workflowStageOverride = initialOverride;

  return {
    get workflowStageOverride() {
      return workflowStageOverride;
    },
    fallbackWorkflowStageOverride(stage: string) {
      workflowStageOverride = stage;
    },
  };
}
