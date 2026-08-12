/**
 * FreeformPreviewScreen — FreeformInsight 自我校验闭环专用的隔离预览页
 * （2026-07-24，路由 /sliderule/freeform-preview/:pid）。
 *
 * 背景：generate_freeform_block 生成出一份候选 JSON 后，想真实渲染一次截图
 * 跟参考图比对（借鉴 abi/screenshot-to-code 的 screenshot_preview 思路：
 * 生成→截图→自己看→改）。候选内容这时还没写进任何 session，不能走
 * AppRuntimeScreen 那套完整应用外壳（侧边栏/顶栏/聊天面板都是噪音，只会
 * 让截图跟"这块内容区长什么样"这个问题脱节）——这个页面只渲染内容区
 * 本身，用真实的 ExperienceBlockBoundary/FreeformInsightRenderer，
 * 不是另起一套渲染逻辑，跟正式应用里看到的是同一套渲染代码。
 *
 * 内容来自后端临时预览存储（services/freeform_preview_store.py），几分钟
 * 内过期、一次性、不落盘——不是走真实 session。
 */

import React from "react";
import { ConfigProvider } from "antd";
import { ExperienceBlockBoundary } from "./block-registry";
import type { ExperienceBlockInstance } from "./block-registry";
import { resolveIdentityTheme } from "./identity-themes";
import {
  DARK_CANVAS_BG,
  designRecipeAlgorithms,
  resolveDesignRecipe,
} from "./design-recipes";
import type { AppFormFieldSchema } from "./app-runtime-schema";
import type { RuntimeRow } from "./live-runtime";
import type { OverviewHtmlPayload } from "./OverviewHtmlSurface";

// 跟 AppRuntimeScreen 同一个理由懒加载：它拖着 DOMPurify，而这页大多数时候
// 渲染的是受限树。
const LazyOverviewHtmlSurface = React.lazy(() => import("./OverviewHtmlSurface"));

interface FreeformPreviewPayload {
  freeformContent?: { root: Record<string, unknown> };
  /**
   * 总览的 **HTML 载体**（2026-08-12 傍晚，随它转为默认路径一起接上）。
   *
   * 不接的后果跟上面 designRecipeRef 那条一模一样、只是更彻底：HTML 成为默认
   * 载体之后，这个自检页看到的仍然是受限树那份产物——而走 HTML 那条路的页面
   * **根本没有**受限树产物，于是自检页只会显示"预览内容不可用"。截图评审、
   * 版式体检（scripts/detect-design-defects.mjs）全都量不到默认路径。
   */
  overviewHtml?: OverviewHtmlPayload;
  /** 实体字段声明。逐行的值靠它补单位（% / ¥ / 分 / 枚举标签）。 */
  entityFields?: Record<string, AppFormFieldSchema[]>;
  themeId?: string;
  generatedTheme?: Record<string, unknown>;
  device?: string;
  entityRows?: Record<string, RuntimeRow[]>;
  /**
   * 外壳的视觉配方（2026-08-12）。
   *
   * 这个预览页是**截图自检的目标**，可它此前只传了 colorPrimary：没有
   * darkAlgorithm、没有圆角、画布固定用浅色 contentBg。于是一份为深色外壳
   * 设计的首页会被渲染在白底上——自检看到的画面跟用户看到的不是同一个东西，
   * 基于它的任何判断（截图评审、对比度体检）都在评判一个不存在的页面。
   *
   * 缺省时行为与从前逐字节一致（resolveDesignRecipe 未知/缺省 → default）。
   */
  designRecipeRef?: string;
}

const DEVICE_CONTENT_WIDTH: Record<string, number> = {
  phone: 380,
  tablet: 900,
  desktop: 1200,
};

export default function FreeformPreviewScreen({ pid }: { pid?: string }) {
  const [payload, setPayload] = React.useState<FreeformPreviewPayload | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ok" | "error">("loading");

  React.useEffect(() => {
    let cancelled = false;
    if (!pid) {
      setStatus("error");
      return;
    }
    fetch(`/api/sliderule/freeform-preview/${encodeURIComponent(pid)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: FreeformPreviewPayload) => {
        if (cancelled) return;
        setPayload(data);
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [pid]);

  if (status === "loading") {
    return <div data-testid="freeform-preview-loading" style={{ padding: 24 }} />;
  }
  if (
    status === "error" ||
    !payload ||
    (!payload.freeformContent && !payload.overviewHtml?.html)
  ) {
    return (
      <div data-testid="freeform-preview-error" style={{ padding: 24, color: "#999" }}>
        预览内容不可用或已过期
      </div>
    );
  }
  const hasHtml = Boolean(payload.overviewHtml?.html);

  const identityTheme = resolveIdentityTheme(payload.themeId, payload.generatedTheme);
  const device = payload.device || "desktop";
  const width = DEVICE_CONTENT_WIDTH[device] ?? DEVICE_CONTENT_WIDTH.desktop;
  const block: ExperienceBlockInstance = {
    id: "freeform-preview",
    type: "FreeformInsight",
    freeformContent: payload.freeformContent ?? { root: {} },
  };
  // 字段声明查询：形状跟 AppRuntimeScreen 的 fieldSchemaOf 一致，只是这里的来源
  // 是预览载荷而不是 session 里的模型。缺省时逐行的值退成裸值（不猜单位）。
  const fieldSchemaOf = (entityId: string, fieldId: string) =>
    (payload.entityFields ?? {})[entityId]?.find(f => f.id === fieldId);

  // 配方与运行时同一套解析和同一套 token 映射（不另立一份，否则自检看到的
  // 外壳跟真应用又会漂开——AppRuntimeScreen 那边是 designRecipeAlgorithms +
  // borderRadius/padding 两个 token + dark 时换画布）。
  const recipe = resolveDesignRecipe(payload.designRecipeRef);
  return (
    <ConfigProvider
      theme={{
        cssVar: true,
        algorithm: designRecipeAlgorithms(recipe, false),
        token: {
          colorPrimary: identityTheme.primary,
          borderRadius: recipe.borderRadius,
          padding: recipe.padding,
        },
      }}
    >
      <div
        data-testid="freeform-preview-root"
        data-recipe={recipe.id}
        style={{
          width,
          minHeight: 200,
          background: recipe.dark ? DARK_CANVAS_BG : identityTheme.contentBg,
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        {/* 两种载体同时只会有一个（生成侧 HTML 成了就不跑受限树）。顺序跟
            AppRuntimeScreen 的 renderFreeformOverview 一致：先看 HTML。 */}
        {hasHtml ? (
          <React.Suspense fallback={<div style={{ minHeight: 120 }} />}>
            <LazyOverviewHtmlSurface
              payload={payload.overviewHtml as OverviewHtmlPayload}
              entityRows={payload.entityRows || {}}
              chartPalette={{ primary: identityTheme.primary, categorical: identityTheme.charts }}
              fieldSchemaOf={fieldSchemaOf}
            />
          </React.Suspense>
        ) : (
          <ExperienceBlockBoundary
            block={block}
            previewId={pid}
            entityRows={payload.entityRows || {}}
            chartPalette={{ primary: identityTheme.primary, categorical: identityTheme.charts }}
          />
        )}
      </div>
    </ConfigProvider>
  );
}
