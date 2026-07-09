import { useEffect } from "react";

import { useAdminStore } from "@/lib/admin-store";

import {
  AdminErrorBanner,
  AdminTableShell,
  EmptyTableRow,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatAdminDate,
  formatAdminValue,
} from "./admin-page-utils";

export function AdminAuditPage() {
  const audit = useAdminStore(state => state.audit);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadAudit = useAdminStore(state => state.loadAudit);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  return (
    <section data-testid="admin-audit-page" className="space-y-3">
      <AdminErrorBanner error={error} />
      <AdminTableShell title="Audit" description="Admin-visible audit events.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.map(entry => (
              <TableRow key={entry.id}>
                <TableCell className="font-medium">{entry.id}</TableCell>
                <TableCell>
                  {formatAdminValue(entry.actorEmail ?? entry.actorId)}
                </TableCell>
                <TableCell>{formatAdminValue(entry.action)}</TableCell>
                <TableCell>
                  {formatAdminValue(
                    entry.targetType && entry.targetId
                      ? `${entry.targetType}:${entry.targetId}`
                      : entry.targetType ?? entry.targetId
                  )}
                </TableCell>
                <TableCell>{formatAdminDate(entry.createdAt)}</TableCell>
              </TableRow>
            ))}
            {!audit.length ? (
              <EmptyTableRow
                colSpan={5}
                label={loading ? "Loading audit..." : "No audit events returned."}
              />
            ) : null}
          </TableBody>
        </Table>
      </AdminTableShell>
    </section>
  );
}
