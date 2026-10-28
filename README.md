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
| 2 | Tools, policy engine in code, permission-scoped tool context | next |
| 3 | Agent loop, durable runs, pause for approval and resume | |
| 4 | UI: submit, approvals inbox, run log | |
| 5 | Decision evals: accuracy, false approvals, injection resistance, cost, latency | |

## Design rules

- **The model proposes, code decides.** The LLM extracts and explains; policy limits, arithmetic
  and approval routing are plain code with unit tests.
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
src/eval/receipts/      receipt specs (ground truth) and SVG → PNG renderer
src/eval/grade-extraction.ts
prompts/                prompts, never inline
policy/policy.md        the expense policy the agent enforces
scripts/                seed, generate receipts, extract + grade
tests/                  vitest, with a fake Anthropic client
```
