/**
 * PhoneSeedNotice — 手机档「这一页显示的是示例数据」的如实标注。
 *
 * 桌面档这条标注是页卡标题栏上的一个 antd Tag；手机档没有标题栏的位置，
 * 此前是**手搓的一个橙字小方块**——颜色、圆角、内边距全是硬编码，跟旁边
 * antd-mobile 的组件不是一套观感，也没有"可关闭"这种通告栏该有的行为。
 *
 * NoticeBar 就是这个场景的组件：`color='alert'` 是提醒档（黄底），左侧自带
 * 喇叭图标，内容超宽会自己跑马灯。放在内容区最上面一条，跟官方示例一致。
 *
 * 单独成文件是为了走 React.lazy——AppRuntimeScreen 在主包里，直接 import
 * antd-mobile 会把整个移动端库拖进主 bundle（其余 phone-mobile/* 全是这么
 * 拆的，见 AppRuntimeScreen 顶部那一排 LazyPhoneXxx）。
 */

import React from "react";
import { NoticeBar } from "antd-mobile";

export interface PhoneSeedNoticeProps {
  /** 本页种子行数 */
  count: number;
}

/**
 * 文案必须短到**一屏放得下**。
 *
 * NoticeBar 的内容超出宽度会自动跑马灯滚动——那是给"系统公告"这类长文准备的
 * 行为，用在一条常驻状态标注上就是一行永远在动的字，很吵。桌面档那句原文
 * 「示例数据 · N 条，点「新建」写入第一条真实记录后即被取代」直接搬过来
 * 实测溢出 115px（内容区 294px，文字 409px），真机截图上两帧的文字位置都不同。
 *
 * 量过：390px 手机、15px 字号下，这条内容区放得下约 19 个中文字。下面这句
 * 连数字带标点约 17 个，不触发滚动。改文案时记得这条上限。
 */
export default function PhoneSeedNotice({ count }: PhoneSeedNoticeProps) {
  return (
    <NoticeBar
      data-testid="phone-seed-notice"
      color="alert"
      // 不给 closeable：这条标注的意义就是"你现在看到的数字不是真的"，
      // 让用户一键关掉等于允许他在不知情的状态下继续看假数据。
      content={`示例数据 ${count} 条 · 写入真实记录后取代`}
    />
  );
}
