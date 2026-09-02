/**
 * 当前会话 id 的单一兜底。
 *
 * ⚠ 2026-09-02 真机：新建会话后「社区图书馆」产物写进昨天的诊所会话。
 * 字面量散落 7 处，拿不到 id 的路径全掉进同一个桶。定义只许这一处。
 */
export const DEFAULT_SESSION_ID = "sliderule-v51-product";

export class SessionIdMismatchError extends Error {
  constructor(
    readonly driveSessionId: string,
    readonly shellSessionId: string
  ) {
    super(
      `会话错位：推演 ${driveSessionId} ≠ 当前 ${shellSessionId}，拒绝点火`
    );
    this.name = "SessionIdMismatchError";
  }
}

/** 点火前：消息落库的会话必须等于本次推演的会话。不等就拒绝，不许静默择一。 */
export function assertDriveSessionMatchesShell(
  driveSessionId: string | null | undefined,
  shellSessionId: string | null | undefined
): string {
  const shell = String(shellSessionId || "").trim();
  if (!shell) {
    throw new SessionIdMismatchError("", "");
  }
  const drive = String(driveSessionId || "").trim();
  if (drive && drive !== shell) {
    throw new SessionIdMismatchError(drive, shell);
  }
  return shell;
}
