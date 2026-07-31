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

import { message as staticMessage } from "antd";
import type { MessageInstance } from "antd/es/message/interface";

export type FeedbackKind = "success" | "warning" | "info" | "error";

/**
 * 桌面档的 message 实例。
 *
 * antd v5 的静态 `message.xxx()` 拿不到 ConfigProvider 的上下文，控制台会警告
 * 「Static function can not consume context like dynamic theme」——运行应用的
 * 主题（身份主色 / 深色档 / 紧凑档 / 圆角配方）全都下发不到提示条上，
 * 琥珀色的应用弹出来的还是默认蓝。调用方用 `message.useMessage()` 拿到
 * 带上下文的实例传进来即可；不传时退回静态调用（提示总比没有强）。
 */
export type MessageApi = Pick<MessageInstance, FeedbackKind>;

/**
 * 手机档：Toast；桌面档：message。同一套调用点，形态按设备分。
 *
 * getContainer：手机档是在一个缩放过的画布里预览的，Toast 默认 portal 到
 * document.body——提示会飘到整个浏览器窗口中央，压根不在手机框里，用户在
 * 手机预览里什么也看不到（真机验证过：Toast 节点存在，画面上找不到）。
 * 传入画布元素后提示落在框内，跟真机形态一致。
 */
export function notify(
  isPhone: boolean,
  kind: FeedbackKind,
  content: string,
  getContainer?: () => HTMLElement | null,
  messageApi?: MessageApi
): void {
  const desktop = messageApi ?? staticMessage;
  if (!isPhone) {
    desktop[kind](content);
    return;
  }
  void import("antd-mobile").then(({ Toast }) => {
    Toast.show({
      content,
      getContainer: getContainer ? () => getContainer() ?? document.body : undefined,
      // Toast 没有 warning/error 的语义档，用图标区分：出错给感叹号，
      // 成功给对勾，其余不给图标（纯文字提示）。
      icon: kind === "success" ? "success" : kind === "error" || kind === "warning" ? "fail" : undefined,
      position: "center",
    });
  }).catch(() => {
    // chunk 拉不下来也得让用户看见提示——退回桌面档的 message，不静默吞掉
    desktop[kind](content);
  });
}

/**
 * 手机档的破坏性操作确认（2026-07-29）。
 *
 * 桌面档的删除早就套了 Popconfirm，手机档一直是**左滑出按钮、一点就没了，
 * 连提示都不给**。当时留的理由是「滑动本身已经是不会误触的确认动作」——
 * 站不住：滑开之后那个红按钮就贴在拇指底下，误触比桌面还容易，而且删完
 * 界面上一点反馈都没有，用户不确定是删掉了还是没点中。
 *
 * antd-mobile 的标准解是 `Dialog.confirm`，它返回 `Promise<boolean>`
 *（confirm.tsx 里 `new Promise<boolean>` + actions 决议），所以调用方可以
 * `if (await confirmDestructive(...))` 这样写，不用自己搭状态机。
 *
 * getContainer 的道理跟 Toast 一样：手机档是在一个缩放过的画布里预览的，
 * 不传的话弹框会盖住整个浏览器窗口，而不是落在手机框里。
 *
 * chunk 拉不下来时**返回 false**（当作用户取消），不是 true——加载失败绝不能
 * 变成"没问确认就把数据删了"。
 */
export async function confirmDestructive(
  title: string,
  description: string,
  getContainer?: () => HTMLElement | null
): Promise<boolean> {
  try {
    const { Dialog } = await import("antd-mobile");
    return await Dialog.confirm({
      title,
      content: description,
      confirmText: "删除",
      cancelText: "取消",
      getContainer: getContainer ? () => getContainer() ?? document.body : undefined,
    });
  } catch {
    return false;
  }
}
