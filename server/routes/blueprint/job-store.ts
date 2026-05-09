/**
 * Blueprint job-store factories extracted from `server/routes/blueprint.ts`
 * to break a circular value import with `context.ts`.
 *
 * `blueprint.ts` imports `buildBlueprintServiceContext` from `context.ts`,
 * which in turn needs the file-backed default job store. Keeping the
 * factories here makes `context.ts` independent of the router file, so
 * module evaluation order stays deterministic.
 *
 * The public `blueprint.ts` API still re-exports `BlueprintJobStore`,
 * `createFileBlueprintJobStore` and `createMemoryBlueprintJobStore` so
 * existing callers (tests / clients) can keep importing from the router
 * file. See `server/routes/blueprint.ts` for the re-export line.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { BlueprintGenerationJob } from "../../../shared/blueprint/index.js";

export interface BlueprintJobStore {
  list(): BlueprintGenerationJob[];
  get(jobId: string): BlueprintGenerationJob | null;
  save(job: BlueprintGenerationJob): void;
  latest(): BlueprintGenerationJob | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlueprintGenerationJob(
  value: unknown,
): value is BlueprintGenerationJob {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string"
  );
}

export function createMemoryBlueprintJobStore(
  initialJobs: BlueprintGenerationJob[] = [],
): BlueprintJobStore {
  const jobs = new Map<string, BlueprintGenerationJob>(
    initialJobs.map((job) => [job.id, job]),
  );
  return {
    list() {
      return [...jobs.values()].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
    },
    get(jobId) {
      return jobs.get(jobId) ?? null;
    },
    save(job) {
      jobs.set(job.id, job);
    },
    latest() {
      return this.list()[0] ?? null;
    },
  };
}

export function createFileBlueprintJobStore(
  storageFile = path.resolve(".kiro/blueprint-assets/jobs.json"),
): BlueprintJobStore {
  const resolvedStorageFile = path.resolve(storageFile);

  const readJobs = (): BlueprintGenerationJob[] => {
    if (!existsSync(resolvedStorageFile)) {
      return [];
    }
    try {
      const raw = readFileSync(resolvedStorageFile, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const records = Array.isArray(parsed)
        ? parsed
        : isPlainRecord(parsed) && Array.isArray(parsed.jobs)
          ? parsed.jobs
          : [];
      return records.filter(isBlueprintGenerationJob);
    } catch {
      return [];
    }
  };

  const writeJobs = (jobs: BlueprintGenerationJob[]): void => {
    mkdirSync(path.dirname(resolvedStorageFile), { recursive: true });
    writeFileSync(
      resolvedStorageFile,
      JSON.stringify(
        {
          version: "blueprint-job-store/v1",
          updatedAt: new Date().toISOString(),
          jobs,
        },
        null,
        2,
      ),
      "utf8",
    );
  };

  return {
    list() {
      return readJobs().sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
    },
    get(jobId) {
      return readJobs().find((job) => job.id === jobId) ?? null;
    },
    save(job) {
      const jobs = readJobs();
      const nextJobs = jobs.some((item) => item.id === job.id)
        ? jobs.map((item) => (item.id === job.id ? job : item))
        : jobs.concat(job);
      writeJobs(nextJobs);
    },
    latest() {
      return this.list()[0] ?? null;
    },
  };
}
