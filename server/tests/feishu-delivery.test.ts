import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeishuDeliveryError,
  type FeishuOutboundMessage,
} from "../feishu/bridge.js";
import { FeishuApiDelivery } from "../feishu/delivery.js";

function makeMessage(partial: Partial<FeishuOutboundMessage> = {}): FeishuOutboundMessage {
  return {
    kind: "task-progress",
    taskId: "task_delivery_1",
    text: "delivery smoke test",
    progress: 50,
    status: "running",
    target: {
      chatId: "oc_test_chat",
      source: "feishu",
    },
    ...partial,
  };
}

describe("FeishuApiDelivery retry behavior", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries 429 responses and succeeds with Retry-After delay telemetry", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "tenant-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            msg: "ok",
            data: {
              message_id: "om_retry_success",
              root_id: "om_root",
              thread_id: "om_thread",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );

    globalThis.fetch = fetchMock;
    const delivery = new FeishuApiDelivery({
      enabled: true,
      mode: "live",
      appId: "app-id",
      appSecret: "app-secret",
      deliveryMaxRetries: 2,
      deliveryRetryBaseMs: 300,
      deliveryRetryMaxMs: 5_000,
    });

    const receiptPromise = delivery.send(makeMessage());
    await vi.runAllTimersAsync();
    const receipt = await receiptPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(receipt).toMatchObject({
      messageId: "om_retry_success",
      rootId: "om_root",
      threadId: "om_thread",
      telemetry: {
        attemptCount: 2,
        retryCount: 1,
      },
    });
    expect(receipt?.telemetry?.attempts).toEqual([
      {
        attempt: 1,
        outcome: "response",
        statusCode: 429,
        retryable: true,
        delayMs: 2000,
      },
      {
        attempt: 2,
        outcome: "response",
        statusCode: 200,
        retryable: false,
        delayMs: undefined,
      },
    ]);
  });

  it("retries network errors and throws delivery error with telemetry after exhaustion", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "tenant-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ETIMEDOUT"));

    globalThis.fetch = fetchMock;
    const delivery = new FeishuApiDelivery({
      enabled: true,
      mode: "live",
      appId: "app-id",
      appSecret: "app-secret",
      deliveryMaxRetries: 2,
      deliveryRetryBaseMs: 100,
      deliveryRetryMaxMs: 500,
    });

    const receiptPromise = delivery.send(makeMessage());
    const observedPromise = receiptPromise.catch(error => error);
    await vi.runAllTimersAsync();
    const error = await observedPromise;

    expect(error).toMatchObject({
      name: "FeishuDeliveryError",
      message: "ETIMEDOUT",
      telemetry: {
        attemptCount: 3,
        retryCount: 2,
      },
    });
    expect(error).toBeInstanceOf(FeishuDeliveryError);
    const deliveryError = error as FeishuDeliveryError;
    expect(deliveryError.telemetry?.attempts).toEqual([
      {
        attempt: 1,
        outcome: "network-error",
        retryable: true,
        delayMs: 100,
        error: "socket hang up",
      },
      {
        attempt: 2,
        outcome: "network-error",
        retryable: true,
        delayMs: 200,
        error: "ECONNRESET",
      },
      {
        attempt: 3,
        outcome: "network-error",
        retryable: false,
        delayMs: undefined,
        error: "ETIMEDOUT",
      },
    ]);
  });

  it("stops retrying on non-retryable 400 response", async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "tenant-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response("bad request", {
          status: 400,
          statusText: "Bad Request",
        })
      );

    globalThis.fetch = fetchMock;
    const delivery = new FeishuApiDelivery({
      enabled: true,
      mode: "live",
      appId: "app-id",
      appSecret: "app-secret",
      deliveryMaxRetries: 3,
      deliveryRetryBaseMs: 100,
      deliveryRetryMaxMs: 500,
    });

    await expect(delivery.send(makeMessage())).rejects.toMatchObject({
      name: "FeishuDeliveryError",
      statusCode: 400,
      telemetry: {
        attemptCount: 1,
        retryCount: 0,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries token acquisition failures before sending message", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response("temporary unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: "ok", tenant_access_token: "tenant-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            msg: "ok",
            data: {
              message_id: "om_after_token_retry",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );

    globalThis.fetch = fetchMock;
    const delivery = new FeishuApiDelivery({
      enabled: true,
      mode: "live",
      appId: "app-id",
      appSecret: "app-secret",
      deliveryMaxRetries: 1,
      deliveryRetryBaseMs: 150,
      deliveryRetryMaxMs: 500,
    });

    const receiptPromise = delivery.send(makeMessage());
    await vi.runAllTimersAsync();
    const receipt = await receiptPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(receipt?.messageId).toBe("om_after_token_retry");
  });
});
