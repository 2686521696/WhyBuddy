import { useCallback, useEffect, useRef, useState } from "react";
import {
  getProjectPreview,
  isolatedPreviewUrl,
  ProjectPreviewError,
  requestProjectPreviewTicket,
  type ProjectPreviewReference,
  type ProjectPreviewSnapshot,
  type ProjectPreviewTicket,
} from "./project-preview-client";

const POLL_MS = 5000;

function identity(snapshot: ProjectPreviewSnapshot | null) {
  const d = snapshot?.descriptor;
  return d
    ? `${snapshot?.operationId}:${d.projectId}:${d.runtimeId}:${d.revision}`
    : null;
}

function usable(
  snapshot: ProjectPreviewSnapshot | null,
  revision?: string | null
) {
  const d = snapshot?.descriptor;
  return Boolean(
    snapshot?.available &&
    snapshot.operationId &&
    d?.status === "ready" &&
    (!revision || d.revision === revision) &&
    (!d.expiresAt || Date.parse(d.expiresAt) > Date.now())
  );
}

function errorMessage(error: unknown) {
  return error instanceof ProjectPreviewError
    ? error.message
    : "暂时无法连接工程预览服务，请稍后重试。";
}

/**
 * Refreshing a workbench is observation, not authorization to start a sandbox.
 * Only an explicit open requests a one-use ticket; unmount never cancels a run.
 * Scope every async result to its project and revision, including ticket replies.
 */
export function useProjectPreview({
  projectId,
  projectRevision,
}: ProjectPreviewReference) {
  const scope = `${projectId ?? ""}:${projectRevision ?? ""}`;
  const [state, setState] = useState<{
    scope: string;
    snapshot: ProjectPreviewSnapshot | null;
    loading: boolean;
    opening: boolean;
    error: string | null;
    ticket: (ProjectPreviewTicket & { identity: string }) | null;
  }>({
    scope,
    snapshot: null,
    loading: true,
    opening: false,
    error: null,
    ticket: null,
  });
  const generation = useRef(0);
  const latest = useRef<ProjectPreviewSnapshot | null>(null);
  const ticketRequest = useRef<AbortController | null>(null);
  const pollRequest = useRef<AbortController | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const current = ++generation.current;
    latest.current = null;
    setState({
      scope,
      snapshot: null,
      loading: Boolean(projectId),
      opening: false,
      error: projectId ? null : "这份会话缺少工程引用，请重新加载会话。",
      ticket: null,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!projectId) return;
      clearTimeout(timer);
      pollRequest.current?.abort();
      const controller = new AbortController();
      pollRequest.current = controller;
      try {
        const snapshot = await getProjectPreview(projectId, controller.signal);
        if (generation.current !== current || controller.signal.aborted) return;
        latest.current = snapshot;
        setState(prev => ({
          ...prev,
          scope,
          snapshot,
          loading: false,
          error: null,
          ticket:
            usable(snapshot, projectRevision) &&
            prev.ticket?.identity === identity(snapshot)
              ? prev.ticket
              : null,
        }));
      } catch (error) {
        if (generation.current !== current || controller.signal.aborted) return;
        latest.current = null;
        setState(prev => ({
          ...prev,
          snapshot: null,
          loading: false,
          error: errorMessage(error),
          ticket: null,
        }));
      } finally {
        if (generation.current === current && !controller.signal.aborted)
          timer = setTimeout(() => void refresh(), POLL_MS);
      }
    };
    refreshRef.current = refresh;
    void refresh();
    return () => {
      generation.current++;
      clearTimeout(timer);
      pollRequest.current?.abort();
      ticketRequest.current?.abort();
      ticketRequest.current = null;
    };
  }, [projectId, projectRevision, scope]);

  const open = useCallback(async () => {
    const snapshot = latest.current;
    if (ticketRequest.current || !usable(snapshot, projectRevision)) return;
    const current = generation.current;
    const key = identity(snapshot)!;
    const controller = new AbortController();
    ticketRequest.current = controller;
    setState(prev => ({ ...prev, opening: true, error: null, ticket: null }));
    try {
      const ticket = await requestProjectPreviewTicket(
        snapshot!.operationId!,
        controller.signal
      );
      if (
        controller.signal.aborted ||
        generation.current !== current ||
        key !== identity(latest.current) ||
        !usable(latest.current, projectRevision)
      )
        return;
      const entryUrl = isolatedPreviewUrl(
        ticket.entryUrl,
        window.location.href
      );
      setState(prev => ({
        ...prev,
        ticket: { ...ticket, entryUrl, identity: key },
      }));
    } catch (error) {
      if (!controller.signal.aborted && generation.current === current)
        setState(prev => ({
          ...prev,
          error: errorMessage(error),
          ticket: null,
        }));
    } finally {
      if (ticketRequest.current === controller) ticketRequest.current = null;
      if (generation.current === current)
        setState(prev => ({ ...prev, opening: false }));
    }
  }, [projectRevision]);

  useEffect(() => {
    if (!state.ticket) return;
    // This is the server's fixed maximum browser-access deadline, established
    // when issuing the ticket. The iframe load event cannot prove redemption;
    // the relay owns that check. Ticket expiry only prevents a new exchange.
    const timer = setTimeout(
      () =>
        setState(prev => ({
          ...prev,
          ticket: null,
          error: "预览授权已过期，请重新打开预览。",
        })),
      Math.min(
        Math.max(0, Date.parse(state.ticket.accessExpiresAt) - Date.now()),
        2_147_483_647
      )
    );
    return () => clearTimeout(timer);
  }, [state.ticket]);

  // Clear the old iframe during render, before the new scope's effect runs.
  const current = state.scope === scope;
  return {
    snapshot: current ? state.snapshot : null,
    loading: !current || state.loading,
    opening: current && state.opening,
    error: current ? state.error : null,
    entryUrl: current ? (state.ticket?.entryUrl ?? null) : null,
    canOpen:
      current && usable(state.snapshot, projectRevision) && !state.opening,
    refresh: () => refreshRef.current(),
    open,
  };
}
