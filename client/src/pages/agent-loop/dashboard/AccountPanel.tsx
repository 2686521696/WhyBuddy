/**
 * 侧栏底部的账号区 + 登录/注册弹框（2026-08-02）。
 *
 * 这里原来是一个写死的「SlideRule 团队 · 企业版」占位（title 里写着
 * "账号体系接入后可切换"）。现在接上了。
 *
 * ## 交互取向
 *
 * · 匿名时显示「登录 / 注册」，不挡首页——**匿名本来就能浏览应用中心**，
 *   开屏弹登录框会把"先看看"这条路堵死。
 * · 登录后显示邮箱 + 登出。超管加一个标记，避免"我以为我是普通用户"的误操作。
 * · 登录框是**同一个弹框的两个模式**（登录/注册），不做两个页面——
 *   注册要三步（填 → 收码 → 验码），做成页面跳转会丢掉已填的内容。
 */

import { LoadingOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";
import React, { useState } from "react";

import {
  completeRegistration,
  login as apiLogin,
  startRegistration,
} from "@/lib/auth-client";
import { useAuth } from "@/lib/use-auth";

type Mode = "login" | "register";
/** 注册是两步：填邮箱密码 → 输验证码。用 step 区分，不做页面跳转。 */
type Step = "form" | "code";

export function AccountPanel() {
  const { user, ready, refresh, signOut } = useAuth();
  const [open, setOpen] = useState(false);

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
      <>
        <button
          type="button"
          className="native-agent-user"
          data-testid="account-signin"
          onClick={() => setOpen(true)}
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
        {open && <AuthDialog onClose={() => setOpen(false)} onDone={refresh} />}
      </>
    );
  }

  return (
    <div className="native-agent-user" data-testid="account-signed-in" title={user.email}>
      <span className="native-agent-user-avatar" aria-hidden>
        <UserOutlined />
      </span>
      <span className="native-agent-user-meta">
        <span className="native-agent-user-name">{user.displayName || user.email}</span>
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

export function AuthDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await apiLogin(email, password);
      } else if (step === "form") {
        const started = await startRegistration(email, password);
        setStep("code");
        // 没配邮件服务时后端把码带回来，否则自部署第一步就卡死。
        // 配了真投递就不会有 devCode，这行也就不显示。
        setHint(
          started.devCode
            ? `未配置邮件服务，验证码：${started.devCode}`
            : started.message || "验证码已发送，请查收邮件"
        );
        return;
      } else {
        await completeRegistration(email, password, code);
      }
      await onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "login" ? "登录" : step === "form" ? "注册" : "输入验证码";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      data-testid="auth-dialog"
    >
      <div
        className="w-[min(92vw,380px)] rounded-xl bg-white p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-1 text-base font-semibold text-stone-800">{title}</div>
        <div className="mb-4 text-xs text-stone-500">
          浏览应用中心无需登录；复刻和推演需要账号。
        </div>

        {step === "form" ? (
          <>
            <input
              className="mb-2 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
              placeholder="邮箱"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              data-testid="auth-email"
            />
            <input
              className="mb-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
              placeholder={mode === "register" ? "密码（至少 8 位）" : "密码"}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !busy) void submit();
              }}
              data-testid="auth-password"
            />
          </>
        ) : (
          <input
            className="mb-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-center text-lg tracking-[0.4em] outline-none focus:border-stone-400"
            placeholder="000000"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={e => {
              if (e.key === "Enter" && !busy) void submit();
            }}
            data-testid="auth-code"
          />
        )}

        {hint && <div className="mt-2 text-xs text-emerald-600">{hint}</div>}
        {error && (
          <div className="mt-2 text-xs text-rose-600" data-testid="auth-error">
            {error}
          </div>
        )}

        <button
          type="button"
          className="mt-4 w-full rounded-lg bg-stone-900 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => void submit()}
          data-testid="auth-submit"
        >
          {busy ? "处理中…" : title}
        </button>

        <button
          type="button"
          className="mt-3 w-full text-xs text-stone-500 hover:text-stone-700"
          onClick={() => {
            setMode(m => (m === "login" ? "register" : "login"));
            setStep("form");
            setError(null);
            setHint(null);
          }}
        >
          {mode === "login" ? "还没有账号？去注册" : "已有账号？去登录"}
        </button>
      </div>
    </div>
  );
}
