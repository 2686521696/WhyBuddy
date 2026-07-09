import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast as sonnerToast } from "sonner";

export type ToastLevel = "info" | "warn" | "error";

export interface ToastPayload {
  key: string;
  level: ToastLevel;
  message: string;
}

export interface QueuedToast extends ToastPayload {
  enqueuedAt: number;
}

export interface ToastQueueSnapshot {
  visible: QueuedToast | null;
  pending: QueuedToast[];
}

export interface ToastQueue {
  enqueue(toast: ToastPayload): QueuedToast;
  dismissVisible(): QueuedToast | null;
  peekVisible(): QueuedToast | null;
  getPending(): QueuedToast[];
  getSnapshot(): ToastQueueSnapshot;
  subscribe(listener: () => void): () => void;
  clear(): void;
}

export interface ToastRenderer {
  show(toast: QueuedToast): string | number | undefined;
  dismiss(id: string | number | undefined): void;
}

export interface UseToastQueueOptions {
  renderer?: ToastRenderer;
}

const TOAST_PRIORITY: Record<ToastLevel, number> = {
  error: 3,
  warn: 2,
  info: 1,
};

function cloneToast(toast: QueuedToast): QueuedToast {
  return { ...toast };
}

function compareQueuedToasts(left: QueuedToast, right: QueuedToast): number {
  const priorityDelta =
    TOAST_PRIORITY[right.level] - TOAST_PRIORITY[left.level];
  if (priorityDelta !== 0) return priorityDelta;
  return left.enqueuedAt - right.enqueuedAt;
}

export function createToastQueue(): ToastQueue {
  const items: QueuedToast[] = [];
  const listeners = new Set<() => void>();
  let sequence = 0;
  let snapshot: ToastQueueSnapshot = {
    visible: null,
    pending: [],
  };

  function buildSnapshot(): ToastQueueSnapshot {
    return {
      visible: items.length > 0 ? cloneToast(items[0]) : null,
      pending: items.slice(1).map(cloneToast),
    };
  }

  function emit() {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  function sortItems() {
    items.sort(compareQueuedToasts);
  }

  function enqueue(toast: ToastPayload): QueuedToast {
    const existingIndex = items.findIndex(item => item.key === toast.key);
    const enqueuedAt =
      existingIndex >= 0 ? items[existingIndex].enqueuedAt : ++sequence;
    const nextToast: QueuedToast = {
      ...toast,
      enqueuedAt,
    };

    if (existingIndex >= 0) {
      items[existingIndex] = nextToast;
    } else {
      items.push(nextToast);
    }

    sortItems();
    emit();
    return cloneToast(items[0]);
  }

  function dismissVisible(): QueuedToast | null {
    if (items.length === 0) return null;
    const [visible] = items.splice(0, 1);
    emit();
    return cloneToast(visible);
  }

  function peekVisible(): QueuedToast | null {
    return items.length > 0 ? cloneToast(items[0]) : null;
  }

  function getPending(): QueuedToast[] {
    return items.slice(1).map(cloneToast);
  }

  function getSnapshot(): ToastQueueSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function clear() {
    items.length = 0;
    emit();
  }

  return {
    enqueue,
    dismissVisible,
    peekVisible,
    getPending,
    getSnapshot,
    subscribe,
    clear,
  };
}

type SonnerToastApi = {
  (message: string): string | number;
  info?: (message: string) => string | number;
  warning?: (message: string) => string | number;
  error?: (message: string) => string | number;
  dismiss?: (id?: string | number) => void;
};

export function createSonnerToastRenderer(
  api: SonnerToastApi = sonnerToast as unknown as SonnerToastApi
): ToastRenderer {
  return {
    show(toast) {
      if (toast.level === "error" && api.error) return api.error(toast.message);
      if (toast.level === "warn" && api.warning)
        return api.warning(toast.message);
      if (toast.level === "info" && api.info) return api.info(toast.message);
      return api(toast.message);
    },
    dismiss(id) {
      if (id === undefined) return;
      api.dismiss?.(id);
    },
  };
}

const defaultToastRenderer: ToastRenderer = createSonnerToastRenderer();

export function useToastQueue(options: UseToastQueueOptions = {}) {
  const queue = useMemo(() => createToastQueue(), []);
  const renderer = options.renderer ?? defaultToastRenderer;
  const snapshot = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot
  );
  const renderedToastId = useRef<string | number | undefined>(undefined);
  const renderedToastKey = useRef<string | null>(null);

  useEffect(() => {
    const visible = snapshot.visible;
    const visibleKey = visible
      ? `${visible.key}:${visible.enqueuedAt}:${visible.message}`
      : null;

    if (visibleKey === renderedToastKey.current) return;

    renderer.dismiss(renderedToastId.current);
    renderedToastId.current = visible ? renderer.show(visible) : undefined;
    renderedToastKey.current = visibleKey;
  }, [renderer, snapshot.visible]);

  return {
    ...queue,
    snapshot,
    visible: snapshot.visible,
    pending: snapshot.pending,
  };
}
