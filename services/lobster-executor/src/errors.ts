export class LobsterExecutorError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends LobsterExecutorError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ConflictError extends LobsterExecutorError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class NotFoundError extends LobsterExecutorError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ExecutorCapabilityError extends LobsterExecutorError {
  constructor(
    message: string,
    readonly code: "EXECUTOR_CAPABILITY_UNKNOWN" | "EXECUTOR_CAPABILITY_UNSUPPORTED",
    readonly unsupportedCapabilities: string[],
    readonly supportedCapabilities: string[],
    readonly hint: string,
  ) {
    super(message, 400);
  }
}
