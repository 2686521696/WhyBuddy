/**
 * 侧栏底部的账号区（2026-08-02）。
 *
 * 这里原来是一个写死的「SlideRule 团队 · 企业版」占位（title 里写着
 * "账号体系接入后可切换"）。现在接上了。
 *
 * ## 交互取向
 *
 * · 匿名时显示「登录 / 注册」，不挡首页——**匿名本来就能浏览应用中心**，
 *   开屏弹登录框会把"先看看"这条路堵死。
 * · 登录后显示邮箱 + 登出。超管加一个标记，避免"我以为我是普通用户"的误操作。
 * · 点「登录 / 注册」跳独立登录页 `/signin`，不在这里弹框——侧栏底部这个尺寸
 *   放不下品牌与说明，而登录页是新用户见到的第一屏。弹框那版（含注册三步）
 *   已随旧账号体系一起删掉。
 */

import {
  LoadingOutlined,
  LogoutOutlined,
  UserOutlined,
} from "@ant-design/icons";
import React from "react";

import { useAuth } from "@/lib/use-auth";

export function AccountPanel() {
  const { user, ready, signOut } = useAuth();

  if (!ready) {
    // 未就绪按匿名渲染（见 use-auth 的说明）：首屏是应用中心，匿名本来就能看。
    // 这里只是不显示"登录"字样，避免拿到结果后从"登录"闪成邮箱。
    return (
      <div className="native-agent-user" title="正在确认登录状态">
        <span className="native-agent-user-avatar" aria-hidden>
          <LoadingOutlined />
        </span>
        <span className="native-agent-user-meta">
          <span className="native-agent-user-name">…</span>
        </span>
      </div>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        className="native-agent-user"
        data-testid="account-signin"
        onClick={() => {
          // 跳独立登录页而不是就地弹框（2026-08-03）。
          // 弹框在侧栏底部那个尺寸里放不下品牌与说明，而登录/注册是新用户
          // 见到的第一屏——值得一个完整的页面。
          // 带上 next：登录完回到刚才这一页，不是被扔回首页。
          const next = encodeURIComponent(
            window.location.pathname + window.location.search
          );
          window.location.href = `/signin?next=${next}`;
        }}
        title="登录后可以复刻应用、继续推演"
      >
        <span className="native-agent-user-avatar" aria-hidden>
          <UserOutlined />
        </span>
        <span className="native-agent-user-meta">
          <span className="native-agent-user-name">登录 / 注册</span>
          <span className="native-agent-user-plan">浏览无需登录</span>
        </span>
      </button>
    );
  }

  return (
    <div
      className="native-agent-user"
      data-testid="account-signed-in"
      title={user.email}
    >
      <span className="native-agent-user-avatar" aria-hidden>
        <UserOutlined />
      </span>
      <span className="native-agent-user-meta">
        <span className="native-agent-user-name">
          {user.displayName || user.email}
        </span>
        <span className="native-agent-user-plan">
          {user.isSuperuser ? "管理员" : "已登录"}
        </span>
      </span>
      <button
        type="button"
        className="native-agent-user-caret"
        data-testid="account-signout"
        title="退出登录"
        onClick={() => void signOut()}
      >
        <LogoutOutlined />
      </button>
    </div>
  );
}
