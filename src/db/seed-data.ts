import type { Role } from "./schema";

// Fictional company used everywhere (seed, receipts, evals). Salaries are synthetic.
export const COMPANY = { name: "Northwind Labs", homeCurrency: "USD" };

export const DEPARTMENTS = ["Engineering", "Sales", "Finance", "IT", "People Ops"] as const;

export type SeedEmployee = {
  name: string;
  email: string;
  title: string;
  department: (typeof DEPARTMENTS)[number];
  role: Role;
  manager: string | null; // manager's email
  salary: number; // USD per year
};

export const EMPLOYEES: SeedEmployee[] = [
  { name: "Maya Chen", email: "maya@northwind.test", title: "VP Finance", department: "Finance", role: "finance", manager: null, salary: 240_000 },
  { name: "Jamie Soto", email: "jamie@northwind.test", title: "Finance Analyst", department: "Finance", role: "finance", manager: "maya@northwind.test", salary: 120_000 },
  { name: "Jordan Reyes", email: "jordan@northwind.test", title: "Head of Engineering", department: "Engineering", role: "manager", manager: null, salary: 280_000 },
  { name: "Priya Natarajan", email: "priya@northwind.test", title: "Software Engineer", department: "Engineering", role: "employee", manager: "jordan@northwind.test", salary: 185_000 },
  { name: "Sam Okafor", email: "sam@northwind.test", title: "Software Engineer", department: "Engineering", role: "employee", manager: "jordan@northwind.test", salary: 170_000 },
  { name: "Alex Novak", email: "alex@northwind.test", title: "Head of Sales", department: "Sales", role: "manager", manager: null, salary: 230_000 },
  { name: "Taylor Brooks", email: "taylor@northwind.test", title: "Account Executive", department: "Sales", role: "employee", manager: "alex@northwind.test", salary: 140_000 },
  { name: "Riley Kim", email: "riley@northwind.test", title: "Account Executive", department: "Sales", role: "employee", manager: "alex@northwind.test", salary: 135_000 },
  { name: "Morgan Lee", email: "morgan@northwind.test", title: "IT Lead", department: "IT", role: "it", manager: null, salary: 160_000 },
  { name: "Casey Ward", email: "casey@northwind.test", title: "People Ops Lead", department: "People Ops", role: "people_ops", manager: null, salary: 150_000 },
];
