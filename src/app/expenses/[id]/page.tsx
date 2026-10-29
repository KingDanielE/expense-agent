import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/auth/permissions";
import type { Receipt } from "@/lib/receipt";
import type { ExpenseDecision } from "@/runs/process";
import { money, usd, when } from "@/web/format";
import { getExpenseView } from "@/web/queries";
import { getViewer } from "@/web/session";
import { AutoRefresh } from "../../_components/auto-refresh";
import { DecideForm } from "../../_components/decide-form";
import { StatusPill } from "../../_components/status";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> };

export default async function ExpensePage({ params, searchParams }: Params) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const viewer = await getViewer();
  const view = await getExpenseView(id, viewer);
  if (!view) notFound();
  if ("denied" in view) {
    return (
      <div className="card stack">
        <h1>You can&apos;t see this expense</h1>
        <p className="sub">Acting as {viewer.name}: {view.denied}.</p>
        <Link href="/">Back to my expenses</Link>
      </div>
    );
  }

  const { expense, owner, chain, run, steps, people, decidable } = view;
  const extraction = expense.extraction as { receipt: Receipt; warnings: string[] } | null;
  const decision = expense.decision as ExpenseDecision | null;
  const final = decision?.final;
  const review = decision?.review && "summary_for_employee" in decision.review ? decision.review : null;
  const reviewFailed = decision?.review && "failed" in decision.review ? decision.review.failed : null;
  const busy = run?.status === "queued" || run?.status === "running";
  const canDecide =
    decidable &&
    can(viewer, {
      action: "expense.decide",
      owner: { id: owner.id, companyId: owner.companyId, managerId: owner.managerId },
      approval: decidable,
    }).allowed;

  const totals = steps.reduce(
    (t, s) => ({
      cost: t.cost + (s.costMicroUsd ?? 0) / 1e6,
      tokens: t.tokens + (s.inputTokens ?? 0) + (s.outputTokens ?? 0),
      calls: t.calls + (s.model ? 1 : 0),
      denied: t.denied + (s.permission === "denied" ? 1 : 0),
    }),
    { cost: 0, tokens: 0, calls: 0, denied: 0 },
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 dir="auto">{expense.merchant ?? "Reading receipt…"}</h1>
          <p className="sub">
            {owner.name} · submitted {when(expense.submittedAt)}
          </p>
        </div>
        <StatusPill status={expense.status} />
      </div>
      {error && <p className="notice">{error}</p>}
      <AutoRefresh active={busy} />

      <div className="grid-2">
        <div className="stack">
          {final && (
            <section className="card stack">
              <div className="row spread">
                <div>
                  <div className="sample-hint">Reimbursed</div>
                  <div className="big">{final.outcome === "reject" || final.outcome === "needs_info" ? "—" : usd(final.reimbursableUsdCents)}</div>
                </div>
                <div className="num">
                  <div className="sample-hint">Receipt</div>
                  <div>{money(expense.totalMinor, expense.currency)}</div>
                  {expense.currency !== "USD" && final.claimedUsdCents != null && (
                    <div className="sample-hint">≈ {usd(final.claimedUsdCents)}</div>
                  )}
                </div>
              </div>
              {review?.summary_for_employee ? (
                <p className="summary" dir="auto">{review.summary_for_employee}</p>
              ) : (
                final.findings.length > 0 && <p className="summary">{final.findings.map((f) => f.text).join(" ")}</p>
              )}
              {final.adjustments.length > 0 && (
                <ul className="lines">
                  {final.adjustments.map((a, i) => (
                    <li key={i}>
                      <span>{a.text}</span>
                      <span className="minus">{usd(a.usdCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {reviewFailed && <p className="note">The AI review didn&apos;t finish ({reviewFailed}), so a person checks this claim.</p>}
            </section>
          )}

          {chain.length > 0 && (
            <section className="card stack">
              <h2>Approvals</h2>
              <ol className="chain">
                {chain.map((a) => (
                  <li key={a.id}>
                    <span className="n">{a.seq}</span>
                    <div>
                      <div className="row">
                        <strong>{a.approverId ? people[a.approverId] : `${a.approverRole === "it" ? "IT" : "Finance"} team`}</strong>
                        <span className={`pill ${a.status === "approved" ? "s-approved" : a.status === "rejected" ? "s-rejected" : a.status === "pending" ? "s-waiting_approval" : ""}`}>
                          {a.status}
                        </span>
                      </div>
                      <p className="sample-hint">{a.reason}</p>
                      {a.decidedBy && (
                        <p className="sample-hint">
                          {people[a.decidedBy]}
                          {a.comment ? `: “${a.comment}”` : ""}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {review?.notes_for_approver && decidable && (
                <p className="note" dir="auto">
                  <strong>Reviewer: </strong>
                  {review.notes_for_approver}
                </p>
              )}
              {canDecide && <DecideForm approvalId={decidable!.id} back={`/expenses/${expense.id}`} />}
            </section>
          )}

          <section className="card stack">
            <div className="row spread">
              <h2>Run log</h2>
              <div className="totals">
                <span>{steps.length} steps</span>
                <span>{totals.calls} model calls</span>
                <span>{totals.tokens.toLocaleString()} tokens</span>
                <span>${totals.cost.toFixed(4)}</span>
                {totals.denied > 0 && <span className="perm denied">{totals.denied} denied</span>}
              </div>
            </div>
            {run && (
              <p className="sample-hint">
                The agent acted for {people[run.actingFor]}, with their permissions. Run {run.status}
                {run.error ? `: ${run.error}` : ""}.
              </p>
            )}
            <ol className="timeline">
              {steps.map((s) => {
                const output = JSON.stringify(s.output ?? s.input ?? null);
                return (
                  <li key={s.id} className="step">
                    <span className="seq">{String(s.seq).padStart(2, "0")}</span>
                    <div>
                      <div className="step-head">
                        <span className={`step-type t-${s.type}`}>{s.type}</span>
                        <strong>{s.name}</strong>
                        {s.actorId && <span className="step-meta">as {people[s.actorId]}</span>}
                        {s.permission && <span className={`perm ${s.permission}`}>{s.permission.toUpperCase()}</span>}
                      </div>
                      {(s.model || s.latencyMs != null) && (
                        <div className="step-meta">
                          {s.model && `${s.model} · ${s.inputTokens?.toLocaleString()} in / ${s.outputTokens?.toLocaleString()} out · $${((s.costMicroUsd ?? 0) / 1e6).toFixed(4)} · `}
                          {s.latencyMs != null && `${(s.latencyMs / 1000).toFixed(1)}s`}
                        </div>
                      )}
                      {(s.input != null || s.output != null) && (
                        <details>
                          <summary>{output.length > 140 ? `${output.slice(0, 140)}…` : output}</summary>
                          {s.input != null && <pre>{`input  ${JSON.stringify(s.input, null, 2)}`}</pre>}
                          {s.output != null && <pre>{`output ${JSON.stringify(s.output, null, 2)}`}</pre>}
                        </details>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="stack">
          <section className="card stack">
            <h2>Receipt</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {!expense.filePath.endsWith(".pdf") && <img className="receipt-img" src={`/api/receipts/${expense.id}`} alt="Submitted receipt" />}
          </section>
          {extraction && (
            <section className="card stack">
              <h2>What the agent read</h2>
              <dl className="facts">
                <dt>Merchant</dt>
                <dd dir="auto">{extraction.receipt.merchant}</dd>
                <dt>Date</dt>
                <dd>{extraction.receipt.date ?? "unreadable"}</dd>
                <dt>Category</dt>
                <dd>{extraction.receipt.category.replace("_", " ")}</dd>
                <dt>Total</dt>
                <dd>
                  {extraction.receipt.total ?? "unreadable"} {extraction.receipt.currency}
                </dd>
                <dt>Confidence</dt>
                <dd>
                  {Object.entries(extraction.receipt.confidence)
                    .filter(([, v]) => v !== "high")
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", ") || "high"}
                </dd>
              </dl>
              {extraction.receipt.line_items.length > 0 && (
                <ul className="lines">
                  {extraction.receipt.line_items.map((i, n) => (
                    <li key={n}>
                      <span dir="auto">
                        {i.quantity && i.quantity > 1 ? `${i.quantity} × ` : ""}
                        {i.description}
                        {i.is_alcohol && <span className="pill s-rejected"> alcohol</span>}
                      </span>
                      <span>{i.amount.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {extraction.receipt.notes && <p className="note" dir="auto">{extraction.receipt.notes}</p>}
              {extraction.warnings.map((w) => (
                <p key={w} className="reason">
                  {w}
                </p>
              ))}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
