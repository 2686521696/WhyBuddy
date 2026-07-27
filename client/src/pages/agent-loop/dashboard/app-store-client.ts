/**
 * App Store 前端客户端（2026-07-25）——「生成应用」持久层（services/app_store.py）
 * 的前端取数入口。应用中心画廊从这里读「已闭环 · 有血缘 · 可复刻」的真数据。
 *
 * 设计对标 ToolJet 的 `frontend/src/_services/apps.service.js`（审计过的成熟实现）：
 *   getAll(page, folder, search, type)  →  listApps({limit, offset})    列表要「摘要」
 *   getApp(id)                          →  getApp(id)                    详情才拉「完整模型」
 *   getVersions(id)                     →  listVersions(rootId)          改版历史
 *   clone(id)  → POST /apps/{id}/clone  →  forkApp(id)                   复刻（新血缘）
 * ——即「列表只拉轻量摘要、完整定义按需再取」的两级取数。我们的差异化在于卡片封面
 * 用真实活渲染（AppRuntimeScreen），所以完整模型仍按卡懒拉，但列表本身保持轻。
 *
 * 全部走 Node 薄代理 `/api/sliderule/*`（server/routes/sliderule.ts 尾部 catch-all
 * 透传到 Python 并补 X-Internal-Key），前端不碰内部密钥。静态演示（GitHub Pages）
 * 无后端，调用方需自行短路，不要打这些接口。
 */

/** 列表摘要——对应 Python `_summary`（去掉 model_json 大载荷）。 */
export interface AppStoreSummary {
  id: string;
  root_id: string;
  parent_id: string | null;
  version: number;
  session_id: string | null;
  goal: string;
  gate_passed: boolean;
  created_at: string;
  product_name: string;
  theme_id: string;
  theme_label: string;
  device: string;
  landing_page_ref: string;
  entity_count: number;
  page_count: number;
}

/** 完整记录——摘要 + model_json（可直接重开渲染）。 */
export interface AppStoreRecord extends AppStoreSummary {
  model_json: unknown;
}

const BASE = "/api/sliderule";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * 应用画廊列表——默认每个应用只出最新版，摘要不含大模型载荷。
 * 对标 ToolJet getAll：翻页/条数是服务端参数，不在前端全量切片。
 */
export async function listApps(
  opts: { limit?: number; offset?: number } = {}
): Promise<AppStoreSummary[]> {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  const data = await getJson<{ apps?: AppStoreSummary[] }>(
    `${BASE}/apps?limit=${limit}&offset=${offset}`
  );
  return Array.isArray(data?.apps) ? data.apps : [];
}

/**
 * 取一个生成应用的完整记录（含 model_json）——卡片进入视口时才拉，
 * 用于活渲染缩略图 / 点开重渲。404 或网络失败返回 null（调用方走占位）。
 */
export async function getApp(id: string): Promise<AppStoreRecord | null> {
  try {
    return await getJson<AppStoreRecord>(`${BASE}/apps/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

/** 一个应用的改版历史（同 root 的所有版本，按 version 升序，摘要）。 */
export async function listVersions(rootId: string): Promise<AppStoreSummary[]> {
  try {
    const data = await getJson<{ versions?: AppStoreSummary[] }>(
      `${BASE}/apps/${encodeURIComponent(rootId)}/versions`
    );
    return Array.isArray(data?.versions) ? data.versions : [];
  } catch {
    return [];
  }
}

/**
 * 以某个生成应用为起点分出一条新血缘（新 root · v1 · parent 指向源）。
 * 对标 ToolJet clone / Budibase duplicateApp：传 name 给副本改名（避免同名孪生卡）。
 * 成功返回新 app id，失败返回 null。
 */
export interface ForkResult {
  id: string;
  /** 2026-07-27：后端 fork 时同步创建的绑定会话——副本点开即可运行/继续迭代 */
  sessionId?: string;
}

export async function forkApp(id: string, name?: string): Promise<ForkResult | null> {
  try {
    const res = await fetch(`${BASE}/apps/${encodeURIComponent(id)}/fork`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(name && name.trim() ? { name: name.trim() } : {}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string; sessionId?: string };
    if (typeof data?.id !== "string") return null;
    return { id: data.id, sessionId: typeof data.sessionId === "string" ? data.sessionId : undefined };
  } catch {
    return null;
  }
}

/**
 * 从画廊移除一个应用记录（只删记录，不动对应推演会话）。返回是否删成功。
 * 对标三家的 deleteApp：DELETE 幂等，失败/网络异常返回 false 让调用方保持原样。
 */
export async function deleteApp(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/apps/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}
