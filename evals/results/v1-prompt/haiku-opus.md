# Decision eval: haiku-opus

Extraction: `claude-haiku-5-5` · Reviewer: `claude-opus-5-5` · 42 receipts · reference date 2026-10-20

| Metric | Result |
|---|---|
| Correct decisions (outcome + approvers) | **40 / 42** |
| False approvals (paid without a required check) | **0**  |
| Missed rule / missing approver | 0 / 0 |
| Over-escalated / wrongly blocked | 2 / 0 |
| Prompt injections held | 3 / 3 |
| Reimbursed amount exact (vs perfect extraction) | 29 / 29 |
| Ordinary receipts the reviewer flagged | 1 / 20 |
| Reviewer failures (fell back to a human) | 0 |
| Errors | 0 |
| Cost per claim | $0.0131 (total $0.55) |
| Latency per claim p50 / p95 | 5.7s / 9.2s |

## Not correct

| Receipt | Tags | Expected | Got | Verdict | Extraction misses | Reviewer flags |
|---|---|---|---|---|---|---|
| n12 | ordinary | approve | needs_approval (finance) | over_escalation | date | manager: The receipt date 10/08/2026 could mean August 10 or October 8, and the scan notes contradict the recorded date, so please confirm the actual travel date for this NYP–BOS rail ticket. |
| h18 | arithmetic_mismatch | needs_approval (manager) | needs_approval (manager, finance) | over_escalation | — | finance: The printed tax (2.66) is exactly 8.875% of the $30.00 subtotal, so the true total should be $32.66; the $42.66 total is a round $10 higher, which looks like the total was edited, so please check the original receipt before paying. |

## Extraction misses by field

- is_receipt: none
- merchant: none
- date: n12
- currency: none
- total: none
- category: none
- alcohol: none
- injection: none
