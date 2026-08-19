import React from "react";
import {
  readShellSidebarCollapsed,
  writeShellSidebarCollapsed,
} from "./shell-sidebar-layout";

export type ShellSidebarApi = {
  collapsed: boolean;
  toggle: () => void;
};

const ShellSidebarContext = React.createContext<ShellSidebarApi | null>(null);

export function ShellSidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    // 2026-08-18：顶栏左边会话栏键已撤。若还读旧 localStorage
    // 会把侧栏折没且没有展开入口。强制摊开。
    if (readShellSidebarCollapsed()) {
      writeShellSidebarCollapsed(false);
    }
    setCollapsed(false);
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      writeShellSidebarCollapsed(next);
      return next;
    });
  }, []);

  const value = React.useMemo(
    () => ({ collapsed, toggle }),
    [collapsed, toggle]
  );

  return (
    <ShellSidebarContext.Provider value={value}>
      {children}
    </ShellSidebarContext.Provider>
  );
}

export function useShellSidebar(): ShellSidebarApi | null {
  return React.useContext(ShellSidebarContext);
}
