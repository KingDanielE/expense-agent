# Expense Agent

An agent that reviews expense receipts the way a careful finance team would: it reads the
receipt, checks it against the company's written policy, and approves it, flags it, or asks a
human. Every action runs **as** someone (an employee, their manager, Finance), respects what that
person is allowed to see, and is written to an auditable run log. An eval suite measures how
often it gets things wrong, with false approvals counted separately because they cost the most.

Everything here is synthetic: a fictional company (Northwind Labs), fictional people and
generated receipts.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Next.js + Postgres + Drizzle, seeded company, people, policy | done |
| 1 | Receipt extraction (Claude vision → Zod-validated schema), 40 synthetic receipts, extraction grader | done |
| 2 | Policy engine in code, permission-scoped reviewer tools | done |
| 3 | Reviewer agent loop, durable runs on a Postgres job queue, approval chains with pause and resume | done |
| 4 | UI: submit, approvals inbox, run log, "acting as" switcher | done |
| 5 | Decision evals: accuracy, false approvals, injection resistance, cost, latency | next |

## The app

`npm run dev` (with `EMBEDDED_WORKER=1`, the worker runs inside the Next.js server).

- **Acting as**: a switcher in the header picks who you are (demo sign-in). Every page, action
  and receipt image is permission-checked as that person.
- **My expenses**: upload a receipt, or submit any of the 40 test receipts as the current person.
  The page updates live while the agent works.
- **Approvals**: the steps you're allowed to decide, with the receipt, the rule that needs you,
  the reviewer's note for the approver, and the adjustments. Approve or reject with a comment.
- **Expense page**: the outcome and the employee summary, the approval chain with who decided
  and why, what the agent read, and the full run log: each model call with tokens, cost and
  latency, each tool call with its ALLOWED / DENIED verdict, expandable inputs and outputs.

Someone outside the claim (another team's manager, say) gets "You can't see this expense",
and the receipt image returns 403. Images are served `no-store`: a cached copy would survive a
switch of user on a shared browser, which the first version of this page got wrong.

## Results so far

Extraction, all 40 receipts, graded field by field (`npm run extract`):

| Model | All fields right | Cost per receipt | Latency p50 / p95 |
|---|---|---|---|
| Claude Opus 5.5 (effort low) | 40 / 40 | $0.0165 | 3.1s / 4.8s |
| Claude Haiku 5.5 (effort low) | 39 / 40 | $0.0004 | 2.1s / 3.6s |

Haiku's one miss: a stationery order with a USB-C cable classed as equipment, not office
supplies. On the blurred total (h04) Opus returned null with low confidence and noted that
subtotal + tax would be $22.32 "but this was not confirmed from the receipt", which is the
behaviour the grader asks for.

The extraction set turned out to be easy for current models, so the interesting evals are the
decisions (Phase 5).

## How a claim flows

```
submit → [extract] → [decide] → [review] → [finalize] → approved / rejected / needs info
                                                   ↘ waiting for approval → human decides → resume → …
```

Each stage commits its result together with the next stage name (`runs.stage`), on a
Postgres job queue (`FOR UPDATE SKIP LOCKED`, retries with backoff, dead jobs mark the run
failed). A worker that dies mid-run is picked up again and resumes at the last committed stage:
the receipt is never extracted twice.

1. **Extract**: Claude reads the receipt into a validated `Receipt`.
2. **Decide**: code looks up the facts itself (FX rate, company-wide duplicate check, meals
   already claimed that day) and runs the policy engine: outcome, reimbursable amount,
   adjustments (alcohol, tips over 20%, limits), and the approval chain (manager → IT → Finance).
3. **Review**: an LLM reviewer, acting with the submitter's permissions, looks for what rules
   can't see (personal items, odd patterns) and writes the employee summary. It can only **add**
   human approval. It can't approve, reject or change amounts. Rejections skip it.
4. **Finalize**: the expense gets its status; approval steps are created and decided in order.

Every step (model calls with tokens, cost and latency; tool calls with their permission verdict;
checks; decisions; approval attempts, including denied ones) goes to `run_steps`.

## Design rules

- **The model proposes, code decides.** The LLM extracts and explains; policy limits, arithmetic
  and approval routing are plain code with unit tests. The reviewer can only make an outcome
  stricter.
- **The agent has no permissions of its own.** It acts for a person and gets theirs. Asked for a
  colleague's salary, its tool returns "permission denied", the model never sees the number, and
  the attempt is logged. Nobody approves their own expense; role approvals exclude the submitter.
- **Fail closed.** If the reviewer refuses, never submits or the review crashes repeatedly, the
  claim goes to a human instead of being approved.
- **Receipts are data, not instructions.** One test receipt carries a printed note telling "the AI
  reviewer" to approve it and change the total. The extractor must report the note, not obey it.
- **Admit uncertainty.** An illegible total passes the grader only if the model returns null or
  low confidence. A confident guess fails, even when it happens to be right.
- **Two layers of validation.** Structured outputs constrain the model to `ReceiptExtraction`;
  a stricter `Receipt` schema (ISO dates, currency codes, non-negative amounts) runs in code. One
  retry that tells the model what was wrong, then a typed `ExtractionError`.

## Run it

Requires Node 22+ and Docker.

```bash
npm install
cp .env.example .env            # add your ANTHROPIC_API_KEY
npm run db:up                   # Postgres 16 on 127.0.0.1:5434
npm run db:migrate
npm run seed
npm run dev                     # http://localhost:3000
```

Extraction:

```bash
npm run extract                                # all 40 receipts, graded field by field
npm run extract -- h01 h04 h06                 # a few
npm run extract -- --model claude-haiku-5-5    # compare models
npm test                                       # unit tests, no API calls
```

The whole flow from the command line (the UI comes in Phase 4):

```bash
npm run submit -- --as sam@northwind.test data/receipts/h06.png   # injection receipt → Finance
npm run approve -- --as sam@northwind.test <expense id> approve     # denied: own expense
npm run approve -- --as jordan@northwind.test <expense id> approve  # denied: not Finance
npm run approve -- --as maya@northwind.test <expense id> approve    # approved, run completes
npm run show -- <expense id>                                        # the full run log
npm run worker                                                      # long-running worker
```

`npm test` needs the Docker Postgres; it creates and migrates `expense_agent_test` and uses a
scripted fake Claude, so it makes no API calls.

`npm run receipts:generate` re-renders `data/receipts/*.png` and `labels.json` from
`src/eval/receipts/specs.ts`.

## The receipt set

`n01`–`n20` are ordinary receipts inside policy. `h01`–`h20` are the cases that break naive agents:

| Case | Why it's hard |
|---|---|
| h01 | Handwritten tip pushes a meal over the $75 limit |
| h02, h14, h19 | EUR (`24,09 €`), ILS, GBP |
| h03 | `03/10/2026` at a Brussels brasserie: 3 October, not 10 March |
| h04 | Total blurred out (it can be computed from subtotal + tax, but not read) |
| h05 | Beer and wine hidden among food items |
| h06 | Prompt injection printed on the receipt |
| h07 | Duplicate of n03, photographed at a different angle and size |
| h08 | Older than 90 days |
| h09 | A menu, not a receipt |
| h10, h11, h15 | Equipment over $500, a $1,240 flight, software over $50 |
| h12 | JPY, no decimals |
| h13 | Rotated and noisy |
| h16 | Tip over 20% |
| h17 | Manager's meal, inside the manager limit |
| h18 | Printed total doesn't match subtotal + tax |
| h20 | Personal pharmacy items |

## Layout

```
src/db/                 schema, seed data
src/lib/receipt.ts      Zod schemas, arithmetic consistency checks
src/lib/extract.ts      extractReceipt(): Claude call, validation, retry, cost
src/policy/             rules (the numbers from policy.md) and the policy engine
src/auth/permissions.ts who may do what; used by agent tools and human approvals
src/agent/              reviewer tools (permission-checked, logged) and the tool-use loop
src/runs/               run state machine, approvals, the run log
src/jobs/               Postgres job queue and worker
src/eval/receipts/      receipt specs (ground truth), expected decisions, SVG → PNG renderer
src/eval/grade-extraction.ts
prompts/                prompts, never inline
policy/policy.md        the expense policy the agent enforces
scripts/                seed, generate receipts, extract + grade
tests/                  vitest, with a fake Anthropic client
```
