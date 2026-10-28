import {
  type AnyPgColumn,
  integer,
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
