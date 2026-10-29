import Link from "next/link";
import { money, usd, when } from "@/web/format";
import { listMyExpenses } from "@/web/queries";
import { SAMPLES } from "@/web/samples";
import { getViewer } from "@/web/session";
import { submitSample, submitUpload } from "./actions";
import { AutoRefresh } from "./_components/auto-refresh";
import { StatusPill } from "./_components/status";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const viewer = await getViewer();
  const mine = await listMyExpenses(viewer);
  const busy = mine.some((e) => e.status === "submitted" || e.status === "processing");
  const hard = SAMPLES.filter((s) => s.id.startsWith("h"));
  const ordinary = SAMPLES.filter((s) => s.id.startsWith("n"));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My expenses</h1>
          <p className="sub">
            {viewer.name}, {viewer.title}
          </p>
        </div>
      </div>
      {error && <p className="notice">{error}</p>}
      <AutoRefresh active={busy} />

      <div className="grid-2">
        <section className="card">
          <h2>Claims</h2>
          {mine.length === 0 ? (
            <p className="empty">No claims yet. Submit a receipt to see the agent work.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Merchant</th>
                    <th>Date</th>
                    <th className="num">Receipt</th>
                    <th className="num">Reimbursed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/expenses/${e.id}`} dir="auto">
                          {e.merchant ?? "Reading receipt…"}
                        </Link>
                        <div className="sample-hint">submitted {when(e.submittedAt)}</div>
                      </td>
                      <td>{e.expenseDate ?? "—"}</td>
                      <td className="num">{money(e.totalMinor, e.currency)}</td>
                      <td className="num">{e.status === "rejected" || e.status === "needs_info" ? "—" : usd(e.reimbursableUsdCents)}</td>
                      <td>
                        <StatusPill status={e.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card stack">
          <h2>Submit a receipt</h2>
          <form action={submitUpload} className="stack">
            <input type="file" name="receipt" accept=".png,.jpg,.jpeg,.webp,.pdf" required />
            <button className="btn primary" type="submit">
              Upload and submit
            </button>
          </form>
          <p className="or">or try one of the test receipts</p>
          <form action={submitSample} className="samples">
            <select name="sample" defaultValue="h06" aria-label="Test receipt">
              <optgroup label="Hard cases">
                {hard.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Ordinary">
                {ordinary.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <button className="btn" type="submit">
              Submit as {viewer.name.split(" ")[0]}
            </button>
            <p className="sample-hint">
              Rendered, synthetic receipts. Limits depend on who submits: managers get a higher meal limit.
            </p>
          </form>
        </section>
      </div>
    </>
  );
}
