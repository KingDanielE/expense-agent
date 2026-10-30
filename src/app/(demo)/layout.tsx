import Link from "next/link";
import { listInbox } from "@/web/queries";
import { getViewer, listPeople } from "@/web/session";
import { ActorSwitcher } from "@/app/_components/actor-switcher";

export const dynamic = "force-dynamic";

// The demo app's shell: "acting as" switcher, nav, and the synthetic-data note.
export default async function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [viewer, people] = await Promise.all([getViewer(), listPeople()]);
  const inbox = await listInbox(viewer);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>
              ◆
            </span>
            Expense Agent
          </Link>
          <nav className="nav">
            <Link href="/demo">My expenses</Link>
            <Link href="/approvals">
              Approvals{inbox.length > 0 && <span className="count">{inbox.length}</span>}
            </Link>
          </nav>
          <ActorSwitcher people={people} current={viewer.id} />
        </div>
      </header>
      <main className="page">{children}</main>
      <footer className="footer">
        Northwind Labs is fictional. Every person, salary and receipt here is synthetic.{" "}
        <Link href="/">About this project</Link>
      </footer>
    </>
  );
}
