/**
 * 设计系统面板的开合状态。
 *
 * ## 为什么要一个 context
 *
 * 触发在**作曲家**（ComposerDock，首页和会话内各渲染一次），面板挂在**舞台
 * 那一侧**。两者不是父子关系，中间隔着 SlideRule.tsx 的整棵树。走 props 得从
 * SlideRule 一路传到 ComposerDock 里层，而 ComposerDock 有两个渲染点——
 * 那正是本仓「只改一半」最容易发生的形状。
 *
 * ⚠ 面板不是抽屉（2026-08-25 用户原话「不是抽屉那种」）：不做全高遮罩 + 边缘
 *   滑入，而是浮在舞台右上的一块面板，跟 Stitch 的设计体系面板同款。抽屉会
 *   把正在跑的应用整个盖住，而用户改配色时正需要看着那个应用。
 *
 * ⚠ 2026-08-25 第二轮，用户原话「显示在右侧，点击预设不消失，侧边栏弹出色板，
 *   点击应用一起消失」。所以**菜单的开合也进 context**，不再是 ComposerDock
 *   自己的 useState：
 *     · 菜单要跟面板并排渲染在右侧，不能再挂在作曲家的 DOM 里（那会跟着
 *       作曲家浮在对话栏上方，离面板隔半个屏幕）；
 *     · 「应用」要同时关掉菜单和面板，而按钮在面板里、菜单在别处——
 *       各存各的开合状态就做不到"一起消失"。
 */
import React from "react";

import {
  findDesignSystem,
  loadDesignSystemId,
  newCustomDesignSystem,
  saveDesignSystemId,
  type DesignSystem,
} from "./design-system";

export type DesignSystemPanelApi = {
  /**
   * 当前选中的设计系统 id；null = 还没选（作曲家显示图标）。
   *
   * ⚠ 放在 context 而不是各自 useState：触发在作曲家、保存在面板，两处不是
   *   父子。各存各的话，面板里「保存并应用」之后作曲家上的色块不会变——
   *   而这种不同步不会报错，只会让人以为没保存上。
   */
  appliedId: string | null;
  apply: (id: string) => void;
  /** 面板里正在看/编的那一套；null = 面板关着。 */
  editing: DesignSystem | null;
  /** 是新建（可保存）还是看预设（只读 + 可另存）。 */
  mode: "create" | "view";
  openNew: () => void;
  openView: (id: string) => void;
  close: () => void;
  patch: (next: Partial<DesignSystem>) => void;
  /** 清单是否展开。菜单渲染在右侧（DesignSystemRail），不在作曲家里。 */
  menuOpen: boolean;
  toggleMenu: () => void;
  /** 菜单 + 面板一起收。「应用」走它。 */
  closeAll: () => void;
};

const Ctx = React.createContext<DesignSystemPanelApi | null>(null);

export function DesignSystemPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [editing, setEditing] = React.useState<DesignSystem | null>(null);
  const [mode, setMode] = React.useState<"create" | "view">("view");
  const [appliedId, setAppliedId] = React.useState<string | null>(
    loadDesignSystemId
  );

  const [menuOpen, setMenuOpen] = React.useState(false);

  const apply = React.useCallback((id: string) => {
    saveDesignSystemId(id);
    setAppliedId(id);
  }, []);

  const toggleMenu = React.useCallback(() => {
    setMenuOpen(v => {
      // 收起清单时把面板一并收掉：只剩一块面板孤零零挂在右边，用户没有入口
      // 再回到清单，只能靠面板自己的 ×。
      if (v) setEditing(null);
      return !v;
    });
  }, []);

  const closeAll = React.useCallback(() => {
    setMenuOpen(false);
    setEditing(null);
  }, []);

  const openNew = React.useCallback(() => {
    setEditing(newCustomDesignSystem());
    setMode("create");
    setMenuOpen(true);
  }, []);

  const openView = React.useCallback((id: string) => {
    setEditing(findDesignSystem(id));
    setMode("view");
    // ⚠ 点预设**不关菜单**（用户第 2 条）：清单留着才能连着比几套，
    //   面板在旁边跟着换。关掉的话每看一套都要重新点开清单。
    setMenuOpen(true);
  }, []);

  const close = React.useCallback(() => setEditing(null), []);

  const patch = React.useCallback((next: Partial<DesignSystem>) => {
    setEditing(cur => (cur ? { ...cur, ...next } : cur));
    // 改过就进可保存态：看预设时点了改色也应当能存成自己的一套，
    // 而不是逼用户先点「新建」再重挑一遍。
    setMode("create");
  }, []);

  const api = React.useMemo<DesignSystemPanelApi>(
    () => ({
      appliedId,
      apply,
      editing,
      mode,
      openNew,
      openView,
      close,
      patch,
      menuOpen,
      toggleMenu,
      closeAll,
    }),
    [
      appliedId,
      apply,
      editing,
      mode,
      openNew,
      openView,
      close,
      patch,
      menuOpen,
      toggleMenu,
      closeAll,
    ]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** 没有 Provider 时返回 null（单测、应用中心那边不挂这个面板）。 */
export function useDesignSystemPanel(): DesignSystemPanelApi | null {
  return React.useContext(Ctx);
}
