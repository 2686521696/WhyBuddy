// Generated from models/project_runtime.py. Run pnpm run project:contracts:emit.

export type ManifestFile = {
  "path": string;
  "sha256": string;
  "sizeBytes": number;
};

export type Project = {
  "projectId": string;
  "sessionId": string;
  "ownerId": string;
  "runtimeKind"?: "project";
  "currentRevision": string;
  "createdAt": string;
  "updatedAt": string;
  "revisionCount"?: number;
  "sourceBytesStored"?: number;
};

export type ProjectManifest = {
  "schemaVersion"?: 1;
  "treeHash": string;
  "totalBytes": number;
  "files": Array<ManifestFile>;
};

export type ProjectOperation = {
  "operationId": string;
  "projectId": string;
  "sessionId": string;
  "kind": string;
  "idempotencyKey": string;
  "requestHash": string;
  "expectedRevision": string;
  "approvalRef": string;
  "status"?: "queued" | "running" | "waiting_user" | "completed" | "failed" | "cancelling" | "cancelled" | "interrupted";
  "input"?: {
  [key: string]: unknown;
};
  "result"?: {
  [key: string]: unknown;
} | null;
  "leaseGeneration"?: number | null;
  "leaseOwner"?: string | null;
  "createdAt": string;
  "updatedAt": string;
};

export type ProjectRevision = {
  "revision": string;
  "projectId": string;
  "parentRevision"?: string | null;
  "treeHash": string;
  "manifest": ProjectManifest;
  "templateVersion": string;
  "planRef": string;
  "specRevision"?: string | null;
  "createdAt": string;
};

export type RuntimeEvent = {
  "schemaVersion"?: 1;
  "eventId": string;
  "sessionId": string;
  "projectId": string;
  "operationId": string;
  "seq": number;
  "type": string;
  "timestamp": string;
  "payload"?: {
  [key: string]: unknown;
};
};

export type WorkspaceLease = {
  "workspaceId": string;
  "projectId": string;
  "generation": number;
  "leaseOwner": string;
  "expiresAt": number;
  "sandboxId"?: string | null;
  "mountedRevision"?: string | null;
  "provider"?: "e2b";
  "processRefs"?: {
  [key: string]: unknown;
};
};
