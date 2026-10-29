import Link from "next/link";
import type { ExpenseDecision } from "@/runs/process";
import { money, usd, when } from "@/web/format";
import { listInbox } from "@/web/queries";
import { getViewer } from "@/web/session";
import { DecideForm } from "../_components/decide-form";

export const maxDuration = 30;

export default async function Approvals({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const viewer = await getViewer();
  const inbox = await listInbox(viewer);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="sub">Claims waiting for {viewer.name}, as {viewer.title}.</p>
        </div>
      </div>
      {error && <p className="notice">{error}</p>}

      {inbox.length === 0 ? (
        <p className="card empty">
          Nothing waiting for you. Switch to a manager, IT or Finance to see their queue.
        </p>
      ) : (
        <div className="stack">
          {inbox.map(({ approval, expense, owner }) => {
            const decision = expense.decision as ExpenseDecision | null;
            const final = decision?.final;
            const review = decision?.review && "notes_for_approver" in decision.review ? decision.review : null;
            return (
              <article key={approval.id} className="card approval">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="thumb" src={`/api/receipts/${expense.id}`} alt={`Receipt from ${expense.merchant ?? "unknown merchant"}`} />
                <div className="stack">
                  <div className="row spread">
                    <div>
                      <h3 dir="auto">{expense.merchant}</h3>
                      <p className="sub">
                        {owner.name} · {expense.expenseDate} · submitted {when(expense.submittedAt)}
                      </p>
                    </div>
                    <div className="num">
                      <div className="big">{usd(final?.reimbursableUsdCents)}</div>
                      <div className="sample-hint">receipt {money(expense.totalMinor, expense.currency)}</div>
                    </div>
                  </div>
                  <p className="reason">
                    <strong>Step {approval.seq}: </strong>
                    {approval.reason}
                  </p>
                  {review?.notes_for_approver && (
                    <p className="note" dir="auto">
                      <strong>Reviewer: </strong>
                      {review.notes_for_approver}
                    </p>
                  )}
                  {final && final.adjustments.length > 0 && (
                    <ul className="lines">
                      {final.adjustments.map((a, i) => (
                        <li key={i}>
                          <span>{a.text}</span>
                          <span className="minus">{usd(a.usdCents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <DecideForm approvalId={approval.id} back="/approvals" />
                  <Link href={`/expenses/${expense.id}`}>Full run log →</Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
