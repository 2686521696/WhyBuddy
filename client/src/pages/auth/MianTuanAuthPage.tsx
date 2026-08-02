/**
 * 面团 · 登录 / 注册页（2026-08-03）。
 *
 * ## 版式来源
 *
 * 取自 shadcn/ui 官方的 `login-02` 区块（MIT，拉到本地读过）：
 * 外层 `grid min-h-svh lg:grid-cols-2`，一侧品牌一侧表单，窄屏自动堆叠成单列。
 * 这是这类页面最稳的骨架——不用自己算断点，也不会在手机上把品牌区挤没。
 *
 * 品牌在**左**、表单在**右**（与 login-02 相反），跟用户给的参照图一致，也符合
 * 中文阅读从左到右先看主张再看操作的顺序。
 *
 * ## 与旧登录页的关系
 *
 * `/login` 那个 AuthPage 接的是**旧 Node/MySQL 账号体系**（`/api/auth/*`），
 * `/projects` 和 `/admin` 还依赖它。这一页接的是**新的 Neon 身份体系**
 * （`/api/sliderule/account/*`），两者并存、互不影响。
 *
 * 合并成一套是要做的，但那要先决定旧的那两个页面何去何从——属于产品决策，
 * 不该在做登录页时顺手替人定了。
 *
 * ## 三个功能上的取舍
 *
 * **① 登录后回到原来那一页**
 * `?next=` 参数记住来路。没有它的话，用户在应用中心点「复刻」被要求登录，
 * 登录完被扔回首页——还得自己找回刚才那张卡。这是 auth 类页面最常被略过、
 * 又最影响观感的一个细节。
 * ⚠️ 只接受**站内相对路径**：`next=https://evil.com` 会被丢弃，否则这就是一个
 * 开放重定向漏洞（钓鱼页面最爱的入口）。
 *
 * **② 已登录直接跳走**
 * 不做「你已登录，是否切换账号」那种中间态——那是给多账号场景准备的复杂度，
 * 这里还不需要。
 *
 * **③ 注册两步在同一个页面内切**
 * 填邮箱密码 → 收码 → 填码。做成路由跳转会丢掉已填内容，而验证码这一步用户
 * 经常要切出去看邮件再回来。
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { MianTuanMark, MianTuanWordmark } from "@/components/brand/MianTuanMark";
import {
  completeRegistration,
  login as apiLogin,
  startRegistration,
} from "@/lib/auth-client";
import { useAuth } from "@/lib/use-auth";
import {
  PRODUCT_NAME_ZH,
  PRODUCT_TAGLINE_ZH,
} from "@shared/brand";

type Mode = "login" | "register";
type Step = "form" | "code";

const DEFAULT_NEXT = "/agent-loop/workbench";

/**
 * 从 URL 取回跳地址。**只认站内相对路径。**
 *
 * `next=https://evil.com` 这类外站地址一律丢弃——放过去就是开放重定向：
 * 攻击者拿一个你域名下的链接把人骗到钓鱼页，而地址栏在跳转前显示的是你的域名。
 * `//evil.com` 这种省略协议的写法同样要挡（浏览器会当成绝对地址）。
 */
export function safeNextPath(raw: string | null | undefined): string {
  const value = (raw || "").trim();
  if (!value) return DEFAULT_NEXT;
  if (!value.startsWith("/")) return DEFAULT_NEXT;
  if (value.startsWith("//")) return DEFAULT_NEXT;
  // 反斜杠在部分浏览器里等价于斜杠，`/\evil.com` 会被当成协议相对地址
  if (value.startsWith("/\\")) return DEFAULT_NEXT;
  return value;
}

export default function MianTuanAuthPage() {
  const [, setLocation] = useLocation();
  const { user, ready, refresh } = useAuth();

  const next = useMemo(() => {
    if (typeof window === "undefined") return DEFAULT_NEXT;
    return safeNextPath(new URLSearchParams(window.location.search).get("next"));
  }, []);

  // 已登录就别停在登录页
  useEffect(() => {
    if (ready && user) setLocation(next);
  }, [ready, user, next, setLocation]);

  return (
    <div className="grid min-h-svh bg-white lg:grid-cols-[1.08fr_1fr]">
      <BrandPanel />
      <div className="flex flex-col justify-center px-6 py-10 md:px-12">
        <div className="mx-auto w-full max-w-[360px]">
          {/* 窄屏时品牌面板隐藏了，这里补一个标识，否则表单孤零零的 */}
          <div className="mb-8 lg:hidden">
            <MianTuanWordmark size={30} />
          </div>
          <AuthCard onDone={async () => {
            await refresh();
            setLocation(next);
          }} />
        </div>
      </div>
    </div>
  );
}

/** 左侧品牌区。导出是为了能单独测内容——整页渲染要 wouter 的 window。 */
export function BrandPanel() {
  return (
    // 渐变直接作为本面板的 background，不再用绝对定位的子元素 + 负 z-index：
    // 父容器有 bg-white，负 z-index 的子元素会被它整个盖住（第一版实测踩中，
    // 表现是"左边一片白"，而 CSS 看着完全正常）。
    <div
      className="relative hidden overflow-hidden border-r border-slate-100 lg:flex lg:flex-col lg:justify-between lg:px-16 lg:py-14"
      style={{
        background:
          "radial-gradient(125% 100% at 6% 0%, #E8F0FF 0%, #F3F7FF 38%, #FBFCFF 72%, #FFFFFF 100%)",
      }}
    >
      {/* 一坨低透明度的品牌色，给纯色底一点呼吸感 */}
      <div
        className="pointer-events-none absolute -left-32 top-1/4 h-[520px] w-[520px] rounded-full opacity-[0.18] blur-3xl"
        style={{ background: "linear-gradient(135deg,#22D3C5,#3B82F6 45%,#7C3AED)" }}
      />

      <div className="relative">
        <MianTuanWordmark size={34} />
      </div>

      <div className="relative max-w-[520px]">
        <h1 className="text-[42px] font-bold leading-[1.18] tracking-tight text-slate-900">
          欢迎来到{PRODUCT_NAME_ZH}
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-slate-500">
          {PRODUCT_TAGLINE_ZH}
        </p>

        <ul className="mt-9 space-y-3.5">
          {[
            "浏览应用中心无需登录",
            "登录后可复刻他人应用、继续推演",
            "你的应用归你所有，可设为公开或私密",
          ].map(line => (
            <li key={line} className="flex items-start gap-3 text-[15px] text-slate-600">
              <span
                className="mt-[7px] size-1.5 shrink-0 rounded-full"
                style={{ background: "linear-gradient(135deg,#22D3C5,#7C3AED)" }}
              />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-slate-400">miantuan.ai</p>
    </div>
  );
}

/** 右侧表单卡。同样导出以便单测（它只用 useState，SSR 下能渲染）。 */
export function AuthCard({ onDone }: { onDone: () => Promise<void> | void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await apiLogin(email, password);
      } else if (step === "form") {
        const started = await startRegistration(email, password);
        setStep("code");
        // 没配邮件服务时后端把码带回来（devCode），否则自部署第一步就卡死。
        // 配了真投递就没有这个字段，这行也不会显示。
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "login" ? "登录" : step === "form" ? "创建账号" : "输入验证码";
  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400";

  return (
    <div data-testid="miantuan-auth">
      <h2 className="text-[26px] font-semibold tracking-tight text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">
        {step === "code"
          ? `验证码已发到 ${email}`
          : "浏览无需登录；复刻和推演需要账号。"}
      </p>

      <div className="mt-7 space-y-3">
        {step === "form" ? (
          <>
            <input
              className={inputCls}
              type="email"
              placeholder="邮箱"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              data-testid="auth-email"
            />
            <input
              className={inputCls}
              type="password"
              placeholder={mode === "register" ? "密码（至少 8 位）" : "密码"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void submit()}
              data-testid="auth-password"
            />
          </>
        ) : (
          <input
            className={`${inputCls} text-center text-2xl tracking-[0.5em]`}
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={e => e.key === "Enter" && void submit()}
            data-testid="auth-code"
          />
        )}
      </div>

      {hint && (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {hint}
        </div>
      )}
      {error && (
        <div
          className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600"
          data-testid="auth-error"
        >
          {error}
        </div>
      )}

      <button
        type="button"
        className="mt-6 w-full rounded-xl py-3 text-[15px] font-medium text-white transition disabled:opacity-50"
        style={{ background: "linear-gradient(135deg,#3B82F6,#7C3AED)" }}
        disabled={busy}
        onClick={() => void submit()}
        data-testid="auth-submit"
      >
        {busy ? "处理中…" : title}
      </button>

      {step === "code" ? (
        <button
          type="button"
          className="mt-4 w-full text-xs text-slate-500 transition hover:text-slate-700"
          onClick={() => {
            setStep("form");
            setError(null);
            setHint(null);
          }}
        >
          ← 改一下邮箱
        </button>
      ) : (
        <button
          type="button"
          className="mt-4 w-full text-xs text-slate-500 transition hover:text-slate-700"
          onClick={() => {
            setMode(m => (m === "login" ? "register" : "login"));
            setStep("form");
            setError(null);
            setHint(null);
          }}
          data-testid="auth-switch-mode"
        >
          {mode === "login" ? "还没有账号？创建一个" : "已有账号？去登录"}
        </button>
      )}

      <div className="mt-10 flex items-center justify-center gap-2 text-[11px] text-slate-300">
        <MianTuanMark size={14} />
        miantuan.ai
      </div>
    </div>
  );
}
