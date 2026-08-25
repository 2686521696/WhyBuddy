/**
 * connectors-client — 连接器清单与取数（前端口）。
 *
 * 两条接口，都在 Python 侧：
 *   GET  /api/sliderule/connectors               有哪些连接器
 *   POST /api/sliderule/connectors/{id}/rows     取一次真数据
 *
 * ⚠ 为什么必须走后端：跟换图那条同一个原因——页面 CSP 的 connect-src 里
 *   没有 qt.gtimg.cn / open-meteo.com，浏览器直连会被拦。"服务端能取到
 *   ≠ 浏览器能取到"。
 *
 * ⚠ 取数失败走的是 **200 + ok:false**，不是 HTTP 错误码。所以这里不能只看
 *   res.ok 就当成功——后端故意把错误语义放在数据面上，因为用户要知道的是
 *   "城市认不出"还是"数据源超时"，两者下一步动作完全不同。
 */

const BASE = "/api/sliderule";

export interface ConnectorArgSpec {
  id: string;
  name: string;
  placeholder: string;
  default: string;
  required: boolean;
}

export interface ConnectorFieldSpec {
  id: string;
  name: string;
  type: string;
  format?: string;
}

export interface ConnectorSpec {
  id: string;
  name: string;
  description: string;
  /** 这个连接器会落成哪个实体 */
  entityId: string;
  entityName: string;
  source: string;
  available: boolean;
  args: ConnectorArgSpec[];
  fields: ConnectorFieldSpec[];
}

export interface ConnectorRow {
  id: string;
  values: Record<string, unknown>;
}

export interface ConnectorFetchResult {
  ok: boolean;
  connectorId: string;
  entityId: string;
  rows: ConnectorRow[];
  source: string;
  fetchedAt: string;
  error: string;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function listConnectors(): Promise<ConnectorSpec[]> {
  try {
    const res = await fetch(`${BASE}/connectors`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    const body = await readJson(res);
    const items = body.connectors;
    return Array.isArray(items) ? (items as ConnectorSpec[]) : [];
  } catch {
    // ⚠ 清单取不到就当"这台机器上没有连接器"，不抛——它挂在输入框的
    //   `/` 面板里，一个后端抖动不该让用户连字都打不了。
    //   （取数那条是另一回事，见 fetchConnectorRows：那条必须如实报错。）
    return [];
  }
}

export async function fetchConnectorRows(
  connectorId: string,
  args: Record<string, string>
): Promise<ConnectorFetchResult> {
  const fail = (error: string): ConnectorFetchResult => ({
    ok: false,
    connectorId,
    entityId: "",
    rows: [],
    source: "",
    fetchedAt: "",
    error,
  });
  try {
    const res = await fetch(`${BASE}/connectors/${encodeURIComponent(connectorId)}/rows`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ args }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      const msg =
        (typeof body?.detail === "string" && body.detail) ||
        `取数失败（HTTP ${res.status}）`;
      return fail(msg);
    }
    const rows = Array.isArray(body.rows) ? (body.rows as ConnectorRow[]) : [];
    const ok = body.ok === true;
    return {
      ok,
      connectorId: String(body.connectorId || connectorId),
      entityId: String(body.entityId || ""),
      // ⚠ ok:false 时**强制清空行**。后端已经保证了，这里再保证一次是因为
      //   两边都可能被后人改（仓里第四条：成对的东西只改一半必然静默失效），
      //   而这一条一旦破了，页面就会铺满"取失败了但还是有数"的假数据。
      rows: ok ? rows : [],
      source: String(body.source || ""),
      fetchedAt: String(body.fetchedAt || ""),
      error: ok ? "" : String(body.error || "取数失败"),
    };
  } catch (err) {
    return fail(`取数失败：${(err as Error)?.message || "网络异常"}`);
  }
}
