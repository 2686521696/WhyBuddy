/**
 * PhoneDetailSections — 详情面板的次级分区（antd-mobile Collapse）。
 *
 * 详情内容（detailBody）是**跨设备共用**的一段 JSX：字段部分早就按设备分档
 * （手机 antd-mobile List / 桌面 antd Descriptions），但下面的「AI 能力」
 * 和「关联审批实例」两段一直是共用的手写小标题。
 *
 * 2026-07-29 把那两段收进 Collapse 时，第一版**只换了桌面的**——结果 antd 的
 * Collapse 被渲染进了 antd-mobile 的 Popup 里，成了新的跨库混用。分区的壳
 * 必须跟字段部分一样分档：这个文件是手机那一档。
 *
 * 两边的 API 形状不同，故意不做统一抽象：
 * - antd:        `<Collapse items={[{key,label,children}]} ghost />`
 * - antd-mobile: `<Collapse><Collapse.Panel key title>…</Collapse.Panel></Collapse>`
 * 抹平成一套自定义 props 等于又造一个组件；这里只把两侧共用的**数据**
 *（key/title/内容节点）传进来，各自用各自库的写法渲染。
 */

import React from "react";
import { Collapse } from "antd-mobile";

export interface PhoneDetailSection {
  key: string;
  /** 分区标题（含计数，如「AI 能力 · 2」） */
  title: React.ReactNode;
  content: React.ReactNode;
}

export default function PhoneDetailSections({
  sections,
}: {
  sections: PhoneDetailSection[];
}) {
  return (
    <Collapse
      data-testid="phone-detail-sections"
      // 全部默认展开：这次只换分组的壳，不改「打开详情能看到什么」。
      // 想收起来的人有开关了，不想动的人看到的跟以前一样。
      defaultActiveKey={sections.map(s => s.key)}
    >
      {sections.map(s => (
        <Collapse.Panel key={s.key} title={s.title}>
          {s.content}
        </Collapse.Panel>
      ))}
    </Collapse>
  );
}
