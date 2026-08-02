/**
 * 登录态（2026-08-02）。
 *
 * 全站一份：启动时问一次 `/account/me`，登录/登出后刷新。
 *
 * ## 为什么用 Context 而不是每个组件各自 fetch
 *
 * 应用中心一屏几十张卡，每张都要知道"我能不能改这个"。各自去问一遍等于几十个
 * 相同的请求。而且登录态变化时必须**所有地方一起变**——Fork 按钮亮了、推演入口
 * 开了、"我的应用"筛选出现了，这些得是同一个事实的多个投影。
 *
 * ## 加载中怎么处理
 *
 * `ready` 为 false 时**当作匿名**渲染，而不是显示骨架屏或假设已登录。
 * 理由：首屏是应用中心，匿名本来就能看——按匿名渲染是正确的最终状态之一，
 * 拿到结果后只需要把按钮点亮。反过来（先假设登录）会闪一下再收回去。
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ANONYMOUS_CAPABILITIES,
  type AuthUser,
  type Capabilities,
  fetchCapabilities,
  fetchMe,
  logout as apiLogout,
} from "./auth-client";

interface AuthState {
  user: AuthUser | null;
  capabilities: Capabilities;
  /** 首次查询完成没有。false 时按匿名渲染（见文件头说明）。 */
  ready: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  capabilities: ANONYMOUS_CAPABILITIES,
  ready: false,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>(ANONYMOUS_CAPABILITIES);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [me, caps] = await Promise.all([fetchMe(), fetchCapabilities()]);
    setUser(me);
    setCapabilities(caps);
    setReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [me, caps] = await Promise.all([fetchMe(), fetchCapabilities()]);
      if (!alive) return;
      setUser(me);
      setCapabilities(caps);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    // 先清本地再刷新：即使刷新请求失败，界面也已经回到匿名态——
    // 不能出现"点了登出但按钮还亮着"。
    setUser(null);
    setCapabilities(ANONYMOUS_CAPABILITIES);
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ user, capabilities, ready, refresh, signOut }),
    [user, capabilities, ready, refresh, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/**
 * 能不能改这个应用——**只用于决定按钮显不显示**。
 *
 * 与 Python 侧 app_access.can_write 同一套规则：本人或超管；无主资源除超管外
 * 谁都不能改（存量应用没有归属字段，判成"谁都能改"等于把历史数据敞开）。
 *
 * ⚠️ 判定的权威在后端。这里返回 true 也可能被后端 403——那是正常的，
 * 前端只是不显示注定失败的按钮，不是在做授权。
 */
export function canWriteApp(
  ownerId: string | null | undefined,
  user: AuthUser | null
): boolean {
  if (!user) return false;
  if (user.isSuperuser) return true;
  if (!ownerId) return false;
  return ownerId === user.id;
}
