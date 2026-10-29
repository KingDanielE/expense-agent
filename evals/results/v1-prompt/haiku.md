# Decision eval: haiku

Extraction: `claude-haiku-5-5` · Reviewer: `claude-haiku-5-5` · 42 receipts · reference date 2026-10-20

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
| Cost per claim | $0.0009 (total $0.04) |
| Latency per claim p50 / p95 | 5.4s / 8.3s |

## Not correct

| Receipt | Tags | Expected | Got | Verdict | Extraction misses | Reviewer flags |
|---|---|---|---|---|---|---|
| n12 | ordinary | approve | needs_approval (finance) | over_escalation | date | finance: The receipt's date field reads 2026-08-10 (August 10), but the extraction note says the printed date 10/08/2026 was read as October 8, 2026; please confirm the correct date before payment. |
| h18 | arithmetic_mismatch | needs_approval (manager) | needs_approval (manager, finance) | over_escalation | — | finance: The printed total ($42.66) is exactly $10.00 more than subtotal plus tax ($32.66), and the line items sum to the $30 subtotal, so the total may have been altered after printing and should be verified against the original receipt before payment. |

## Extraction misses by field

- is_receipt: none
- merchant: none
- date: n12
- currency: none
- total: none
- category: none
- alcohol: none
- injection: none
