import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { WhyBuddySessionStore } from "./whybuddy-runtime";

/**
 * HttpWhyBuddySessionStore — productionization adapter skeleton.
 *
 * Implements the shared WhyBuddySessionStore contract over HTTP.
 * Talks to the 4 endpoints the user specified:
 *   GET    /api/whybuddy/sessions
 *   GET    /api/whybuddy/sessions/:sessionId
 *   PUT    /api/whybuddy/sessions/:sessionId
 *   DELETE /api/whybuddy/sessions/:sessionId
 *
 * Default base is relative "/api/whybuddy" so that:
 * - In browser (with vite proxy or full server) it just works.
 * - In tests / pure in-mem usage we never instantiate this unless explicitly asked.
 *
 * The server-side implementation (server/routes/whybuddy.ts) is a minimal
 * in-memory Map (no real DB). This is intentional per the "骨架" request.
 *
 * Usage (when you want to opt into remote/persistent for a demo):
 *   import { HttpWhyBuddySessionStore } from "@/lib/whybuddy-http-store";
 *   import { setWhyBuddySessionStore } from "@/lib/whybuddy-runtime";
 *   setWhyBuddySessionStore(new HttpWhyBuddySessionStore());
 *
 * All load/save in the runtime + page are now async, so callers await.
 */
export class HttpWhyBuddySessionStore implements WhyBuddySessionStore {
  private readonly base: string;

  constructor(baseUrl = "/api/whybuddy") {
    // normalize: ensure no trailing slash before we append /sessions...
    this.base = baseUrl.replace(/\/$/, "");
  }

  private url(path: string): string {
    return `${this.base}${path}`;
  }

  async load(sessionId: string): Promise<V5SessionState | undefined> {
    const res = await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}`), {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HttpWhyBuddySessionStore.load failed: ${res.status} ${text}`);
    }
    return (await res.json()) as V5SessionState;
  }

  async save(state: V5SessionState): Promise<V5SessionState> {
    const sid = state.sessionId || "whybuddy-local-proto";
    const res = await fetch(this.url(`/sessions/${encodeURIComponent(sid)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(state),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HttpWhyBuddySessionStore.save failed: ${res.status} ${text}`);
    }
    return (await res.json()) as V5SessionState;
  }

  async listSessions(): Promise<Array<{
    sessionId: string;
    goal: string;
    createdAt?: string;
    lastActive?: string;
    artifactCount: number;
    phase?: string;
  }>> {
    const res = await fetch(this.url(`/sessions`), {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HttpWhyBuddySessionStore.listSessions failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    // Accept both { sessions: [...] } and raw array shapes for flexibility
    return (data && data.sessions ? data.sessions : data) || [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(this.url(`/sessions/${encodeURIComponent(sessionId)}`), {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`HttpWhyBuddySessionStore.deleteSession failed: ${res.status} ${text}`);
    }
  }
}

/**
 * Convenience factory (matches the "createHttp..." naming users expect for adapters).
 */
export function createHttpWhyBuddySessionStore(baseUrl?: string): WhyBuddySessionStore {
  return new HttpWhyBuddySessionStore(baseUrl);
}

export default HttpWhyBuddySessionStore;
