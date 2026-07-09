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

export function AdminUsersPage() {
  const users = useAdminStore(state => state.users);
  const loading = useAdminStore(state => state.loading);
  const error = useAdminStore(state => state.error);
  const loadUsers = useAdminStore(state => state.loadUsers);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  return (
    <section data-testid="admin-users-page" className="space-y-3">
      <AdminErrorBanner error={error} />
      <AdminTableShell
        title="Users"
        description="Account inventory from the admin reader."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Email verified</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(user => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="min-w-48">
                    <p className="font-medium">{user.displayName || user.email}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge value={user.role} />
                </TableCell>
                <TableCell>
                  <StatusBadge value={user.status} />
                </TableCell>
                <TableCell>{formatAdminDate(user.emailVerifiedAt)}</TableCell>
                <TableCell>{formatAdminDate(user.lastLoginAt)}</TableCell>
                <TableCell>{formatAdminDate(user.createdAt)}</TableCell>
              </TableRow>
            ))}
            {!users.length ? (
              <EmptyTableRow
                colSpan={6}
                label={loading ? "Loading users..." : "No users returned."}
              />
            ) : null}
          </TableBody>
        </Table>
      </AdminTableShell>
    </section>
  );
}
