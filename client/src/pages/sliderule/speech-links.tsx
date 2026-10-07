/**
 * 模型写给用户的链接：哪些能点。收尾 / 纯回答（SessionStory）和问卷题面（QuestionnaireCard）共用这一份。
 */
import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";

/**
 * 收尾里的链接：地址被 react-markdown 默认过滤清空（sandbox: 之类）就画成字。
 *
 * ⚠ 2026-09-25 真机：`[下载…](sandbox:/home/user/…)` 被清成 `href=""`，
 *   仍是一个蓝色可点的链接——点了把当前页整页重载。第一版判据只查
 *   「没有 sandbox: 开头的 href」，空 href 照样放过。
 */
/**
 * ⚠ 2026-10-06 真机 r30 sr-20261006040041-SW8DQG1YC2（@systematic-debugging）：收尾写
 *   `[src/cart.mjs](/home/user/workspace/src/cart.mjs)`——沙盒里的绝对路径不在默认过滤里，画成蓝色链接，
 *   点了在新标签打开本站一个不存在的路由。能点的只有真地址：http(s)、mailto，和后端补的 /api/ 交付链接。
 */
export const CLICKABLE_HREF = /^(?:https?:|mailto:|\/api\/)/i;

export const CLOSING_MARKDOWN: Components = {
  a: ({ href, children }) =>
    href && CLICKABLE_HREF.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

/**
 * 一行字里的链接 / 粗体，不起段落（问卷题面这种行内位置）。
 *
 * ⚠ 2026-10-07 真机 r74 sr-20261007095028-3014GBNNDM（@theme-factory）：模型照技能第 1 步，在问卷里写
 *   「请先查看 [主题展示册](/api/sliderule/skills/theme-factory/files/theme-showcase.pdf)，你希望用哪个主题？」——
 *   题面按纯文本画，用户看到的是一串方括号和地址，点不开；技能最要紧的那一步在最后一厘米断了。
 */
const INLINE_MARKDOWN: Components = {
  ...CLOSING_MARKDOWN,
  p: ({ children }) => <>{children}</>,
};

export function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      components={INLINE_MARKDOWN}
      allowedElements={["p", "a", "strong", "em", "code"]}
      unwrapDisallowed
    >
      {text}
    </ReactMarkdown>
  );
}
