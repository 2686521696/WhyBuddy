import { useEffect } from "react";

import { useAdminStore } from "@/lib/admin-store";

import {
  AdminErrorBanner,
  AdminTableShell,
  EmptyTableRow,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatAdminDate,
} from "./admin-page-utils";

export function AdminProjectsPage() {
  const projects = useAdminStore(state => state.projects);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadProjects = useAdminStore(state => state.loadProjects);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <section data-testid="admin-projects-page" className="space-y-3">
      <AdminErrorBanner error={error} />
      <AdminTableShell
        title="Projects"
        description="All project records without owner scoping."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Archived</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map(project => (
              <TableRow key={project.id}>
                <TableCell>
                  <div className="min-w-56">
                    <p className="font-medium">{project.name}</p>
                    <p className="max-w-md truncate text-xs text-slate-500">
                      {project.description || project.id}
                    </p>
                  </div>
                </TableCell>
                <TableCell>{project.ownerUserId}</TableCell>
                <TableCell>
                  <StatusBadge value={project.status} />
                </TableCell>
                <TableCell>
                  <StatusBadge value={project.source} />
                </TableCell>
                <TableCell>{formatAdminDate(project.updatedAt)}</TableCell>
                <TableCell>{formatAdminDate(project.archivedAt)}</TableCell>
              </TableRow>
            ))}
            {!projects.length ? (
              <EmptyTableRow
                colSpan={6}
                label={loading ? "Loading projects..." : "No projects returned."}
              />
            ) : null}
          </TableBody>
        </Table>
      </AdminTableShell>
    </section>
  );
}
