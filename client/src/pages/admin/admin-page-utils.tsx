import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function formatAdminDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAdminValue(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const normalized = value?.toLowerCase() ?? "unknown";
  const variant =
    normalized.includes("fail") ||
    normalized.includes("error") ||
    normalized.includes("disabled")
      ? "destructive"
      : normalized.includes("active") ||
          normalized.includes("success") ||
          normalized.includes("done")
        ? "default"
        : "secondary";

  return (
    <Badge variant={variant} className="rounded-md capitalize">
      {value ?? "unknown"}
    </Badge>
  );
}

export function AdminErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertCircle className="size-4" />
      {error}
    </div>
  );
}

export function AdminTableShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="gap-1 px-4 py-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </Card>
  );
}

export function EmptyTableRow({
  colSpan,
  label,
}: {
  colSpan: number;
  label: string;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-20 text-center text-slate-500">
        {label}
      </TableCell>
    </TableRow>
  );
}

export {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
};
