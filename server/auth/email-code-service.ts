import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import { normalizeAuthEmail } from "../../shared/auth.js";

export interface EmailCodeMailer {
  sendLoginCode(input: {
    email: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<void>;
}

export interface EmailCodeService {
  readonly ttlSeconds: number;
  now(): Date;
  generateCode(): string;
  hashCode(email: string, code: string): string;
  verifyCodeHash(email: string, code: string, expectedHash: string): boolean;
  expiresAt(now?: Date): Date;
  sendLoginCode(input: {
    email: string;
    code: string;
  }): Promise<void>;
}

export function createEmailCodeService(options: {
  mailer: EmailCodeMailer;
  ttlSeconds?: number;
  pepper?: string;
  now?: () => Date;
}): EmailCodeService {
  // node-owned real mailer boundary retained for token-mailer-session cutover 101
  const ttlSeconds = Math.max(60, Math.floor(options.ttlSeconds ?? 10 * 60));
  const pepper = options.pepper ?? process.env.EMAIL_CODE_PEPPER ?? "";
  const now = options.now ?? (() => new Date());

  function material(email: string, code: string): string {
    return `${normalizeAuthEmail(email)}:${code.trim()}:${pepper}`;
  }

  return {
    ttlSeconds,

    now,

    generateCode() {
      return String(randomInt(0, 1_000_000)).padStart(6, "0");
    },

    hashCode(email, code) {
      return createHash("sha256").update(material(email, code)).digest("hex");
    },

    verifyCodeHash(email, code, expectedHash) {
      const actual = Buffer.from(this.hashCode(email, code), "hex");
      const expected = Buffer.from(expectedHash, "hex");
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    },

    expiresAt(baseNow = now()) {
      return new Date(baseNow.getTime() + ttlSeconds * 1000);
    },

    async sendLoginCode(input) {
      await options.mailer.sendLoginCode({
        email: input.email,
        code: input.code,
        expiresInMinutes: Math.ceil(ttlSeconds / 60),
      });
    },
  };
}
