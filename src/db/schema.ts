import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["employee", "manager", "finance", "it", "people_ops"]);
export type Role = (typeof roleEnum.enumValues)[number];

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  homeCurrency: text("home_currency").notNull().default("USD"),
  createdAt: createdAt(),
});

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => departments.id),
  managerId: uuid("manager_id").references((): AnyPgColumn => employees.id),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  title: text("title").notNull(),
  role: roleEnum("role").notNull().default("employee"),
  // Sensitive: exists so the permission layer (Phase 2) has something to keep from the agent.
  salaryCents: integer("salary_cents").notNull(),
  createdAt: createdAt(),
});

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.companyId, t.version)],
);

// --- expenses, agent runs, approvals, jobs (Phases 2-3) ---------------------------------------

export const expenseStatusEnum = pgEnum("expense_status", [
  "submitted",
  "processing",
  "waiting_approval",
  "approved",
  "rejected",
  "needs_info",
]);
export type ExpenseStatus = (typeof expenseStatusEnum.enumValues)[number];

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    filePath: text("file_path").notNull(), // relative to the project root, or absolute (uploads)
    fileSha256: text("file_sha256").notNull(),
    // Hash of the submitter's IP, for the public demo's per-visitor limit. Never the IP itself.
    visitor: text("visitor"),
    status: expenseStatusEnum("status").notNull().default("submitted"),
    // Filled by the run: the validated Receipt, and the final decision (policy engine + review).
    extraction: jsonb("extraction"),
    decision: jsonb("decision"),
    category: text("category"),
    expenseDate: text("expense_date"), // YYYY-MM-DD, for duplicate and daily-limit checks
    merchant: text("merchant"),
    currency: text("currency"),
    totalMinor: integer("total_minor"), // in the receipt's currency
    reimbursableUsdCents: integer("reimbursable_usd_cents"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("expenses_employee_date").on(t.employeeId, t.expenseDate)],
);

export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
]);
export type RunStatus = (typeof runStatusEnum.enumValues)[number];

// One agent run per expense. `stage` is the durable cursor: a crashed worker resumes from it.
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  expenseId: uuid("expense_id")
    .notNull()
    .references(() => expenses.id),
  actingFor: uuid("acting_for")
    .notNull()
    .references(() => employees.id),
  status: runStatusEnum("status").notNull().default("queued"),
  stage: text("stage").notNull().default("extract"),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The audit log: every model call, tool call, permission check and decision, in order.
export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    actorId: uuid("actor_id").references(() => employees.id),
    permission: text("permission"), // "allowed" | "denied" | null
    input: jsonb("input"),
    output: jsonb("output"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costMicroUsd: integer("cost_micro_usd"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.runId, t.seq)],
);

export const approvalStatusEnum = pgEnum("approval_status", ["waiting", "pending", "approved", "rejected"]);

// An approval chain: rows are decided in `seq` order; only the lowest undecided row is "pending".
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id),
    seq: integer("seq").notNull(),
    approverId: uuid("approver_id").references(() => employees.id), // a named person, or
    approverRole: roleEnum("approver_role"), // anyone with this role except the submitter
    reason: text("reason").notNull(),
    status: approvalStatusEnum("status").notNull().default("waiting"),
    decidedBy: uuid("decided_by").references(() => employees.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.expenseId, t.seq)],
);

export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "done", "dead"]);

// Postgres-backed queue (SELECT ... FOR UPDATE SKIP LOCKED). See src/jobs/queue.ts.
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_due").on(t.status, t.runAt)],
);
