/**
 * Shared opaque id helper for server-side modules.
 *
 * Exposes a single pure function, {@link createId}, returning
 * `${prefix}-${randomUUID()}`. Used by Blueprint sub-domain modules
 * (e.g. `server/routes/blueprint/effect-preview/normalize.ts`) that
 * need to backfill stable ids without re-implementing the same helper
 * locally or pulling in the much larger `server/routes/blueprint.ts`
 * module-level helper.
 *
 * Determinism note: tests that need predictable ids should inject their
 * own id generator at the call site; this helper is intentionally
 * non-deterministic so the same input never collides across invocations.
 */

import { randomUUID } from "node:crypto";

/**
 * Build an opaque, collision-resistant identifier prefixed with the
 * caller-supplied `prefix` (e.g. `"blueprint-effect-preview-log"`).
 *
 * The `${prefix}-${randomUUID()}` shape matches the pre-existing
 * helpers in `server/routes/blueprint.ts` and
 * `server/routes/blueprint/agent-crew-stage-activation/driver.ts`, so
 * downstream consumers that grep for the prefix continue to work
 * unchanged.
 */
export function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
