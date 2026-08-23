/**
 * 侧栏会话封面——**只贴图，没图画首字母**。
 *
 * ## 2026-08-23：活渲染那一档删了
 *
 * 这里原本跟应用中心是同一条三级链：有图贴图，没图就**现挂一个真的应用运行时**
 * （HtmlAppSurface / AppRuntimeScreen）渲染出来缩进 40px 的方格里。
 *
 * 应用中心 2026-08-22 已经把这套从卡片上删掉（同屏 14 张卡最长单任务 4106ms，
 * 主线程连堵四秒），当时**没动侧栏**。结果是 CPU 那一半省了，网络这一半原样
 * 留着——而且侧栏比卡片更贵，因为它是每行各拉各的整包：
 *
 *   真机实测（/agent-loop/workbench 首屏 20s，登录态，CDP 抓调用栈）：
 *     GET /sessions/{id}   ×3   1239.4 KB   ← 全部来自这里，单条约 413 KB
 *     GET /apps/{id}       ×2    163.6 KB   ← 同上
 *     ————————————————————————————————————
 *     合计 1.4 MB，占该页首屏 2.42 MB 的 58%
 *
 * 拉的还是**完整会话状态**（含 specFirstPages 整页 HTML + 证据投影），
 * 而真正用到的只有"落地页那一段 HTML"。
 *
 * 用户 2026-08-23 拍板：侧栏也走贴图。代价是**没图的行会变成首字母块**——
 * 这是明知的取舍，不是回归：库里大部分应用没有 shot（同日查线上库 64 个应用，
 * 有图的 20 个），所以侧栏会明显变空。要让它重新有画面，正确的做法是让那些
 * 应用真的有图（见 studio-landing-shot 的收口采集），而不是每次进页面现渲一遍。
 *
 * ⚠ 别把活渲染加回来。真要恢复画面，先加一个**只回落地页那一段**的瘦接口
 *   （`GET /sessions/{id}/landing-page`），别再拉整个会话状态。
 */
import React from "react";

import {
  appPreviewUrl,
  type AppStoreSummary,
} from "./app-store-client";

/**
 * 侧栏为了拿 has_preview / preview_tag 拉的那批摘要的上限。
 *
 * 摘要是瘦的（不含 model_json / pages_json / 图本体，见 app_store._summary），
 * 实测 36 条约 30 KB——这条**不是**上面那 1.4 MB 的来源，别顺手也砍了。
 */
export const SESSION_THUMB_APP_LIMIT = 36;

export function indexAppsBySession(
  apps: readonly AppStoreSummary[]
): Map<string, AppStoreSummary> {
  const map = new Map<string, AppStoreSummary>();
  for (const app of apps) {
    const sid = String(app.session_id || "").trim();
    if (sid && !map.has(sid)) map.set(sid, app);
  }
  return map;
}

/** 和应用中心 shouldUseSheetThumb 同一口径：有 appId 且后端说有图。 */
export function sessionUsesSheet(app?: AppStoreSummary | null): boolean {
  return Boolean(app?.id && app.has_preview);
}

export function sessionRowTitle(
  goal: string,
  app?: AppStoreSummary | null
): string {
  return String(app?.product_name || "").trim() || goal.trim() || "新会话";
}

/**
 * 没图时的方格。
 *
 * 用首字母块而不是应用中心那个 antd Empty：那个组件自带 image + description，
 * 在 40px 的方格里只会糊成一团。同一个"没有图"的语义，两处按各自尺寸表达。
 */
function LetterThumb({ title }: { title: string }) {
  return (
    <span className="native-agent-session-thumb-letter">{title.slice(0, 1)}</span>
  );
}

export function SessionThumb({
  sessionId,
  title,
  app,
}: {
  sessionId: string;
  title: string;
  app?: AppStoreSummary | null;
}) {
  const [sheetFailed, setSheetFailed] = React.useState(false);
  React.useEffect(() => setSheetFailed(false), [sessionId, app?.id, app?.preview_tag]);

  const sheet = sessionUsesSheet(app) && !sheetFailed;
  return (
    <span className="native-agent-session-thumb" aria-hidden>
      {sheet ? (
        <img
          src={appPreviewUrl(app!.id, app!.preview_tag)}
          alt=""
          data-testid="sidebar-session-thumb-sheet"
          // 图拉不到（记录刚被删、网络抖）→ 回落同一个首字母块，不留空白方格。
          onError={() => setSheetFailed(true)}
        />
      ) : (
        <LetterThumb title={title} />
      )}
    </span>
  );
}
