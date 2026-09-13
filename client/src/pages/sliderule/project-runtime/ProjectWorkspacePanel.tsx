import React, { useEffect, useRef, useState } from "react";
import { activateSession } from "../../agent-loop/dashboard/SidebarSessions";
import type { PreviewSourceLocation } from "./preview-selection-bridge";
import {
  exportProjectRevision,
  forkProjectRevision,
  getProjectRevisions,
  getProjectSource,
  getProjectSourceFile,
  getSourceOperation,
  patchProjectSource,
  ProjectWorkspaceError,
  restoreProjectRevision,
  type RevisionPage,
  type SourceCommand,
  type SourceFile,
  type SourceIndex,
} from "./project-workspace-client";

export interface SourceSelection extends PreviewSourceLocation {
  revision: string;
  selectionId: string;
}
interface Props {
  projectId: string;
  projectRevision?: string | null;
  revisionMode: "current" | "pinned";
  tab: "source" | "history";
  selection: SourceSelection | null;
  onChanged: () => void;
}
const buttonClass =
  "rounded border border-stone-300 px-3 py-1.5 text-xs text-stone-700 disabled:opacity-40";
const active = new Set(["queued", "running", "waiting_user", "cancelling"]);
const failure = (error: unknown) =>
  error instanceof ProjectWorkspaceError
    ? error.message
    : "暂时无法连接工程服务，请稍后重试。";

export function ProjectWorkspacePanel(props: Props) {
  return <ProjectWorkspaceBody key={props.projectId} {...props} />;
}

/** Committed source and pending user drafts remain distinct, as in grok's views. */
function ProjectWorkspaceBody({
  projectId,
  projectRevision,
  revisionMode,
  tab,
  selection,
  onChanged,
}: Props) {
  const [index, setIndex] = useState<SourceIndex | null>(null);
  const [file, setFile] = useState<SourceFile | null>(null);
  const [path, setPath] = useState("");
  const [drafts, setDrafts] = useState<
    Record<string, { base: SourceFile; content: string }>
  >({});
  const [history, setHistory] = useState<RevisionPage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(tab === "history");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [revisionOverride, setRevisionOverride] = useState<
    string | null | undefined
  >(undefined);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fork, setFork] = useState<{ sessionId: string } | null>(null);
  const [pending, setPending] = useState<SourceCommand | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const writes = useRef<AbortController | null>(null);
  const commandKeys = useRef(new Map<string, string>());
  const savedDraft = useRef<{ path: string; content: string } | null>(null);
  const requestedRevision =
    revisionOverride !== undefined
      ? (revisionOverride ?? undefined)
      : (selection?.revision ??
        (revisionMode === "pinned"
          ? (projectRevision ?? undefined)
          : undefined));
  const scope = JSON.stringify([projectId, requestedRevision]);
  const readScope = useRef(scope);
  readScope.current = scope;
  const [loadedScope, setLoadedScope] = useState(scope);
  const currentIndex = loadedScope === scope ? index : null;
  const currentFile =
    currentIndex &&
    file?.revision === currentIndex.revision &&
    file.path === path
      ? file
      : null;
  const draft = currentFile ? drafts[currentFile.path] : null;
  const content = draft?.content ?? currentFile?.content ?? "";
  const dirty = Boolean(
    currentFile && draft && draft.content !== draft.base.content
  );
  const staleDraft = Boolean(
    dirty && draft?.base.revision !== currentFile?.revision
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      writes.current?.abort();
    };
  }, []);
  useEffect(() => {
    setRevisionOverride(undefined);
  }, [selection?.selectionId, projectRevision, revisionMode]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getProjectSource(projectId, requestedRevision, controller.signal)
      .then(next => {
        if (controller.signal.aborted) return;
        setIndex(next);
        setLoadedScope(scope);
        setConflict(false);
        setPath(prior => {
          if (
            selection &&
            next.revision === selection.revision &&
            next.files.some(row => row.path === selection.path)
          )
            return selection.path;
          return next.files.some(row => row.path === prior)
            ? prior
            : (next.files[0]?.path ?? "");
        });
        if (
          selection &&
          next.revision === selection.revision &&
          !next.files.some(row => row.path === selection.path)
        )
          setError("选中元素的源码位置不在这份工程中，请从文件列表选择。");
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setIndex(null);
          setError(failure(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, requestedRevision, scope, refresh, selection?.selectionId]);
  useEffect(() => {
    if (!currentIndex || !path) {
      setFile(null);
      return;
    }
    const controller = new AbortController();
    setFile(null);
    void getProjectSourceFile(
      projectId,
      currentIndex.revision,
      path,
      controller.signal
    )
      .then(next => {
        if (controller.signal.aborted) return;
        setFile(next);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(failure(reason));
      });
    return () => controller.abort();
  }, [projectId, currentIndex?.revision, path, refresh]);
  useEffect(() => {
    if (
      !selection ||
      !currentFile ||
      currentFile.path !== selection.path ||
      currentFile.revision !== selection.revision ||
      !textarea.current
    )
      return;
    const lines = content.split("\n");
    if (
      selection.line > lines.length ||
      selection.column > lines[selection.line - 1].length + 1
    ) {
      setError("选中元素的源码行列已失效，请重新选择。");
      return;
    }
    const start =
      lines
        .slice(0, selection.line - 1)
        .reduce((sum, line) => sum + line.length + 1, 0) +
      selection.column -
      1;
    textarea.current.focus();
    textarea.current.setSelectionRange(
      start,
      start +
        Math.max(1, lines[selection.line - 1].length - selection.column + 1)
    );
    textarea.current.scrollTop = Math.max(0, (selection.line - 3) * 20);
  }, [selection?.selectionId, currentFile]);
  useEffect(() => {
    if (tab !== "history") return;
    const controller = new AbortController();
    // The source index often arrives before history. Its loading flag cannot
    // describe this independent GET or the version tab appears empty meanwhile.
    setHistoryLoading(true);
    setHistoryError(null);
    void getProjectRevisions(projectId, null, controller.signal)
      .then(next => {
        if (!controller.signal.aborted) setHistory(next);
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setHistory(null);
          setHistoryError(failure(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [projectId, tab, refresh]);

  const complete = (command: SourceCommand) => {
    setPending(null);
    if (command.status !== "completed") {
      setError("工程操作未完成。草稿已保留，请更新运行状态后重试。");
      return;
    }
    const saved = savedDraft.current;
    if (saved)
      setDrafts(prior => {
        if (prior[saved.path]?.content !== saved.content) return prior;
        const next = { ...prior };
        delete next[saved.path];
        return next;
      });
    savedDraft.current = null;
    setNotice(
      "源码版本已保存；运行中的预览由工程服务同步。验收记录需要重新检查。"
    );
    setRevisionOverride(null);
    setConflict(false);
    setRefresh(value => value + 1);
    onChanged();
  };
  useEffect(() => {
    if (!pending?.operationId || !active.has(pending.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const operation = await getSourceOperation(
          pending.operationId!,
          controller.signal
        );
        if (controller.signal.aborted) return;
        if (operation.projectId !== projectId)
          throw new ProjectWorkspaceError("操作记录与当前工程不一致。");
        if (!active.has(operation.status)) {
          complete({ ...pending, status: operation.status });
          return;
        }
        timer = setTimeout(() => void poll(), 1500);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(failure(reason));
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pending?.operationId, projectId]);

  const command = async (
    identity: string,
    run: (key: string, signal: AbortSignal) => Promise<void>
  ) => {
    if (writes.current || pending) return;
    const controller = new AbortController();
    writes.current = controller;
    const current = readScope.current;
    const key =
      commandKeys.current.get(identity) ?? `workspace:${crypto.randomUUID()}`;
    commandKeys.current.set(identity, key);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run(key, controller.signal);
      commandKeys.current.delete(identity);
    } catch (reason) {
      if (
        !controller.signal.aborted &&
        alive.current &&
        current === readScope.current
      ) {
        setError(failure(reason));
        setConflict(reason instanceof ProjectWorkspaceError && reason.conflict);
      }
    } finally {
      if (writes.current === controller) writes.current = null;
      if (alive.current) setBusy(false);
    }
  };
  const receiveCommand = (result: SourceCommand) => {
    if (!alive.current) return;
    if (active.has(result.status) && result.operationId) {
      setPending(result);
      setNotice("修改已排队，等待工程服务保存与同步。关闭面板不会取消操作。");
    } else complete(result);
  };
  const save = () => {
    if (!currentFile || !draft || !currentIndex) return;
    const snapshot = draft;
    void command(
      `patch:${snapshot.base.revision}:${snapshot.base.path}:${snapshot.content}`,
      async (key, signal) => {
        const result = await patchProjectSource(
          projectId,
          snapshot.base.revision,
          key,
          snapshot.base,
          snapshot.content,
          signal
        );
        if (signal.aborted) return;
        savedDraft.current = {
          path: snapshot.base.path,
          content: snapshot.content,
        };
        receiveCommand(result);
      }
    );
  };
  const restore = (targetRevision: string) => {
    const expected = history?.currentRevision ?? currentIndex?.currentRevision;
    if (!expected) return;
    void command(
      `restore:${expected}:${targetRevision}`,
      async (key, signal) => {
        const result = await restoreProjectRevision(
          projectId,
          expected,
          targetRevision,
          key,
          signal
        );
        if (!signal.aborted) {
          setConfirmRestore(null);
          receiveCommand(result);
        }
      }
    );
  };
  const download = (revision: string) =>
    void command(`export:${revision}`, async (_, signal) => {
      const blob = await exportProjectRevision(projectId, revision, signal);
      if (signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `whybuddy-project-${revision.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        "源码导出已开始；导出包含运行说明，不包含业务数据库和秘密配置。"
      );
    });
  const duplicate = (revision: string) =>
    void command(`fork:${revision}`, async (key, signal) => {
      const result = await forkProjectRevision(
        projectId,
        revision,
        key,
        signal
      );
      if (signal.aborted) return;
      setFork(result);
      setNotice(
        "已复刻为新工程。业务数据库和秘密配置不复制，新会话批准后才能运行。"
      );
    });
  const locked = busy || Boolean(pending);
  return (
    <section
      data-testid="project-workspace-panel"
      aria-label="工程源码与版本"
      className="flex min-h-0 flex-1 flex-col overflow-auto bg-stone-50 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-stone-600">
          {loading
            ? "正在读取工程源码"
            : currentIndex
              ? `源码版本 ${currentIndex.revision.slice(0, 12)} · ${currentIndex.files.length} 个文件`
              : "工程源码暂不可用"}
        </p>
        <button
          className={buttonClass}
          type="button"
          disabled={locked || loading}
          onClick={() => {
            setRevisionOverride(null);
            setRefresh(value => value + 1);
          }}
        >
          读取最新版
        </button>
        {currentIndex ? (
          <>
            <button
              className={buttonClass}
              type="button"
              disabled={locked}
              onClick={() => download(currentIndex.revision)}
            >
              导出源码
            </button>
            <button
              className={buttonClass}
              type="button"
              disabled={locked}
              onClick={() => duplicate(currentIndex.revision)}
            >
              复刻工程
            </button>
          </>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="mb-2 text-xs leading-5 text-stone-600">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-2 text-xs leading-5 text-amber-800">
          {error}
        </p>
      ) : null}
      {fork ? (
        <a
          className="mb-2 text-xs underline"
          href="/agent-loop/sliderule"
          onClick={() => activateSession(fork.sessionId)}
        >
          打开复刻后的会话
        </a>
      ) : null}
      {tab === "source" ? (
        <div className="flex min-h-64 flex-1 flex-col gap-3 md:flex-row">
          <nav
            aria-label="工程文件"
            className="max-h-36 shrink-0 overflow-auto rounded border border-stone-200 bg-white md:max-h-none md:w-44"
          >
            {currentIndex?.files.map(row => (
              <button
                key={row.path}
                type="button"
                onClick={() => setPath(row.path)}
                aria-current={row.path === path ? "true" : undefined}
                className={`block w-full break-all px-3 py-2 text-left font-mono text-xs ${row.path === path ? "bg-stone-200" : "hover:bg-stone-100"}`}
              >
                {row.path}
                {drafts[row.path] &&
                drafts[row.path].content !== drafts[row.path].base.content
                  ? " *"
                  : ""}
              </button>
            ))}
          </nav>
          <div className="flex min-h-64 min-w-0 flex-1 flex-col gap-2">
            {currentFile ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor={`source-${projectId}`}
                    className="min-w-0 flex-1 break-all font-mono text-xs"
                  >
                    {currentFile.path}
                  </label>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={
                      !dirty ||
                      locked ||
                      staleDraft ||
                      conflict ||
                      currentIndex?.revision !== currentIndex?.currentRevision
                    }
                    onClick={save}
                  >
                    保存源码
                  </button>
                </div>
                {currentIndex?.revision !== currentIndex?.currentRevision ? (
                  <p className="text-xs text-amber-800">
                    正在查看历史版本。可导出、复刻或在版本列表中恢复。
                  </p>
                ) : null}
                {staleDraft ? (
                  <div className="text-xs leading-5 text-amber-800">
                    <p>
                      草稿基于旧版本。下方保留你的内容；请先查看服务端源码并合并差异。
                    </p>
                    <details>
                      <summary>查看最新版源码</summary>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap bg-white p-2">
                        {currentFile.content}
                      </pre>
                    </details>
                    <button
                      className={buttonClass}
                      type="button"
                      onClick={() => {
                        setDrafts(prior => ({
                          ...prior,
                          [path]: { base: currentFile, content },
                        }));
                        setConflict(false);
                        setError(null);
                      }}
                    >
                      已核对差异，以最新版为保存基础
                    </button>
                  </div>
                ) : null}
                {conflict && !staleDraft ? (
                  <p className="text-xs text-amber-800">
                    点击「读取最新版」核对版本与批准状态，草稿会保留。
                  </p>
                ) : null}
                <textarea
                  ref={textarea}
                  id={`source-${projectId}`}
                  data-testid="project-source-editor"
                  value={content}
                  spellCheck={false}
                  wrap="off"
                  onChange={event =>
                    setDrafts(prior => ({
                      ...prior,
                      [path]: {
                        base: prior[path]?.base ?? currentFile,
                        content: event.target.value,
                      },
                    }))
                  }
                  className="min-h-64 flex-1 resize-y rounded border border-stone-300 bg-white p-3 font-mono text-xs leading-5 outline-none focus:border-stone-600"
                />
              </>
            ) : (
              <p className="text-xs text-stone-500">
                {path ? "正在读取文件…" : "选择一个工程文件查看源码。"}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2" aria-busy={historyLoading}>
          {historyLoading ? (
            <p role="status" className="text-xs leading-5 text-stone-600">
              正在读取版本记录…
            </p>
          ) : null}
          {historyError ? (
            <p role="alert" className="text-xs leading-5 text-amber-800">
              版本记录读取失败：{historyError} 请点击「读取最新版」重试。
            </p>
          ) : null}
          {!historyLoading &&
          !historyError &&
          history?.revisions.length === 0 ? (
            <p className="text-xs leading-5 text-stone-600">
              暂无已保存的源码版本。
            </p>
          ) : null}
          {history?.revisions.map(row => (
            <div
              key={row.revision}
              className="rounded border border-stone-200 bg-white p-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 break-all font-mono">
                  {row.revision}
                  {row.revision === history.currentRevision
                    ? " · 当前版本"
                    : ""}
                </p>
                <button
                  className={buttonClass}
                  disabled={locked}
                  onClick={() => download(row.revision)}
                >
                  导出此版本
                </button>
                <button
                  className={buttonClass}
                  disabled={locked}
                  onClick={() => duplicate(row.revision)}
                >
                  复刻此版本
                </button>
                <button
                  className={buttonClass}
                  disabled={locked || row.revision === history.currentRevision}
                  onClick={() => setConfirmRestore(row.revision)}
                >
                  恢复此版本
                </button>
              </div>
              <p className="mt-1 text-stone-500">
                {row.createdAt} · {row.templateVersion}
              </p>
              {confirmRestore === row.revision ? (
                <div className="mt-2">
                  <p className="mb-2">
                    将此版本的源码恢复为新版本，保留历史。业务数据不会随源码回退，旧检查记录需要重新验证。
                  </p>
                  <button
                    className={buttonClass}
                    disabled={locked}
                    onClick={() => restore(row.revision)}
                  >
                    确认恢复源码
                  </button>
                  <button
                    className={buttonClass}
                    disabled={locked}
                    onClick={() => setConfirmRestore(null)}
                  >
                    取消
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {history?.nextCursor ? (
            <button
              className={buttonClass}
              disabled={locked}
              onClick={() =>
                void command(
                  `history:${history.nextCursor}`,
                  async (_, signal) => {
                    const next = await getProjectRevisions(
                      projectId,
                      history.nextCursor,
                      signal
                    );
                    if (!signal.aborted)
                      setHistory(prior => ({
                        ...next,
                        revisions: [
                          ...(prior?.revisions ?? []),
                          ...next.revisions,
                        ].filter(
                          (row, index, all) =>
                            all.findIndex(
                              item => item.revision === row.revision
                            ) === index
                        ),
                      }));
                  }
                )
              }
            >
              加载更多版本
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
