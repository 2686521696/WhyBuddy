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
  formatAdminValue,
} from "./admin-page-utils";

export function AdminRunsPage() {
  const runs = useAdminStore(state => state.runs);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadRuns = useAdminStore(state => state.loadRuns);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  return (
    <section data-testid="admin-runs-page" className="space-y-3">
      <AdminErrorBanner error={error} />
      <AdminTableShell title="Runs" description="Execution run feed.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map(run => (
              <TableRow key={run.id}>
                <TableCell>
                  <div className="min-w-48">
                    <p className="font-medium">
                      {formatAdminValue(run.title || run.id)}
                    </p>
                    <p className="text-xs text-slate-500">{run.id}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge value={run.status} />
                </TableCell>
                <TableCell>{formatAdminValue(run.projectId)}</TableCell>
                <TableCell>{formatAdminValue(run.userId)}</TableCell>
                <TableCell>{formatAdminDate(run.startedAt ?? run.createdAt)}</TableCell>
                <TableCell>{formatAdminDate(run.completedAt)}</TableCell>
              </TableRow>
            ))}
            {!runs.length ? (
              <EmptyTableRow
                colSpan={6}
                label={loading ? "Loading runs..." : "No runs returned."}
              />
            ) : null}
          </TableBody>
        </Table>
      </AdminTableShell>
    </section>
  );
}
