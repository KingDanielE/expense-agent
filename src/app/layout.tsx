import type { Metadata } from "next";
import Link from "next/link";
import { listInbox } from "@/web/queries";
import { getViewer, listPeople } from "@/web/session";
import { ActorSwitcher } from "./_components/actor-switcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "Expense Agent",
  description: "A permission-aware expense review agent with an auditable run log and evals.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [viewer, people] = await Promise.all([getViewer(), listPeople()]);
  const inbox = await listInbox(viewer);

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden>
                ◆
              </span>
              Expense Agent
            </Link>
            <nav className="nav">
              <Link href="/">My expenses</Link>
              <Link href="/approvals">
                Approvals{inbox.length > 0 && <span className="count">{inbox.length}</span>}
              </Link>
            </nav>
            <ActorSwitcher people={people} current={viewer.id} />
          </div>
        </header>
        <main className="page">{children}</main>
        <footer className="footer">
          Northwind Labs is fictional. Every person, salary and receipt here is synthetic.
        </footer>
      </body>
    </html>
  );
}
