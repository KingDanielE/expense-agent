import type { ExpenseStatus } from "@/db/schema";
import { STATUS_LABEL } from "@/web/format";

export function StatusPill({ status }: { status: ExpenseStatus }) {
  return <span className={`pill s-${status}`}>{STATUS_LABEL[status]}</span>;
}
