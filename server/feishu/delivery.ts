import type {
  FeishuBridgeConfig,
  FeishuBridgeDelivery,
  FeishuDeliveryAttempt,
  FeishuDeliveryReceipt,
  FeishuDeliveryTelemetry,
  FeishuOutboundMessage,
} from "./bridge.js";
import { FeishuDeliveryError as DeliveryError } from "./bridge.js";

interface TokenCache {
  value: string;
  expiresAt: number;
}

interface FeishuTenantAccessTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuSendMessageResponse {
  code: number;
  msg: string;
  data?: {
    message_id?: string;
    root_id?: string;
    thread_id?: string;
  };
}

type FeishuReceiveIdType = "chat_id" | "open_id" | "union_id";

function resolveApiBaseUrl(config: FeishuBridgeConfig): string {
  return (config.apiBaseUrl || "https://open.feishu.cn/open-apis").replace(/\/$/, "");
}

function resolveReceiveTarget(rawTarget: string): {
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
} {
  let value = rawTarget.trim().replace(/^(feishu|lark):/i, "").trim();

  if (/^(chat|group):/i.test(value)) {
    return {
      receiveId: value.replace(/^(chat|group):/i, "").trim(),
      receiveIdType: "chat_id",
    };
  }
  if (/^(user|dm):/i.test(value)) {
    return {
      receiveId: value.replace(/^(user|dm):/i, "").trim(),
      receiveIdType: "open_id",
    };
  }
  if (/^oc_/i.test(value)) {
    return { receiveId: value, receiveIdType: "chat_id" };
  }
  if (/^ou_/i.test(value)) {
    return { receiveId: value, receiveIdType: "open_id" };
  }
  if (/^on_/i.test(value)) {
    return { receiveId: value, receiveIdType: "union_id" };
  }
  return { receiveId: value, receiveIdType: "chat_id" };
}

function resolveMessagePayload(message: FeishuOutboundMessage): {
  msgType: "text" | "interactive";
  content: string;
} {
  if (message.card) {
    return {
      msgType: "interactive",
      content: JSON.stringify(message.card),
    };
  }
  return {
    msgType: "text",
    content: JSON.stringify({
      text: message.text,
    }),
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const until = Date.parse(value);
  if (Number.isFinite(until)) {
    return Math.max(0, until - Date.now());
  }
  return null;
}

function summarizeAttempts(attempts: FeishuDeliveryAttempt[]): FeishuDeliveryTelemetry {
  return {
    attemptCount: attempts.length,
    retryCount: Math.max(0, attempts.length - 1),
    attempts: attempts.map(attempt => ({ ...attempt })),
  };
}

function resolveCorrelationHeaders(message: FeishuOutboundMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  if (message.target.traceId?.trim()) {
    headers["X-Trace-Id"] = message.target.traceId.trim();
  }
  if (message.target.requestId?.trim()) {
    headers["X-Request-Id"] = message.target.requestId.trim();
  }
  if (message.target.workflowId?.trim()) {
    headers["X-Workflow-Id"] = message.target.workflowId.trim();
  }
  if (message.target.sessionId?.trim()) {
    headers["X-Session-Id"] = message.target.sessionId.trim();
  }
  if (message.target.decisionId?.trim()) {
    headers["X-Decision-Id"] = message.target.decisionId.trim();
  }
  return headers;
}

export class FeishuApiDelivery implements FeishuBridgeDelivery {
  private readonly config: FeishuBridgeConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config: FeishuBridgeConfig) {
    this.config = config;
  }

  private isLive(): boolean {
    return this.config.enabled !== false && this.config.mode === "live";
  }

  private retryLimit(): number {
    return Math.max(0, this.config.deliveryMaxRetries ?? 2);
  }

  private retryBaseMs(): number {
    return Math.max(0, this.config.deliveryRetryBaseMs ?? 300);
  }

  private retryMaxMs(): number {
    return Math.max(this.retryBaseMs(), this.config.deliveryRetryMaxMs ?? 5_000);
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private computeRetryDelay(attempt: number, retryAfterHeader: string | null): number {
    const hinted = parseRetryAfter(retryAfterHeader);
    if (hinted !== null) return Math.min(hinted, this.retryMaxMs());
    const delay = this.retryBaseMs() * 2 ** attempt;
    return Math.min(delay, this.retryMaxMs());
  }

  private async fetchWithRetry(
    input: string,
    init: RequestInit
  ): Promise<{ response: Response; telemetry: FeishuDeliveryTelemetry }> {
    const maxRetries = this.retryLimit();
    const attempts: FeishuDeliveryAttempt[] = [];

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await fetch(input, init);
        const retryable = isRetryableStatus(response.status);
        const shouldRetry = !response.ok && retryable && attempt < maxRetries;
        const delayMs = shouldRetry
          ? this.computeRetryDelay(attempt, response.headers.get("retry-after"))
          : undefined;

        attempts.push({
          attempt: attempt + 1,
          outcome: "response",
          statusCode: response.status,
          retryable,
          delayMs,
        });

        if (!shouldRetry) {
          return {
            response,
            telemetry: summarizeAttempts(attempts),
          };
        }
        await this.sleep(delayMs ?? 0);
      } catch (error) {
        const shouldRetry = attempt < maxRetries;
        const delayMs = shouldRetry ? this.computeRetryDelay(attempt, null) : undefined;
        attempts.push({
          attempt: attempt + 1,
          outcome: "network-error",
          retryable: shouldRetry,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!shouldRetry) {
          throw new DeliveryError(
            error instanceof Error ? error.message : String(error),
            {
              telemetry: summarizeAttempts(attempts),
              cause: error,
            }
          );
        }
        await this.sleep(delayMs ?? 0);
      }
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.config.tenantAccessToken) return this.config.tenantAccessToken;
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.value;
    }
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error(
        "Feishu live delivery requires tenantAccessToken or appId/appSecret"
      );
    }

    const { response, telemetry } = await this.fetchWithRetry(
      `${resolveApiBaseUrl(this.config)}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      }
    );

    if (!response.ok) {
      throw new DeliveryError(
        `Failed to fetch Feishu tenant access token: ${response.status} ${response.statusText}`,
        {
          telemetry,
          statusCode: response.status,
        }
      );
    }

    const json = (await response.json()) as FeishuTenantAccessTokenResponse;
    if (json.code !== 0 || !json.tenant_access_token) {
      throw new DeliveryError(`Feishu token API error: ${json.msg || json.code}`, {
        telemetry,
        statusCode: response.status,
      });
    }

    this.tokenCache = {
      value: json.tenant_access_token,
      expiresAt: Date.now() + Math.max((json.expire ?? 7_200) - 60, 60) * 1_000,
    };

    return json.tenant_access_token;
  }

  async send(message: FeishuOutboundMessage): Promise<FeishuDeliveryReceipt | void> {
    if (!this.isLive()) return;
    if (!message.target.chatId) {
      throw new Error("Feishu outbound message missing chatId");
    }

    const token = await this.getTenantAccessToken();
    const payload = resolveMessagePayload(message);
    const target = resolveReceiveTarget(message.target.chatId);
    const { response, telemetry } = await this.fetchWithRetry(
      `${resolveApiBaseUrl(this.config)}/im/v1/messages?receive_id_type=${target.receiveIdType}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${token}`,
          ...resolveCorrelationHeaders(message),
        },
        body: JSON.stringify({
          receive_id: target.receiveId,
          msg_type: payload.msgType,
          content: payload.content,
          reply_in_thread: Boolean(message.target.threadId || message.target.rootMessageId),
          root_id: message.target.rootMessageId,
          reply_to_message_id: message.target.replyToMessageId,
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new DeliveryError(
        `Failed to send Feishu message: ${response.status} ${response.statusText}${
          detail ? ` - ${detail}` : ""
        }`,
        {
          telemetry,
          statusCode: response.status,
        }
      );
    }

    const json = (await response.json()) as FeishuSendMessageResponse;
    if (json.code !== 0) {
      throw new DeliveryError(`Feishu send message error: ${json.msg || json.code}`, {
        telemetry,
        statusCode: response.status,
      });
    }

    return {
      messageId: json.data?.message_id,
      rootId: json.data?.root_id,
      threadId: json.data?.thread_id,
      requestId: message.target.requestId?.trim() || undefined,
      traceId: message.target.traceId?.trim() || undefined,
      telemetry,
    };
  }

  async update(
    messageId: string,
    message: FeishuOutboundMessage
  ): Promise<FeishuDeliveryReceipt | void> {
    if (!this.isLive()) return;
    if (!messageId.trim()) {
      throw new Error("Feishu outbound update missing messageId");
    }

    const token = await this.getTenantAccessToken();
    const payload = resolveMessagePayload(message);
    const { response, telemetry } = await this.fetchWithRetry(
      `${resolveApiBaseUrl(this.config)}/im/v1/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${token}`,
          ...resolveCorrelationHeaders(message),
        },
        body: JSON.stringify({
          content: payload.content,
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new DeliveryError(
        `Failed to update Feishu message: ${response.status} ${response.statusText}${
          detail ? ` - ${detail}` : ""
        }`,
        {
          telemetry,
          statusCode: response.status,
        }
      );
    }

    const json = (await response.json()) as FeishuSendMessageResponse;
    if (json.code !== 0) {
      throw new DeliveryError(`Feishu update message error: ${json.msg || json.code}`, {
        telemetry,
        statusCode: response.status,
      });
    }

    return {
      messageId: json.data?.message_id ?? messageId,
      rootId: json.data?.root_id,
      threadId: json.data?.thread_id,
      requestId: message.target.requestId?.trim() || undefined,
      traceId: message.target.traceId?.trim() || undefined,
      telemetry,
    };
  }
}
