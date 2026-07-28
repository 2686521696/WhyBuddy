/**
 * 轻提示的设备分流：手机档走 antd-mobile Toast，桌面档保持 antd message。
 *
 * 两者形态不同不是细节——antd message 从画布顶部落下、窄条、鼠标一动就走；
 * Toast 是移动端居中的方块提示，手指操作后不看顶部也能瞥见。
 *
 * antd-mobile 只在手机档动态引入（跟 PhonePageList 同一个 chunk），
 * 桌面档不会为此多下一个字节。Toast 是命令式 API，await import 的那一拍
 * 延迟对提示语无所谓（用户不会 100ms 内做下一个动作）。
 */

import { message } from "antd";

export type FeedbackKind = "success" | "warning" | "info" | "error";

/** 手机档：Toast；桌面档：message。同一套调用点，形态按设备分。 */
export function notify(isPhone: boolean, kind: FeedbackKind, content: string): void {
  if (!isPhone) {
    message[kind](content);
    return;
  }
  void import("antd-mobile").then(({ Toast }) => {
    Toast.show({
      content,
      // Toast 没有 warning/error 的语义档，用图标区分：出错给感叹号，
      // 成功给对勾，其余不给图标（纯文字提示）。
      icon: kind === "success" ? "success" : kind === "error" || kind === "warning" ? "fail" : undefined,
      position: "center",
    });
  }).catch(() => {
    // chunk 拉不下来也得让用户看见提示——退回桌面档的 message，不静默吞掉
    message[kind](content);
  });
}
