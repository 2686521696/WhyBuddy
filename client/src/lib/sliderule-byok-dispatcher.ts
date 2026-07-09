/**
 * B6 · key 池调度器与并发推演。
 *
 * 浏览器端把同轮并行能力分发到多 key。
 * 受 maxInFlight、dispatch 策略、退避约束。
 *
 * 租约模式：provider acquire → 执行 → release (带 outcome)
 * 成本诚实：raceMode 默认 false（用户自己的钱，不默认并发烧多 key）。
 *
 * 确定性：只影响哪把 key 执行，不影响 STATE commit 顺序（plan 序保证）。
 */

import type { ByokKeyEntry, ByokPoolConfig } from "./sliderule-byok-config";
import { loadByokPool } from "./sliderule-byok-config";

export interface ByokLease {
  entry: ByokKeyEntry;
  leaseId: string;
}

export interface PoolSnapshot {
  entries: Array<{
    id: string;
    label: string;
    inFlight: number;
    totalTokens: number;
    cooledUntil: number | null;
    enabled: boolean;
  }>;
}

type Outcome = "ok" | "http_429" | "http_401" | "error";

interface KeyState {
  entry: ByokKeyEntry;
  inFlight: number;
  totalTokens: number;
  cooledUntil: number | null;
  failures: number;
}

export interface ByokPoolDispatcher {
  acquire(): Promise<ByokLease>;
  release(lease: ByokLease, outcome: Outcome): void;
  snapshot(): PoolSnapshot;
}

let sharedDispatcher: ByokPoolDispatcher | null = null;

export function getByokDispatcher(): ByokPoolDispatcher {
  if (!sharedDispatcher) {
    sharedDispatcher = createByokDispatcherInternal();
  }
  return sharedDispatcher;
}

function createByokDispatcherInternal(initialConfig?: ByokPoolConfig): ByokPoolDispatcher {
  const config = initialConfig || loadByokPool() || { version: 1, entries: [], dispatch: "least-busy", raceMode: false };
  const states: Record<string, KeyState> = {};
  for (const e of config.entries) {
    if (e.enabled) {
      states[e.id] = {
        entry: e,
        inFlight: 0,
        totalTokens: 0,
        cooledUntil: null,
        failures: 0,
      };
    }
  }

  let leaseCounter = 0;

  function getAvailable(): KeyState[] {
    const now = Date.now();
    return Object.values(states).filter(s => s.entry.enabled && (s.cooledUntil === null || s.cooledUntil <= now) && s.inFlight < (s.entry.maxInFlight || 2));
  }

  function pickLeastBusy(): KeyState | null {
    const avail = getAvailable();
    if (avail.length === 0) return null;
    return avail.reduce((best, cur) => cur.inFlight < best.inFlight ? cur : best);
  }

  function pickRoundRobin(): KeyState | null {
    const avail = getAvailable();
    if (avail.length === 0) return null;
    // simple counter based
    leaseCounter = (leaseCounter + 1) % avail.length;
    return avail[leaseCounter];
  }

  return {
    async acquire(): Promise<ByokLease> {
      const now = Date.now();
      let picked: KeyState | null = null;
      if (config.dispatch === "round-robin") {
        picked = pickRoundRobin();
      } else {
        picked = pickLeastBusy();
      }
      if (!picked) {
        // try to wait a bit for cooldown? for simplicity, reject to trigger fallback
        throw new Error("all keys busy or cooling (exhaustion)");
      }
      picked.inFlight++;
      const leaseId = `lease-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return { entry: picked.entry, leaseId };
    },

    release(lease: ByokLease, outcome: Outcome) {
      const st = states[lease.entry.id];
      if (!st) return;
      st.inFlight = Math.max(0, st.inFlight - 1);
      if (outcome === "ok") {
        st.failures = 0;
        // token count would be updated by provider after success with usage
      } else if (outcome === "http_429") {
        const cool = Math.min(60000, 5000 * Math.pow(2, st.failures));
        st.cooledUntil = Date.now() + cool;
        st.failures++;
      } else if (outcome === "http_401") {
        st.entry.enabled = false; // mark invalid, UI will prompt reconfig
      } else {
        st.failures++;
        if (st.failures >= 3) {
          st.cooledUntil = Date.now() + 30000;
        }
      }
    },

    snapshot(): PoolSnapshot {
      return {
        entries: Object.values(states).map(s => ({
          id: s.entry.id,
          label: s.entry.label,
          inFlight: s.inFlight,
          totalTokens: s.totalTokens,
          cooledUntil: s.cooledUntil,
          enabled: s.entry.enabled,
        })),
      };
    },
  };
}

// helper to record usage after success (called by provider)
export function recordUsageOnLease(dispatcher: ByokPoolDispatcher, lease: ByokLease, tokens: number) {
  // since internal state, for demo we can expose or just note in snapshot via provider
  // for real, dispatcher would have internal update, here we keep simple (tokens updated in provider closure if needed)
}

export function createByokDispatcher(initialConfig?: ByokPoolConfig): ByokPoolDispatcher {
  const d = createByokDispatcherInternal(initialConfig);
  sharedDispatcher = d;
  return d;
}
