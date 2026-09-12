import React, { useEffect, useRef, useState } from "react";
import {
  cancelProjectVerification,
  getProjectVerification,
  ProjectVerificationError,
  requestProjectVerification,
  type ProjectVerificationView,
} from "./project-verification-client";

interface Props {
  projectId?: string | null;
  revision?: string | null;
  runtimeOperationId?: string | null;
  runtimeId?: string | null;
  ready: boolean;
}

const POLL_MS = 3000;
const ACTIVE = new Set(["queued", "running", "waiting_user", "cancelling"]);
const STATUS: Record<string, string> = {
  queued: "已排队",
  running: "检查中",
  waiting_user: "等待处理",
  cancelling: "正在停止检查",
  passed: "页面检查通过",
  failed: "页面检查失败",
  blocked: "缺少检查条件",
  cancelled: "检查已取消",
  stale: "旧版本记录，需重新检查",
};
const ASSERTIONS: Record<string, string> = {
  heading_visible: "页面标题可见",
  counter_initial: "计数初始状态正确",
  counter_increment: "首次点击更新计数",
  counter_second_increment: "再次点击更新计数",
  reload_reset: "刷新后计数按模板重置",
  no_page_errors: "没有未捕获页面错误",
  no_failed_requests: "页面资源请求成功",
};
const ERRORS: Record<string, string> = {
  project_browser_not_configured: "当前环境尚未配置浏览器检查。",
  project_browser_key_missing: "当前环境缺少浏览器运行凭据。",
  project_browser_unavailable: "浏览器运行环境暂时不可用。",
  project_browser_auth_failed: "浏览器未能获得当前工程的访问授权。",
  project_browser_revision_mismatch: "检查期间工程版本发生变化，需要重新检查。",
  project_browser_navigation_blocked: "页面跳转超出本次允许的检查范围。",
  project_browser_assertion_failed: "已执行的页面检查中有断言失败。",
  project_browser_timeout: "浏览器检查超时，请稍后重试。",
  project_browser_cleanup_pending: "浏览器资源仍在回收，检查尚未完成。",
};
const message = (error: unknown) =>
  error instanceof ProjectVerificationError
    ? error.message
    : "暂时无法连接工程检查服务，请稍后重试。";

/**
 * Checking a template proves only the recorded page interactions. Reload reads
 * durable evidence and never starts another job. A source/runtime switch must
 * hide old success during render, before effects can abort outstanding replies.
 */
export function ProjectVerificationPanel({
  projectId,
  revision,
  runtimeOperationId,
  runtimeId,
  ready,
}: Props) {
  const scope = JSON.stringify([
    projectId,
    revision,
    runtimeOperationId,
    runtimeId,
  ]);
  const [state, setState] = useState<{
    scope: string;
    loading: boolean;
    busy: boolean;
    view: ProjectVerificationView | null;
    error: string | null;
    commandError: string | null;
  }>({
    scope,
    loading: Boolean(projectId),
    busy: false,
    view: null,
    error: null,
    commandError: null,
  });
  const generation = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const current = ++generation.current;
    idempotencyKey.current = null;
    setState({
      scope,
      loading: Boolean(projectId),
      busy: false,
      view: null,
      error: null,
      commandError: null,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      if (!projectId) return;
      if (writeRequest.current) {
        timer = setTimeout(() => void refresh(), POLL_MS);
        return;
      }
      readRequest.current?.abort();
      const controller = new AbortController();
      readRequest.current = controller;
      try {
        const view = await getProjectVerification(projectId, controller.signal);
        if (controller.signal.aborted || generation.current !== current) return;
        setState(prev => ({
          ...prev,
          scope,
          loading: false,
          view,
          error: null,
        }));
      } catch (error) {
        if (controller.signal.aborted || generation.current !== current) return;
        setState(prev => ({
          ...prev,
          loading: false,
          view: null,
          error: message(error),
        }));
      } finally {
        if (!controller.signal.aborted && generation.current === current)
          timer = setTimeout(() => void refresh(), POLL_MS);
      }
    };
    refreshRef.current = refresh;
    void refresh();
    return () => {
      generation.current++;
      clearTimeout(timer);
      readRequest.current?.abort();
      writeRequest.current?.abort();
      writeRequest.current = null;
    };
  }, [projectId, scope]);

  const current = state.scope === scope;
  const view = current ? state.view : null;
  const snapshot = view?.snapshot;
  const record = snapshot?.verification;
  const stale = Boolean(
    record &&
    (snapshot?.effectiveStatus === "stale" ||
      record.revision !== revision ||
      record.runtimeId !== runtimeId ||
      record.runtimeOperationId !== runtimeOperationId)
  );
  const operationActive = Boolean(
    view?.operationStatus && ACTIVE.has(view.operationStatus)
  );
  const active = operationActive || snapshot?.effectiveStatus === "running";
  const status = stale
    ? "stale"
    : operationActive
      ? view!.operationStatus!
      : (snapshot?.effectiveStatus ??
        (view?.operationStatus === "cancelled"
          ? "cancelled"
          : view?.operationId
            ? "blocked"
            : null));
  const loading = !current || state.loading;
  const busy = current && state.busy;
  const canStart = Boolean(
    projectId &&
    revision &&
    runtimeOperationId &&
    runtimeId &&
    ready &&
    !loading &&
    !busy &&
    !active &&
    !state.error
  );

  const command = async (cancel = false) => {
    if (
      writeRequest.current ||
      !current ||
      (cancel ? !active || !view?.operationId : !canStart)
    )
      return;
    const currentGeneration = generation.current;
    const controller = new AbortController();
    writeRequest.current = controller;
    readRequest.current?.abort();
    setState(prev => ({
      ...prev,
      busy: true,
      error: null,
      commandError: null,
    }));
    try {
      if (cancel) {
        await cancelProjectVerification(view!.operationId!, controller.signal);
        if (
          controller.signal.aborted ||
          generation.current !== currentGeneration
        )
          return;
        setState(prev => ({
          ...prev,
          view: prev.view
            ? { ...prev.view, operationStatus: "cancelling" }
            : null,
        }));
      } else {
        idempotencyKey.current ??= `browser-check:${crypto.randomUUID()}`;
        const result = await requestProjectVerification(
          runtimeOperationId!,
          revision!,
          idempotencyKey.current,
          controller.signal
        );
        if (
          controller.signal.aborted ||
          generation.current !== currentGeneration
        )
          return;
        idempotencyKey.current = null;
        setState(prev => ({
          ...prev,
          view: {
            operationId: result.operationId,
            operationStatus: result.status,
            snapshot: null,
          },
        }));
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        generation.current === currentGeneration
      )
        setState(prev => ({ ...prev, commandError: message(error) }));
    } finally {
      if (writeRequest.current === controller) writeRequest.current = null;
      if (generation.current === currentGeneration) {
        setState(prev => ({ ...prev, busy: false }));
        void refreshRef.current();
      }
    }
  };

  return (
    <section
      data-testid="project-verification-panel"
      aria-label="页面与计数交互检查"
      className="shrink-0 border-b border-stone-200 bg-stone-50 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-stone-700">
            页面与计数交互检查
          </h3>
          <p
            data-testid="project-verification-status"
            role="status"
            className="text-xs text-stone-600"
          >
            {loading
              ? "正在读取检查记录"
              : state.error
                ? "暂时无法读取检查状态"
                : busy && !active
                  ? "正在提交检查"
                  : status
                    ? STATUS[status]
                    : "尚未检查"}
          </p>
        </div>
        {active && view?.operationId ? (
          <button
            type="button"
            disabled={busy || view.operationStatus === "cancelling"}
            onClick={() => void command(true)}
            data-testid="project-verification-cancel"
            className="rounded-md px-3 py-1.5 text-xs text-stone-600 disabled:opacity-40"
          >
            停止检查
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void refreshRef.current()}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs text-stone-600 disabled:opacity-40"
        >
          更新检查状态
        </button>
        <button
          type="button"
          disabled={!canStart}
          onClick={() => void command()}
          data-testid="project-verification-start"
          className="rounded-md bg-stone-800 px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {record ? "重新检查页面" : "检查页面"}
        </button>
      </div>
      <p className="mt-1 text-xs leading-5 text-stone-500">
        仅检查固定模板的页面与计数交互；业务功能、数据持久化和角色权限仍需另行验收。
      </p>
      {current && state.error ? (
        <p role="alert" className="mt-1 text-xs text-amber-800">
          {state.error}
        </p>
      ) : null}
      {current && state.commandError ? (
        <p role="alert" className="mt-1 text-xs text-amber-800">
          {state.commandError}
        </p>
      ) : null}
      {!loading && !state.error && record?.errorCode ? (
        <p className="mt-1 text-xs text-amber-800">
          {ERRORS[record.errorCode] ??
            "本次检查未能完整完成，请查看已执行检查并重试。"}
        </p>
      ) : null}
      {record?.assertions?.length ? (
        <details className="mt-1 text-xs text-stone-600">
          <summary className="cursor-pointer">
            {stale ? "查看旧版本检查记录" : "查看已执行检查"}（
            {record.assertions.length} 项）
          </summary>
          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
            {record.assertions.map((assertion, index) => (
              <li key={`${assertion.id}:${index}`}>
                {ASSERTIONS[assertion.id] ?? "页面检查项"}：
                {assertion.status === "passed" ? "通过" : "失败"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
