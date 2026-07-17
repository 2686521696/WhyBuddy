/**
 * HelpCenterPage — 站内帮助中心（E15）。
 *
 * 选型说明：没有引 Docusaurus/VitePress 独立文档站（多一套构建与部署面），
 * 而是取其版式做站内文档中心——markdown 源随仓库版本走（vite ?raw 内联，
 * 无运行时拉取），react-markdown + GFM 渲染，左目录 + 搜索 + 右正文。
 * 文档与代码同仓同 PR 演进，发布门顺带看住文档编译。
 */

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Search, BookOpen } from "lucide-react";

import quickStart from "./docs/01-quick-start.md?raw";
import coreConcepts from "./docs/02-core-concepts.md?raw";
import workbench from "./docs/03-workbench.md?raw";
import reasoningPage from "./docs/04-reasoning-page.md?raw";
import faq from "./docs/05-faq.md?raw";
import config from "./docs/06-config.md?raw";
import fullFlow from "./docs/07-full-flow.md?raw";
import glossary from "./docs/08-glossary.md?raw";
import changelog from "./docs/09-changelog.md?raw";

export interface HelpDoc {
  id: string;
  title: string;
  group: string;
  body: string;
}

export const HELP_DOCS: HelpDoc[] = [
  { id: "quick-start", title: "快速上手", group: "开始", body: quickStart },
  { id: "core-concepts", title: "核心概念", group: "开始", body: coreConcepts },
  { id: "workbench", title: "工作台指南", group: "使用", body: workbench },
  { id: "reasoning-page", title: "推演页指南", group: "使用", body: reasoningPage },
  // E36（用户需求）：发布全流程 + 术语表 + 更新日志（更新日志由
  // scripts/gen-help-changelog.mjs 从「发版：」提交历史生成，发版后重跑）
  { id: "full-flow", title: "发布全流程", group: "使用", body: fullFlow },
  { id: "glossary", title: "术语表", group: "支持", body: glossary },
  { id: "changelog", title: "更新日志", group: "支持", body: changelog },
  { id: "faq", title: "常见问题", group: "支持", body: faq },
  { id: "config", title: "环境与配置", group: "支持", body: config },
];

/** 搜索：标题或正文命中（可单测）。空词返回全部。 */
export function searchDocs(docs: HelpDoc[], query: string): HelpDoc[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter(
    d => d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q)
  );
}

const MD_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: props => (
    <h1 className="mb-4 border-b border-stone-100 pb-3 text-[22px] font-bold text-stone-800" {...props} />
  ),
  h2: props => <h2 className="mb-2.5 mt-7 text-[16px] font-semibold text-stone-800" {...props} />,
  h3: props => <h3 className="mb-2 mt-5 text-[14px] font-semibold text-stone-700" {...props} />,
  p: props => <p className="mb-3 text-[13.5px] leading-[1.75] text-stone-600" {...props} />,
  ul: props => <ul className="mb-3 list-disc space-y-1 pl-5 text-[13.5px] text-stone-600" {...props} />,
  ol: props => <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13.5px] text-stone-600" {...props} />,
  li: props => <li className="leading-[1.7]" {...props} />,
  blockquote: props => (
    <blockquote
      className="mb-3 rounded-r-lg border-l-2 border-[#1677ff] bg-[#f0f6ff] px-3.5 py-2.5 text-[13px] text-stone-600"
      {...props}
    />
  ),
  code: ({ className, children, ...props }) => {
    const block = /language-/.test(className || "") || String(children).includes("\n");
    return block ? (
      <code className={`block text-[12px] leading-relaxed ${className || ""}`} {...props}>
        {children}
      </code>
    ) : (
      <code className="rounded bg-stone-100 px-1.5 py-0.5 text-[12px] text-[#c05621]" {...props}>
        {children}
      </code>
    );
  },
  pre: props => (
    <pre className="mb-3 overflow-x-auto rounded-lg border border-stone-200 bg-[#fafafa] p-3.5" {...props} />
  ),
  table: props => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full border-collapse text-[12.5px]" {...props} />
    </div>
  ),
  th: props => (
    <th
      className="border-b border-stone-200 bg-stone-50 px-3 py-2 text-left font-medium text-stone-600"
      {...props}
    />
  ),
  td: props => <td className="border-b border-stone-100 px-3 py-2 align-top text-stone-600" {...props} />,
  a: props => <a className="text-[#1677ff] hover:underline" {...props} />,
  hr: () => <hr className="my-5 border-stone-100" />,
  strong: props => <strong className="font-semibold text-stone-700" {...props} />,
};

export function HelpCenterPage() {
  const [query, setQuery] = React.useState("");
  const [activeId, setActiveId] = React.useState(HELP_DOCS[0].id);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const visible = searchDocs(HELP_DOCS, query);
  const active = HELP_DOCS.find(d => d.id === activeId) ?? HELP_DOCS[0];
  const groups = [...new Set(visible.map(d => d.group))];

  const pick = (id: string) => {
    setActiveId(id);
    contentRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div data-testid="help-center" className="flex h-full min-h-0 bg-[#f7f8fa]">
      {/* 左目录 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-4 pb-3 pt-4">
          <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-stone-800">
            <BookOpen size={15} className="text-[#1677ff]" />
            帮助文档
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-300" />
            <input
              data-testid="help-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索文档"
              className="w-full rounded-md border border-stone-200 bg-stone-50 py-1.5 pl-7 pr-2 text-[12px] outline-none placeholder:text-stone-300 focus:border-[#1677ff] focus:bg-white"
            />
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {groups.map(group => (
            <div key={group} className="mb-1">
              <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-stone-400">{group}</div>
              {visible
                .filter(d => d.group === group)
                .map(doc => (
                  <button
                    key={doc.id}
                    data-testid={`help-nav-${doc.id}`}
                    className={`block w-full rounded-md px-2 py-1.5 text-left text-[13px] transition ${
                      doc.id === active.id
                        ? "bg-[#1677ff]/10 font-medium text-[#1677ff]"
                        : "text-stone-600 hover:bg-stone-100"
                    }`}
                    onClick={() => pick(doc.id)}
                  >
                    {doc.title}
                  </button>
                ))}
            </div>
          ))}
          {visible.length === 0 && (
            <div className="px-2 py-4 text-[12px] text-stone-400">没有匹配「{query}」的文档</div>
          )}
        </nav>
      </aside>

      {/* 正文 */}
      <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto">
        <article data-testid="help-article" className="mx-auto max-w-[760px] px-8 py-8">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {active.body}
          </ReactMarkdown>
          <div className="mt-10 border-t border-stone-100 pt-4 text-[11px] text-stone-300">
            文档随代码同仓演进 · 发现问题直接在会话里反馈
          </div>
        </article>
      </div>
    </div>
  );
}

export default HelpCenterPage;
