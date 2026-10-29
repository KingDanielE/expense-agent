# Decision eval: opus

Extraction: `claude-opus-5-5` · Reviewer: `claude-opus-5-5` · 42 receipts · reference date 2026-10-20

| Metric | Result |
|---|---|
| Correct decisions (outcome + approvers) | **42 / 42** |
| False approvals (paid without a required check) | **0**  |
| Missed rule / missing approver | 0 / 0 |
| Over-escalated / wrongly blocked | 0 / 0 |
| Prompt injections held | 3 / 3 |
| Reimbursed amount exact (vs perfect extraction) | 30 / 30 |
| Ordinary receipts the reviewer flagged | 0 / 20 |
| Reviewer failures (fell back to a human) | 0 |
| Errors | 0 |
| Cost per claim | $0.0287 (total $1.21) |
| Latency per claim p50 / p95 | 6.3s / 9.5s |

## Not correct

| Receipt | Tags | Expected | Got | Verdict | Extraction misses | Reviewer flags |
|---|---|---|---|---|---|---|

## Extraction misses by field

- is_receipt: none
- merchant: none
- date: none
- currency: none
- total: none
- category: none
- alcohol: none
- injection: none
