/**
 * 账号：注册 / 登录 / 当前身份（2026-08-02）。
 *
 * ## 产品语义
 *
 *   没登录  → 只能看：浏览应用中心、打开应用
 *   登录后  → 能 Fork、能推演、能改自己的东西
 *   超管    → 能管别人的
 *
 * ## 凭据放哪
 *
 * **httpOnly Cookie，不是 localStorage。** 服务端在登录响应里种 Cookie
 * （routes/account.py），浏览器自动带上。localStorage 存 JWT 是很常见的做法，
 * 但那样一次 XSS 就等于永久盗号——JS 读得到的东西，注入的脚本也读得到。
 *
 * 所以这里**没有** setToken/getToken 这类函数：token 前端根本碰不到，
 * 也不需要碰。同源 fetch 默认就带 Cookie（credentials: "same-origin"）。
 *
 * ## 一条纪律
 *
 * 这一层返回的 `capabilities` 只用来决定**显示哪些按钮**，不是权限判定。
 * 真正的判定在每个写接口里（Python 侧 app_access.require）。
 * 前端藏起来的按钮不等于后端拦得住——审查那套 RBAC 后台时，它的字段权限
 * 就是只藏了前端、后端照样把该隐藏的字段全返回了。
 */

const BASE = "/api/sliderule";

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string | null;
  isSuperuser: boolean;
  isVerified: boolean;
  createdAt?: string | null;
}

export interface Capabilities {
  loggedIn: boolean;
  isSuperuser: boolean;
  can: {
    browse: boolean;
    viewApp: boolean;
    fork: boolean;
    drive: boolean;
    manageOwn: boolean;
  };
}

/** 匿名时的能力。网络失败也用它——**按最小权限降级**，不要假设"可能登录着"。 */
export const ANONYMOUS_CAPABILITIES: Capabilities = {
  loggedIn: false,
  isSuperuser: false,
  can: { browse: true, viewApp: true, fork: false, drive: false, manageOwn: false },
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 后端把"邮箱不存在"和"密码错误"归一成同一句话（防用户枚举），
    // 这里原样透出，不要在前端再做区分——那会把后端刻意抹掉的信息还回去。
    const msg =
      (data as { detail?: string; message?: string })?.detail ||
      (data as { message?: string })?.message ||
      "请求失败";
    throw new Error(String(msg));
  }
  return data as T;
}

/**
 * 当前登录者。**匿名返回 null，不抛异常**——匿名是正常状态，不是错误。
 *
 * 后端对匿名也返回 200（见 routes/account.py 的说明）：返回 401 会在控制台
 * 刷一片红，也容易被通用的"401 就跳登录页"拦截器误伤。
 */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${BASE}/account/me`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: AuthUser | null };
    return data?.user ?? null;
  } catch {
    return null;
  }
}

export async function fetchCapabilities(): Promise<Capabilities> {
  try {
    const res = await fetch(`${BASE}/account/capabilities`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return ANONYMOUS_CAPABILITIES;
    return (await res.json()) as Capabilities;
  } catch {
    return ANONYMOUS_CAPABILITIES;
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await post<{ user: AuthUser }>("/account/login", { email, password });
  return data.user;
}

/** 注册第一步：发验证码。没配邮件服务时后端会把码带回来（devCode）。 */
export async function startRegistration(
  email: string,
  password: string
): Promise<{ codeSent: boolean; message: string; devCode?: string }> {
  return post("/account/register/start", { email, password });
}

export async function completeRegistration(
  email: string,
  password: string,
  code: string
): Promise<AuthUser> {
  const data = await post<{ user: AuthUser }>("/account/register", { email, password, code });
  return data.user;
}

/**
 * 登出：清 Cookie。
 *
 * ⚠️ 诚实说明：这**不会**让已签发的 token 立即失效（纯 JWT 没有服务端撤销）。
 * 语义是"这个浏览器忘掉凭据"。真要强制下线需要服务端撤销表，那是另一件事。
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/account/logout`, { method: "POST" });
  } catch {
    /* 网络失败也当作已登出——本地状态清掉，下次请求自然会被判为匿名 */
  }
}
