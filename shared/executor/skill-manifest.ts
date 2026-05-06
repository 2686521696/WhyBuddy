import { z } from "zod";

import {
  EXECUTOR_CAPABILITY_SET,
  type ExecutorCapability,
} from "./contracts.js";

export const SANDBOX_SKILL_RUNTIMES = ["node", "python", "bash"] as const;
export type SandboxSkillRuntime = (typeof SANDBOX_SKILL_RUNTIMES)[number];

export const SANDBOX_SKILL_NETWORK_MODES = [
  "none",
  "optional",
  "required",
] as const;
export type SandboxSkillNetworkMode =
  (typeof SANDBOX_SKILL_NETWORK_MODES)[number];

export const SANDBOX_SKILL_FILESYSTEM_MODES = [
  "readonly",
  "workspace",
  "workspace-write",
] as const;
export type SandboxSkillFilesystemMode =
  (typeof SANDBOX_SKILL_FILESYSTEM_MODES)[number];

export interface SandboxSkillManifest {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  capabilities: ExecutorCapability[];
  runtime: SandboxSkillRuntime;
  entrypoint: string;
  dependencies: string[];
  inputs: {
    schema?: string;
    examples?: string[];
  };
  outputs: {
    artifacts: string[];
    previewTypes: Array<"text" | "json" | "html" | "pdf" | "image" | "log">;
  };
  artifactRules: Array<{
    pattern: string;
    mimeType?: string;
    previewType?: "text" | "json" | "html" | "pdf" | "image" | "log";
  }>;
  security: {
    network: SandboxSkillNetworkMode;
    filesystem: SandboxSkillFilesystemMode;
    browser: boolean;
    credentials: string[];
  };
}

export interface SandboxSkillRef {
  name: string;
  version?: string;
}

export interface SandboxSkillJobPayload {
  skillRef?: SandboxSkillRef;
  skillInput?: Record<string, unknown>;
  skillPolicy?: {
    allowNetwork?: boolean;
    allowCredentials?: boolean;
    allowFilesystemWrite?: boolean;
    autoSelect?: boolean;
  };
}

export interface SandboxSkillValidationResult {
  ok: boolean;
  manifest?: SandboxSkillManifest;
  errors: string[];
}

const nameSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    "name must use lowercase letters, numbers, dot, underscore, or dash",
  );

const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "version must follow semver format X.Y.Z");

const relativePathSchema = z
  .string()
  .min(1)
  .refine(value => !value.includes(".."), "path traversal is not allowed")
  .refine(value => !/^[a-zA-Z]:[\\/]/.test(value), "absolute paths are not allowed")
  .refine(value => !value.startsWith("/") && !value.startsWith("\\"), "absolute paths are not allowed");

const capabilitySchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    if (!EXECUTOR_CAPABILITY_SET.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown capability "${value}"`,
      });
    }
  })
  .transform(value => value as ExecutorCapability);

const previewTypeSchema = z.enum(["text", "json", "html", "pdf", "image", "log"]);

export const sandboxSkillManifestSchema = z
  .object({
    name: nameSchema,
    version: semverSchema,
    description: z.string().min(1),
    enabled: z.boolean().default(true),
    capabilities: z.array(capabilitySchema).min(1),
    runtime: z.enum(SANDBOX_SKILL_RUNTIMES),
    entrypoint: relativePathSchema,
    dependencies: z.array(z.string().min(1)).default([]),
    inputs: z
      .object({
        schema: relativePathSchema.optional(),
        examples: z.array(relativePathSchema).default([]),
      })
      .default({ examples: [] }),
    outputs: z
      .object({
        artifacts: z.array(z.string().min(1)).default([]),
        previewTypes: z.array(previewTypeSchema).default([]),
      })
      .default({ artifacts: [], previewTypes: [] }),
    artifactRules: z
      .array(
        z.object({
          pattern: z.string().min(1),
          mimeType: z.string().min(1).optional(),
          previewType: previewTypeSchema.optional(),
        }),
      )
      .default([]),
    security: z
      .object({
        network: z.enum(SANDBOX_SKILL_NETWORK_MODES).default("none"),
        filesystem: z.enum(SANDBOX_SKILL_FILESYSTEM_MODES).default("workspace"),
        browser: z.boolean().default(false),
        credentials: z.array(z.string().min(1)).default([]),
      })
      .default({
        network: "none",
        filesystem: "workspace",
        browser: false,
        credentials: [],
      }),
  })
  .strict();

export function validateSandboxSkillManifest(
  input: unknown,
): SandboxSkillValidationResult {
  const parsed = sandboxSkillManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(issue => {
        const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      }),
    };
  }

  return {
    ok: true,
    manifest: parsed.data,
    errors: [],
  };
}
