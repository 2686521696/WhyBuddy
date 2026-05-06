import {
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Database,
  FileSearch,
  FolderKanban,
  HelpCircle,
  LayoutGrid,
  ListTodo,
  type LucideIcon,
  Navigation,
  Settings2,
  Settings,
  Shield,
  Store,
} from "lucide-react";

export type PrimaryNavigationId = "office" | "more";
export type MainPathId = "office" | "tasks";
export type MoreNavigationId = "config" | "permissions" | "audit" | "help";
export type DebugTab =
  | "overview"
  | "config"
  | "permissions"
  | "audit"
  | "lineage"
  | "help";

export interface NavigationItem<TId extends string> {
  id: TId;
  icon: LucideIcon;
  href?: string;
}

export const LEGACY_COMMAND_CENTER_PATH = "/command-center";
export const LEGACY_COMMAND_CENTER_LEGACY_PATH = "/command-center/legacy";
export const DEBUG_PATH = "/debug";
export const DEBUG_CONFIG_PATH = "/debug/config";
export const DEBUG_PERMISSIONS_PATH = "/debug/permissions";
export const DEBUG_AUDIT_PATH = "/debug/audit";
export const DEBUG_LINEAGE_PATH = "/debug/lineage";
export const DEBUG_HELP_PATH = "/debug/help";
export const LEGACY_LINEAGE_PATH = "/lineage";
export const OFFICE_PATH = "/";
export const PROJECTS_PATH = "/projects";
export const AUTOPILOT_PATH = "/autopilot";
export const REPLAY_PATH_PREFIX = "/replay";

export function getReplayPath(missionId: string): string {
  return `${REPLAY_PATH_PREFIX}/${missionId}`;
}

export function getProjectTasksPath(projectId?: string | null): string {
  return projectId ? `${PROJECTS_PATH}/${projectId}/tasks` : "/tasks";
}

export function getProjectTaskPath(
  projectId: string | null | undefined,
  taskId: string
): string {
  return projectId ? `${getProjectTasksPath(projectId)}/${taskId}` : `/tasks/${taskId}`;
}

function normalizeNavigationPath(path: string): string {
  const trimmed = path.trim();
  const [pathname] = trimmed.split(/[?#]/, 1);
  return pathname || "/";
}

function matchesPathPrefix(path: string, prefix: string): boolean {
  const pathname = normalizeNavigationPath(path);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProjectTasksPath(path: string): boolean {
  const pathname = normalizeNavigationPath(path);
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "projects" && parts.length >= 3 && parts[2] === "tasks";
}

export function getDebugPath(tab: DebugTab): string {
  switch (tab) {
    case "config":
      return DEBUG_CONFIG_PATH;
    case "permissions":
      return DEBUG_PERMISSIONS_PATH;
    case "audit":
      return DEBUG_AUDIT_PATH;
    case "lineage":
      return DEBUG_LINEAGE_PATH;
    case "help":
      return DEBUG_HELP_PATH;
    default:
      return DEBUG_PATH;
  }
}

export function resolveDebugTab(path: string): DebugTab {
  if (matchesPathPrefix(path, DEBUG_CONFIG_PATH)) return "config";
  if (matchesPathPrefix(path, DEBUG_PERMISSIONS_PATH)) return "permissions";
  if (matchesPathPrefix(path, DEBUG_AUDIT_PATH)) return "audit";
  if (matchesPathPrefix(path, DEBUG_LINEAGE_PATH)) return "lineage";
  if (matchesPathPrefix(path, DEBUG_HELP_PATH)) return "help";
  return "overview";
}

export function getCompatibilityRedirect(path: string): string | null {
  if (matchesPathPrefix(path, LEGACY_COMMAND_CENTER_LEGACY_PATH)) {
    return OFFICE_PATH;
  }

  if (matchesPathPrefix(path, LEGACY_COMMAND_CENTER_PATH)) {
    return OFFICE_PATH;
  }

  if (matchesPathPrefix(path, LEGACY_LINEAGE_PATH)) {
    return DEBUG_LINEAGE_PATH;
  }

  return null;
}

export const PRIMARY_NAV_ITEMS: Array<NavigationItem<PrimaryNavigationId>> = [
  {
    id: "office",
    icon: BriefcaseBusiness,
    href: "/",
  },
  {
    id: "more",
    icon: LayoutGrid,
  },
];

export const MAIN_PATH_ITEMS: Array<NavigationItem<MainPathId>> = [
  {
    id: "office",
    icon: BriefcaseBusiness,
    href: "/",
  },
  {
    id: "tasks",
    icon: FolderKanban,
    href: "/tasks",
  },
];

export const MORE_NAV_ITEMS: Array<NavigationItem<MoreNavigationId>> = [
  {
    id: "config",
    icon: Settings2,
    href: DEBUG_CONFIG_PATH,
  },
  {
    id: "permissions",
    icon: Shield,
    href: DEBUG_PERMISSIONS_PATH,
  },
  {
    id: "audit",
    icon: FileSearch,
    href: DEBUG_AUDIT_PATH,
  },
  {
    id: "help",
    icon: HelpCircle,
    href: DEBUG_HELP_PATH,
  },
];

export function isLowFrequencyPath(path: string) {
  return (
    matchesPathPrefix(path, DEBUG_PATH) ||
    matchesPathPrefix(path, LEGACY_LINEAGE_PATH) ||
    matchesPathPrefix(path, LEGACY_COMMAND_CENTER_PATH)
  );
}

export function getPrimaryNavigationId(path: string): PrimaryNavigationId {
  if (isLowFrequencyPath(path)) return "more";
  return "office";
}

// ---------------------------------------------------------------------------
// Sidebar navigation (spec: ui-redesign-sidebar-navigation)
// ---------------------------------------------------------------------------

export type SidebarNavigationId =
  | "autopilot"
  | "tasks"
  | "projects"
  | "knowledge"
  | "datasource"
  | "dashboard"
  | "marketplace"
  | "notifications"
  | "settings";

export interface SidebarNavigationItem {
  id: SidebarNavigationId;
  icon: LucideIcon;
  href?: string;
  mobileVisible: boolean;
  disabled?: boolean;
}

export const PROJECT_SPACE_NAV_ITEMS: SidebarNavigationItem[] = [
  {
    id: "projects",
    icon: FolderKanban,
    href: PROJECTS_PATH,
    mobileVisible: true,
  },
];

export const SIDEBAR_NAV_ITEMS: SidebarNavigationItem[] = [
  {
    id: "autopilot",
    icon: Navigation,
    href: PROJECTS_PATH,
    mobileVisible: true,
  },
  {
    id: "tasks",
    icon: ListTodo,
    href: "/tasks",
    mobileVisible: true,
  },
  {
    id: "knowledge",
    icon: BookOpen,
    mobileVisible: true,
    disabled: true,
  },
  {
    id: "datasource",
    icon: Database,
    mobileVisible: false,
    disabled: true,
  },
  {
    id: "dashboard",
    icon: BarChart3,
    mobileVisible: false,
    disabled: true,
  },
  {
    id: "marketplace",
    icon: Store,
    mobileVisible: false,
    disabled: true,
  },
  {
    id: "notifications",
    icon: Bell,
    mobileVisible: false,
    disabled: true,
  },
  {
    id: "settings",
    icon: Settings,
    href: DEBUG_PATH,
    mobileVisible: true,
  },
];

export function isProjectDetailPath(path: string): boolean {
  const pathname = normalizeNavigationPath(path);
  return (
    pathname === AUTOPILOT_PATH ||
    (matchesPathPrefix(pathname, PROJECTS_PATH) && pathname !== PROJECTS_PATH)
  );
}

export function getSidebarNavItems(path: string): SidebarNavigationItem[] {
  const pathname = normalizeNavigationPath(path);
  if (pathname === "/" || pathname === PROJECTS_PATH) {
    return PROJECT_SPACE_NAV_ITEMS;
  }
  return SIDEBAR_NAV_ITEMS;
}

export function getMobileTabItems(path?: string): SidebarNavigationItem[] {
  const items = path ? getSidebarNavItems(path) : SIDEBAR_NAV_ITEMS;
  return items.filter(item => item.mobileVisible);
}

export function resolveSidebarHref(
  item: SidebarNavigationItem,
  path: string,
  currentProjectId?: string | null
): string | undefined {
  const pathname = normalizeNavigationPath(path);
  if (item.disabled) return undefined;

  if (item.id === "autopilot") {
    if (currentProjectId) {
      return AUTOPILOT_PATH;
    }
    if (pathname === AUTOPILOT_PATH) {
      return AUTOPILOT_PATH;
    }
    return PROJECTS_PATH;
  }

  if (item.id === "projects") {
    return PROJECTS_PATH;
  }

  if (item.id === "tasks") {
    return getProjectTasksPath(currentProjectId);
  }

  return item.href;
}

export function getActiveSidebarId(path: string): SidebarNavigationId {
  const pathname = normalizeNavigationPath(path);
  if (pathname === "/" || pathname === PROJECTS_PATH) return "projects";
  if (pathname === AUTOPILOT_PATH) return "autopilot";
  if (isProjectTasksPath(pathname)) return "tasks";
  if (matchesPathPrefix(pathname, "/tasks")) return "tasks";
  if (matchesPathPrefix(pathname, PROJECTS_PATH)) return "autopilot";
  if (matchesPathPrefix(pathname, DEBUG_PATH)) return "settings";
  return "autopilot";
}
