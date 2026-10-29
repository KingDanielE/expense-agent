import { decide } from "../actions";

export function DecideForm({ approvalId, back }: { approvalId: string; back: string }) {
  return (
    <form action={decide} className="stack">
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="back" value={back} />
      <textarea name="comment" placeholder="Comment for the employee (optional)" aria-label="Comment" />
      <div className="row">
        <button className="btn primary" name="decision" value="approve" type="submit">
          Approve
        </button>
        <button className="btn danger" name="decision" value="reject" type="submit">
          Reject
        </button>
      </div>
    </form>
  );
}
