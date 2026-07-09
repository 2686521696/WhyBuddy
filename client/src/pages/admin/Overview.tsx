import { useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  FolderKanban,
  Users,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAdminStore } from "@/lib/admin-store";

import { AdminErrorBanner, StatusBadge, formatAdminDate } from "./admin-page-utils";

const metricItems = [
  { key: "users", label: "Users", icon: Users },
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "runs", label: "Runs", icon: Activity },
  { key: "failures", label: "Failures", icon: AlertTriangle },
  { key: "audit", label: "Audit", icon: ClipboardList },
] as const;

export function AdminOverviewPage() {
  const summary = useAdminStore(state => state.summary);
  const users = useAdminStore(state => state.users);
  const projects = useAdminStore(state => state.projects);
  const runs = useAdminStore(state => state.runs);
  const failures = useAdminStore(state => state.failures);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadOverview = useAdminStore(state => state.loadOverview);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return (
    <section data-testid="admin-overview-page" className="space-y-4">
      <AdminErrorBanner error={error} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metricItems.map(item => {
          const Icon = item.icon;
          return (
            <Card key={item.key} className="rounded-lg py-4">
              <CardHeader className="flex-row items-center justify-between gap-2 px-4 pb-2">
                <CardDescription>{item.label}</CardDescription>
                <Icon className="size-4 text-slate-400" />
              </CardHeader>
              <CardContent className="px-4">
                <p className="text-2xl font-semibold">
                  {loading && !summary ? "..." : summary?.[item.key] ?? 0}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="rounded-lg xl:col-span-2">
          <CardHeader className="px-4 py-4">
            <CardTitle className="text-base">Recent Users</CardTitle>
            <CardDescription>Newest accounts visible to admins.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-4 pb-4">
            {users.slice(0, 5).map(user => (
              <div
                key={user.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {user.displayName || user.email}
                  </p>
                  <p className="truncate text-xs text-slate-500">{user.email}</p>
                </div>
                <StatusBadge value={user.role} />
              </div>
            ))}
            {!users.length ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-slate-500">
                No users loaded.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="px-4 py-4">
            <CardTitle className="text-base">Operational Snapshot</CardTitle>
            <CardDescription>Read-only backend inventory.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Active projects</span>
              <span className="font-medium">
                {projects.filter(project => project.status === "active").length}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Open runs</span>
              <span className="font-medium">{runs.length}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Failures</span>
              <span className="font-medium">{failures.length}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Latest project</span>
              <span className="truncate font-medium">
                {formatAdminDate(projects[0]?.createdAt)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
