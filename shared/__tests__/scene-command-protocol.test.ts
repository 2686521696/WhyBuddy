import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  SCENE_COMMAND_METHODS,
  SCENE_ERROR_CODES,
  SCENE_ERROR_NAMES,
  RETRYABLE_ERROR_CODES,
  sceneCommandSchema,
  sceneBatchSchema,
  validateCommand,
  validateParams,
  isKnownMethod,
  isRetryable,
  createCommand,
  createSuccessResult,
  createErrorResult,
} from "../scene-command/index.ts";

// ─── 1.1 JSON-RPC 2.0 基础消息格式 ─────────────────────────────────

describe("JSON-RPC 2.0 base message format", () => {
  it("validates a well-formed scene command", () => {
    const cmd = {
      jsonrpc: "2.0",
      method: "character.moveTo",
      params: { characterId: "hero", x: 1, y: 2, z: 3 },
      id: "req-1",
    };
    const result = validateCommand(cmd);
    expect(result.success).toBe(true);
  });

  it("rejects a command missing jsonrpc field", () => {
    const cmd = { method: "character.moveTo", params: {}, id: "req-1" };
    const result = validateCommand(cmd);
    expect(result.success).toBe(false);
  });

  it("rejects a command with wrong jsonrpc version", () => {
    const cmd = {
      jsonrpc: "1.0",
      method: "character.moveTo",
      params: {},
      id: "req-1",
    };
    const result = validateCommand(cmd);
    expect(result.success).toBe(false);
  });

  it("rejects a command with empty id", () => {
    const cmd = {
      jsonrpc: "2.0",
      method: "character.moveTo",
      params: {},
      id: "",
    };
    const result = validateCommand(cmd);
    expect(result.success).toBe(false);
  });

  it("validates batch requests", () => {
    const batch = [
      {
        jsonrpc: "2.0" as const,
        method: "effect.play",
        params: { effectId: "fire" },
        id: "b-1",
      },
      {
        jsonrpc: "2.0" as const,
        method: "effect.stop",
        params: { effectId: "fire" },
        id: "b-2",
      },
    ];
    const result = sceneBatchSchema.safeParse(batch);
    expect(result.success).toBe(true);
  });

  it("rejects empty batch", () => {
    const result = sceneBatchSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("allows custom extension methods in base schema", () => {
    const cmd = {
      jsonrpc: "2.0",
      method: "custom.doSomething",
      params: { foo: "bar" },
      id: "ext-1",
    };
    const result = validateCommand(cmd);
    expect(result.success).toBe(true);
  });
});

// ─── 1.2 参数校验规则 ───────────────────────────────────────────────

describe("parameter validation per method", () => {
  it("validates character.moveTo params", () => {
    const result = validateParams("character.moveTo", {
      characterId: "hero",
      x: 100,
      y: 0,
      z: -50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects character.moveTo with missing characterId", () => {
    const result = validateParams("character.moveTo", {
      x: 100,
      y: 0,
      z: -50,
    });
    expect(result.success).toBe(false);
  });

  it("validates character.playAnimation params", () => {
    const result = validateParams("character.playAnimation", {
      characterId: "hero",
      animationName: "wave",
      loop: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects character.playAnimation with negative blendTime", () => {
    const result = validateParams("character.playAnimation", {
      characterId: "hero",
      animationName: "wave",
      blendTime: -1,
    });
    expect(result.success).toBe(false);
  });

  it("validates camera.setPreset params", () => {
    const result = validateParams("camera.setPreset", {
      presetName: "closeup",
    });
    expect(result.success).toBe(true);
  });

  it("validates camera.transition params", () => {
    const result = validateParams("camera.transition", {
      targetPosition: { x: 0, y: 10, z: 5 },
      duration: 2.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects camera.transition with non-positive duration", () => {
    const result = validateParams("camera.transition", {
      targetPosition: { x: 0, y: 10, z: 5 },
      duration: 0,
    });
    expect(result.success).toBe(false);
  });

  it("validates scene.setState params", () => {
    const result = validateParams("scene.setState", {
      key: "weather",
      value: "rainy",
    });
    expect(result.success).toBe(true);
  });

  it("validates effect.play params", () => {
    const result = validateParams("effect.play", { effectId: "explosion" });
    expect(result.success).toBe(true);
  });

  it("validates effect.stop params", () => {
    const result = validateParams("effect.stop", {
      effectId: "explosion",
      fadeOut: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it("skips validation for unknown custom methods", () => {
    const result = validateParams("custom.myAction", { anything: true });
    expect(result.success).toBe(true);
  });
});

// ─── 1.3 错误码枚举与错误响应 ──────────────────────────────────────

describe("error codes and error responses", () => {
  it("defines all required error codes", () => {
    expect(SCENE_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
    expect(SCENE_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
    expect(SCENE_ERROR_CODES.INVALID_PARAMS).toBe(-32602);
    expect(SCENE_ERROR_CODES.EXECUTION_FAILED).toBe(-32000);
    expect(SCENE_ERROR_CODES.TIMEOUT).toBe(-32001);
    expect(SCENE_ERROR_CODES.QUEUE_FULL).toBe(-32002);
    expect(SCENE_ERROR_CODES.NOT_CONNECTED).toBe(-32003);
  });

  it("maps every error code to a name", () => {
    for (const [key, code] of Object.entries(SCENE_ERROR_CODES)) {
      expect(SCENE_ERROR_NAMES[code as keyof typeof SCENE_ERROR_NAMES]).toBe(
        key,
      );
    }
  });

  it("marks EXECUTION_FAILED, TIMEOUT, NOT_CONNECTED as retryable", () => {
    expect(isRetryable(SCENE_ERROR_CODES.EXECUTION_FAILED)).toBe(true);
    expect(isRetryable(SCENE_ERROR_CODES.TIMEOUT)).toBe(true);
    expect(isRetryable(SCENE_ERROR_CODES.NOT_CONNECTED)).toBe(true);
  });

  it("marks INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, QUEUE_FULL as non-retryable", () => {
    expect(isRetryable(SCENE_ERROR_CODES.INVALID_REQUEST)).toBe(false);
    expect(isRetryable(SCENE_ERROR_CODES.METHOD_NOT_FOUND)).toBe(false);
    expect(isRetryable(SCENE_ERROR_CODES.INVALID_PARAMS)).toBe(false);
    expect(isRetryable(SCENE_ERROR_CODES.QUEUE_FULL)).toBe(false);
  });

  it("creates error result with retryable flag", () => {
    const result = createErrorResult(
      "req-1",
      SCENE_ERROR_CODES.TIMEOUT,
      "timed out",
    );
    expect(result.jsonrpc).toBe("2.0");
    expect(result.id).toBe("req-1");
    expect(result.error?.code).toBe(-32001);
    expect(result.error?.retryable).toBe(true);
  });

  it("creates error result with non-retryable flag", () => {
    const result = createErrorResult(
      "req-2",
      SCENE_ERROR_CODES.INVALID_PARAMS,
      "bad params",
    );
    expect(result.error?.retryable).toBe(false);
  });
});

// ─── 工厂函数 ───────────────────────────────────────────────────────

describe("factory functions", () => {
  it("createCommand produces valid JSON-RPC request", () => {
    const cmd = createCommand("character.moveTo", {
      characterId: "hero",
      x: 0,
      y: 0,
      z: 0,
    });
    expect(cmd.jsonrpc).toBe("2.0");
    expect(cmd.method).toBe("character.moveTo");
    expect(cmd.id).toBeTruthy();
    expect(validateCommand(cmd).success).toBe(true);
  });

  it("createCommand uses provided id", () => {
    const cmd = createCommand("effect.play", { effectId: "fx" }, "my-id");
    expect(cmd.id).toBe("my-id");
  });

  it("createSuccessResult produces valid response", () => {
    const res = createSuccessResult("req-1", {
      success: true,
      duration: 1500,
    });
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe("req-1");
    expect(res.result?.success).toBe(true);
    expect(res.result?.duration).toBe(1500);
    expect(res.error).toBeUndefined();
  });

  it("isKnownMethod returns true for built-in methods", () => {
    for (const m of SCENE_COMMAND_METHODS) {
      expect(isKnownMethod(m)).toBe(true);
    }
  });

  it("isKnownMethod returns false for custom methods", () => {
    expect(isKnownMethod("custom.foo")).toBe(false);
  });
});

// ─── Property-based tests ───────────────────────────────────────────

describe("property-based tests", () => {
  const methodArb = fc.constantFrom(...SCENE_COMMAND_METHODS);
  const idArb = fc.string({ minLength: 1, maxLength: 64 }).filter((s) =>
    /\S/.test(s),
  );

  /**
   * **Validates: Requirements 1.1**
   * Any command created via createCommand always passes base schema validation.
   */
  it("createCommand always produces schema-valid requests", () => {
    fc.assert(
      fc.property(methodArb, idArb, (method, id) => {
        const cmd = createCommand(method, {}, id);
        return validateCommand(cmd).success === true;
      }),
    );
  });

  /**
   * **Validates: Requirements 4.3**
   * Error responses created via createErrorResult always carry the correct retryable flag.
   */
  it("createErrorResult retryable flag matches RETRYABLE_ERROR_CODES", () => {
    const codeArb = fc.constantFrom(
      ...Object.values(SCENE_ERROR_CODES),
    ) as fc.Arbitrary<number>;
    fc.assert(
      fc.property(idArb, codeArb, (id, code) => {
        const res = createErrorResult(id, code, "test");
        return res.error?.retryable === RETRYABLE_ERROR_CODES.has(code as any);
      }),
    );
  });
});
