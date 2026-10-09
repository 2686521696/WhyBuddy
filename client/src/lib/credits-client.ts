/**
 * 积分接口的前端封装（后端 routes/credits.py）。照 New API：余额、兑换码、额度明细；超管调额、兑换码管理、价格设置。
 *
 * ⚠ 2026-10-09 积分制：上线开关改成 public 后任何登录账号都能开电脑、调模型（slide-rule-python/services/credit_ledger.py 头注）。
 *
 * 数额一律用「积分」（100 积分 = 1 美元），后端同时给了原始额度（quota），前端不自己换算。
 * 后端的错误响应被统一改写成 `{ message: <机器码>, ... }`（app.py 的 HTTPException 处理器），402 额外带 code。
 */

export type CreditAccount = {
  ownerId: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
  points: number;
  usedPoints: number;
};

export type CreditLog = {
  id: string;
  ownerId: string;
  kind: "topup" | "consume" | "manage" | "system";
  quota: number;
  points: number;
  balancePoints: number | null;
  model: string | null;
  promptTokens: number | null;
  cachedTokens: number | null;
  completionTokens: number | null;
  seconds: number | null;
  note: string | null;
  actor: string | null;
  createdAt: number;
};

export type CreditCode = {
  id: string;
  code: string;
  name: string;
  quota: number;
  points: number;
  status: "enabled" | "disabled" | "used" | "expired" | "unknown";
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
};

export type CreditUserRow = {
  id: string;
  email: string;
  name: string;
  isSuperuser: boolean;
  account: CreditAccount | null;
};

export type CreditOptions = {
  quota_for_new_user: number;
  default_model_ratio: number;
  default_completion_ratio: number;
  default_cache_ratio: number;
  model_ratio: Record<string, number>;
  completion_ratio: Record<string, number>;
  cache_ratio: Record<string, number>;
  computer_quota_per_minute: number;
  image_quota: number;
  enforcement_enabled: boolean;
  superuser_exempt: boolean;
  quotaForNewUserPoints: number;
  computerPointsPerHour: number;
  imagePoints: number;
  quotaPerPoint: number;
};

export type Page<T> = { items: T[]; total: number; page: number; size: number };

/** 后端错误码 → 人话。认不得的照原样给。 */
export const CREDIT_ERROR_TEXT: Record<string, string> = {
  credit_code_required: "请输入兑换码。",
  credit_code_invalid: "兑换码不存在，请检查有没有输错。",
  credit_code_used: "这个兑换码已经被用过了。",
  credit_code_disabled: "这个兑换码已被停用。",
  credit_code_expired: "这个兑换码已过期。",
  credit_store_unavailable: "额度服务暂时不可用，请稍后再试。",
  credit_code_not_changeable: "已经兑换过的码不能再改。",
  credit_code_name_required: "请填写批次名称。",
  credit_code_count_invalid: "一次最多生成 500 个。",
  credit_code_quota_invalid: "额度必须大于 0。",
  credit_code_expiry_in_past: "过期时间不能早于现在。",
};

export class CreditApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/sliderule${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (res.ok) return (await res.json()) as T;
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const raw = [body.code, body.message, body.detail].find(
    value => typeof value === "string" && value
  ) as string | undefined;
  const code = typeof body.code === "string" ? body.code : raw || `http_${res.status}`;
  const text =
    (raw && CREDIT_ERROR_TEXT[raw]) ||
    (res.status === 401
      ? "请先登录。"
      : res.status === 403
        ? "只有管理员能做这件事。"
        : raw || `请求失败（${res.status}）`);
  throw new CreditApiError(text, res.status, code);
}

const json = (body: unknown) => JSON.stringify(body);

export const creditsApi = {
  me: () =>
    request<{ account: CreditAccount; quotaPerPoint: number; exempt: boolean; enforced: boolean }>(
      "/credits/me"
    ),
  redeem: (code: string) =>
    request<{ points: number; account: CreditAccount }>("/credits/redeem", {
      method: "POST",
      body: json({ code: code.trim() }),
    }),
  logs: (page = 1, size = 20) =>
    request<Page<CreditLog>>(`/credits/logs?page=${page}&size=${size}`),
  admin: {
    users: (q = "", page = 1, size = 20) =>
      request<Page<CreditUserRow>>(
        `/account/admin/credits/users?q=${encodeURIComponent(q)}&page=${page}&size=${size}`
      ),
    adjust: (userId: string, body: { mode: "add" | "set"; points: number; note?: string }) =>
      request<{ account: CreditAccount; deltaPoints: number }>(
        `/account/admin/credits/users/${encodeURIComponent(userId)}/adjust`,
        { method: "POST", body: json(body) }
      ),
    logs: (params: { userId?: string; kind?: string; page?: number; size?: number }) => {
      const q = new URLSearchParams({
        userId: params.userId || "",
        kind: params.kind || "",
        page: String(params.page || 1),
        size: String(params.size || 20),
      });
      return request<Page<CreditLog>>(`/account/admin/credits/logs?${q}`);
    },
    codes: (params: { keyword?: string; status?: string; page?: number; size?: number }) => {
      const q = new URLSearchParams({
        keyword: params.keyword || "",
        status: params.status || "",
        page: String(params.page || 1),
        size: String(params.size || 20),
      });
      return request<Page<CreditCode>>(`/account/admin/credits/codes?${q}`);
    },
    createCodes: (body: { name: string; points: number; count: number; expiresAt?: number | null }) =>
      request<{ items: CreditCode[] }>("/account/admin/credits/codes", {
        method: "POST",
        body: json(body),
      }),
    setCodeStatus: (id: string, status: "enabled" | "disabled") =>
      request<{ ok: true }>(`/account/admin/credits/codes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: json({ status }),
      }),
    deleteCode: (id: string) =>
      request<{ ok: true }>(`/account/admin/credits/codes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    options: () => request<CreditOptions>("/account/admin/credits/options"),
    saveOptions: (patch: Partial<CreditOptions>) =>
      request<CreditOptions>("/account/admin/credits/options", {
        method: "PUT",
        body: json(patch),
      }),
  },
};

/** 积分显示：两位小数，去掉多余的 0。 */
export function formatPoints(points: number | null | undefined): string {
  const n = Number(points) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export const CREDIT_KIND_LABEL: Record<CreditLog["kind"], string> = {
  topup: "充值",
  consume: "消费",
  manage: "管理",
  system: "系统",
};

/** 一条明细里「用在哪」：模型 + token、电脑时长、或备注。 */
export function describeCreditLog(row: CreditLog): string {
  if (row.model && (row.promptTokens || row.completionTokens)) {
    const cached = row.cachedTokens ? `（缓存 ${row.cachedTokens}）` : "";
    return `${row.model} · 输入 ${row.promptTokens ?? 0}${cached} · 输出 ${row.completionTokens ?? 0}`;
  }
  if (row.seconds) return row.note || `工程电脑 ${Math.max(1, Math.round(row.seconds / 60))} 分钟`;
  return row.note || row.model || "-";
}

export function formatCreditTime(seconds: number | null | undefined): string {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 402 额度用完：后端 detail 被平铺成 `{ code: "credit_exhausted", message: 原话 }`。认出来就给原话。 */
export function creditExhaustedMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const nested =
    record.detail && typeof record.detail === "object"
      ? (record.detail as Record<string, unknown>)
      : null;
  const holder = record.code === "credit_exhausted" ? record : nested?.code === "credit_exhausted" ? nested : null;
  if (!holder) return null;
  return typeof holder.message === "string" && holder.message
    ? holder.message
    : "额度已用完。请在左下角账号菜单的「额度」里输入兑换码充值，或联系管理员加额度。";
}
