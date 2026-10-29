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
| Ordinary receipts the reviewer flagged | 0 / 20 |
| Reviewer failures (fell back to a human) | 0 |
| Errors | 0 |
| Cost per claim | $0.0009 (total $0.04) |
| Latency per claim p50 / p95 | 5.3s / 8.4s |

## Not correct

| Receipt | Tags | Expected | Got | Verdict | Extraction misses | Reviewer flags |
|---|---|---|---|---|---|---|
| h01 | handwritten_tip, tip_pushes_over_limit | approve | needs_approval (finance) | over_escalation | — | finance: The receipt's tip ($14.00) and total ($81.50) are handwritten over printed lines, which could indicate the receipt was altered, so the amounts should be checked against the original before payment. |
| h18 | arithmetic_mismatch | needs_approval (manager) | needs_approval (manager, finance) | over_escalation | — | finance: The receipt's total is $10.00 higher than its subtotal plus tax, with no tip shown, while the subtotal and tax agree with each other, which could indicate an edited total. |

## Extraction misses by field

- is_receipt: none
- merchant: none
- date: h04
- currency: none
- total: none
- category: none
- alcohol: none
- injection: none
