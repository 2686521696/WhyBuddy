/**
 * SkillsLibraryPage — 技能库（TRAE 论坛 SOLO 技能创作赛索引）。
 *
 * 合规定位（与采集器 scripts/harvest-trae-skills.mjs 同一契约）：
 *   索引 + 回链，不搬本体——库里只有公开元数据（标题/作者/热度/摘要/
 *   获取渠道链接），技能文件与仓库内容留在原处，版权归原作者；
 *   每条必带原帖回链，页头如实标注数据来源与采集时间。
 *
 * 数据从 @/data/trae-skills-index.json 静态导入——本页是懒加载路由，
 * 索引 JSON 打进本页 chunk，不占主包体积。
 */

import React from "react";
import { Input, Segmented, Table, Tag, Tooltip } from "antd";
import {
  CloudDownloadOutlined,
  FileZipOutlined,
  GithubOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import skillsIndex from "@/data/trae-skills-index.json";

interface SkillIndexItem {
  topicId: number;
  title: string;
  url: string;
  author: string;
  createdAt: string;
  views: number;
  likeCount: number;
  postsCount: number;
  tags: string[];
  excerpt: string;
  sourceKind: "repo" | "pan" | "attachment" | "none" | string;
  repos: string[];
  pans: string[];
  attachments: string[];
}

interface SkillsIndexFile {
  source: string;
  license_note: string;
  fetchedAt: string;
  count: number;
  items: SkillIndexItem[];
}

const INDEX = skillsIndex as SkillsIndexFile;

const KIND_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  repo: { label: "开源仓库", color: "green", icon: <GithubOutlined /> },
  pan: { label: "网盘分发", color: "blue", icon: <CloudDownloadOutlined /> },
  attachment: { label: "论坛附件", color: "purple", icon: <FileZipOutlined /> },
  none: { label: "图文介绍", color: "default", icon: <LinkOutlined /> },
};

const KIND_FILTERS = [
  { label: "全部", value: "all" },
  { label: "开源仓库", value: "repo" },
  { label: "网盘分发", value: "pan" },
  { label: "论坛附件", value: "attachment" },
  { label: "图文介绍", value: "none" },
];

export function SkillsLibraryPage() {
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<string>("all");

  const items = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return INDEX.items
      .filter((it) => (kind === "all" ? true : it.sourceKind === kind))
      .filter(
        (it) =>
          !q ||
          it.title.toLowerCase().includes(q) ||
          it.excerpt.toLowerCase().includes(q) ||
          it.author.toLowerCase().includes(q)
      )
      .sort((a, b) => b.views - a.views);
  }, [query, kind]);

  const kindCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of INDEX.items) counts[it.sourceKind] = (counts[it.sourceKind] ?? 0) + 1;
    return counts;
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-[1080px] flex-col gap-3 overflow-auto p-5" data-testid="skills-library">
      <div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-stone-800">技能库</h1>
          <span className="text-xs text-stone-400">
            {INDEX.count} 项 · 索引自{" "}
            <a href={INDEX.source} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
              TRAE 论坛「SOLO技能创作赛」
            </a>{" "}
            · 采集于 {INDEX.fetchedAt.slice(0, 10)}
          </span>
        </div>
        <div className="mt-1 rounded bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 ring-1 ring-amber-200">
          {INDEX.license_note}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input.Search
          allowClear
          placeholder="搜索标题 / 摘要 / 作者"
          style={{ maxWidth: 320 }}
          onSearch={setQuery}
          onChange={(e) => {
            if (!e.target.value) setQuery("");
          }}
          data-testid="skills-search"
        />
        <Segmented
          options={KIND_FILTERS.map((f) => ({
            ...f,
            label:
              f.value === "all"
                ? `全部 ${INDEX.count}`
                : `${f.label} ${kindCounts[f.value] ?? 0}`,
          }))}
          value={kind}
          onChange={(v) => setKind(String(v))}
          data-testid="skills-kind-filter"
        />
      </div>

      <Table<SkillIndexItem>
        size="small"
        rowKey="topicId"
        dataSource={items}
        pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 项` }}
        expandable={{
          expandedRowRender: (it) => (
            <div className="space-y-1.5 py-1 text-xs text-stone-600">
              <div>{it.excerpt || "（无摘要）"}</div>
              {(it.repos.length > 0 || it.pans.length > 0 || it.attachments.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {[...it.repos, ...it.pans, ...it.attachments].map((link) => (
                    <a
                      key={link}
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] text-blue-600 hover:underline"
                    >
                      {link.length > 72 ? `${link.slice(0, 72)}…` : link}
                    </a>
                  ))}
                </div>
              )}
              {it.tags.length > 0 && (
                <div>
                  {it.tags.map((t) => (
                    <Tag key={t} style={{ fontSize: 10 }}>
                      {t}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          ),
        }}
        columns={[
          {
            title: "技能",
            dataIndex: "title",
            ellipsis: true,
            render: (_: unknown, it: SkillIndexItem) => (
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer"
                className="text-stone-800 hover:text-blue-600"
                title="打开原帖（技能获取以原帖为准）"
              >
                {it.title}
              </a>
            ),
          },
          {
            title: "作者",
            dataIndex: "author",
            width: 130,
            ellipsis: true,
            sorter: (a, b) => a.author.localeCompare(b.author, "zh"),
          },
          {
            title: "获取渠道",
            dataIndex: "sourceKind",
            width: 110,
            filters: KIND_FILTERS.filter((f) => f.value !== "all").map((f) => ({
              text: f.label,
              value: f.value,
            })),
            onFilter: (v, it) => it.sourceKind === v,
            render: (v: string) => {
              const meta = KIND_META[v] ?? KIND_META.none;
              return (
                <Tooltip title={v === "none" ? "原帖仅图文介绍，未附交付物" : "展开行可见链接"}>
                  <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
                    {meta.label}
                  </Tag>
                </Tooltip>
              );
            },
          },
          {
            title: "浏览",
            dataIndex: "views",
            width: 80,
            sorter: (a, b) => a.views - b.views,
            defaultSortOrder: "descend",
          },
          {
            title: "赞",
            dataIndex: "likeCount",
            width: 64,
            sorter: (a, b) => a.likeCount - b.likeCount,
          },
          {
            title: "发布",
            dataIndex: "createdAt",
            width: 104,
            sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
            render: (v: string) => <span className="text-stone-400">{v.slice(0, 10)}</span>,
          },
        ]}
      />
    </div>
  );
}

export default SkillsLibraryPage;
