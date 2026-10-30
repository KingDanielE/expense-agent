import type { Metadata } from "next";
import Link from "next/link";
import s from "./landing.module.css";

export const metadata: Metadata = {
  title: "Expense Agent · Daniel Engelberg",
  description:
    "A permission-aware AI agent that reviews expense receipts: rules in code, an LLM reviewer that can only escalate, durable approval chains, an auditable run log and decision evals.",
};

const REPO = "https://github.com/KingDanielE/expense-agent";
const CV = "/cv/Daniel-Engelberg-CV.pdf";

const STAGES = [
  {
    name: "Extract",
    text: "Claude reads the receipt image into a typed schema. A stricter check runs in code; one corrective retry, then a typed error.",
  },
  {
    name: "Decide",
    text: "Plain code applies the written policy: limits, tip cap, alcohol, currency, duplicates, 90-day rule, and who must approve.",
  },
  {
    name: "Review",
    text: "An LLM reviewer, acting with the employee's permissions, looks for what rules can't see. It can only add a human check.",
  },
  {
    name: "Approve",
    text: "The run pauses for each approver in turn (manager, IT, Finance) and resumes on their decision. Every step is logged.",
  },
];

const RESULTS = [
  { config: "Opus 5.5 / Opus 5.5", correct: "42 / 42", cost: "$0.029", p95: "9.6s" },
  { config: "Sonnet 5.5 / Sonnet 5.5", correct: "42 / 42", cost: "$0.014", p95: "6.5s" },
  { config: "Haiku 5.5 / Haiku 5.5", correct: "40 / 42", cost: "$0.0009", p95: "8.4s" },
  { config: "Haiku 5.5 / Opus 5.5", correct: "40 / 42", cost: "$0.013", p95: "9.3s" },
];

const PRINCIPLES = [
  {
    title: "The model proposes, code decides",
    text: "Limits, arithmetic and approval routing are tested code. The reviewer can make an outcome stricter, never looser: it can't approve, reject or change an amount.",
  },
  {
    title: "The agent has no permissions of its own",
    text: "It acts for a person and gets exactly their access. Asked for a colleague's salary, its tool returns “permission denied”, the model never sees the number, and the attempt is logged.",
  },
  {
    title: "Receipts are data, not instructions",
    text: "Three test receipts carry injections: a note to the “AI reviewer”, a fake system notice naming the agent's own tool, and “approved by CFO” hidden in a line item. All are flagged to Finance.",
  },
  {
    title: "Fail closed, and survive crashes",
    text: "If the reviewer refuses or never finishes, a human checks the claim. Each claim is a durable state machine on a Postgres job queue that resumes from its last committed step.",
  },
];

const WARP = [
  ["Tool calling and an agent harness", "a tool-use loop with permission-checked, logged tools"],
  ["Durable execution: triggers, wait and resume", "runs on a job queue that pause for approvals and resume on a decision"],
  ["A run log that makes every action auditable", "each model call, tool call, check and approval attempt, with tokens, cost and latency"],
  ["Evals and guardrails where mistakes are costly", "decision evals that count false approvals first, and rules that the model can't loosen"],
  ["When to act alone and when to ask for approval", "approval chains computed in code, plus reviewer flags"],
  ["Extend the permission model to agents", "the agent acts for a person, with that person's permissions"],
];

export default function Landing() {
  return (
    <div className={s.wrap}>
      <header className={s.top}>
        <span className={s.brand}>
          <span className={s.mark} aria-hidden>
            ◆
          </span>
          Expense Agent
        </span>
        <nav className={s.topLinks}>
          <Link href="/demo">Live demo</Link>
          <a href={REPO}>Code</a>
          <a href={CV}>CV</a>
        </nav>
      </header>

      <section className={s.hero}>
        <p className={s.eyebrow}>A project by Daniel Engelberg for Warp’s Applied AI Engineer role</p>
        <h1 className={s.title}>An AI agent that reviews expenses the way a careful finance team would</h1>
        <p className={s.lead}>
          It reads the receipt, applies the company’s written policy in code, and approves it, adjusts it,
          or asks the right person. It acts with the permissions of whoever it works for, and every step
          lands in an audit log. Evals across three Claude models: zero false approvals.
        </p>
        <div className={s.ctas}>
          <Link className={`${s.btn} ${s.primary}`} href="/demo">
            Try the live demo
          </Link>
          <a className={s.btn} href={CV}>
            Download my CV (PDF)
          </a>
          <a className={s.btn} href={REPO}>
            Read the code
          </a>
        </div>
        <ul className={s.stats}>
          <li>
            <strong>0</strong> false approvals
          </li>
          <li>
            <strong>3 / 3</strong> injections held
          </li>
          <li>
            <strong>42</strong> test receipts
          </li>
          <li>
            <strong>108</strong> automated tests
          </li>
        </ul>
      </section>

      <section className={s.section}>
        <h2>Try it in a minute</h2>
        <ol className={s.steps}>
          <li>
            Open the <Link href="/demo">demo</Link> and pick <b>Sam Okafor</b> in “Acting as”.
          </li>
          <li>
            Submit test receipt <b>h06</b>: it has a printed note telling the AI reviewer to approve it at $5.
          </li>
          <li>Watch the run log: the real total is read, capped at $100, and sent to Finance.</li>
          <li>
            Try to approve it as Sam (it’s his own) or Jordan (not Finance): both are refused, and logged.
          </li>
          <li>
            Switch to <b>Maya Chen</b> (Finance) and approve it from her inbox.
          </li>
        </ol>
        <p className={s.note}>
          Northwind Labs is fictional: every person, salary and receipt is synthetic. Test receipts only,
          150 claims a day, resets nightly.
        </p>
      </section>

      <section className={s.section}>
        <h2>How a claim flows</h2>
        <ol className={s.flow}>
          {STAGES.map((st, i) => (
            <li key={st.name} className={s.stage}>
              <span className={s.stageN}>{i + 1}</span>
              <h3>{st.name}</h3>
              <p>{st.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={s.section}>
        <h2>Decision evals</h2>
        <p className={s.sectionLead}>
          Each receipt runs through the real pipeline as its submitter, and is graded on the outcome{" "}
          <em>and</em> exactly who must approve. A free baseline (perfect extraction, rules only) must
          score 42/42 before any model run.
        </p>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Extract / review</th>
                <th>Correct</th>
                <th>False approvals</th>
                <th>Injections held</th>
                <th>Cost / claim</th>
                <th>p95</th>
              </tr>
            </thead>
            <tbody>
              {RESULTS.map((r) => (
                <tr key={r.config}>
                  <td>{r.config}</td>
                  <td>{r.correct}</td>
                  <td>0</td>
                  <td>3 / 3</td>
                  <td>{r.cost}</td>
                  <td>{r.p95}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={s.findings}>
          <p>
            <b>What the evals changed.</b> The first run caught bugs in my data, not the models: a bagel
            shop selling pad thai. Then Sonnet scored 37/42 by marking every numeric date as uncertain; one
            prompt fix took it to 42/42 with no regression on Opus.
          </p>
          <p>
            <b>Where it breaks.</b> Haiku’s misses both send claims to a human (it reads a handwritten total
            as possible tampering). Each config ran once, so 1–2 point gaps aren’t significant, and the
            receipts are clean renders, not phone photos.
          </p>
        </div>
      </section>

      <section className={s.section}>
        <h2>Design decisions</h2>
        <div className={s.grid}>
          {PRINCIPLES.map((p) => (
            <article key={p.title} className={s.card}>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={s.section}>
        <h2>Mapped to the role</h2>
        <ul className={s.map}>
          {WARP.map(([want, built]) => (
            <li key={want}>
              <span className={s.want}>{want}</span>
              <span className={s.built}>{built}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${s.section} ${s.about}`} id="contact">
        <h2>About me</h2>
        <p>
          I’m Daniel Engelberg, a Technion engineering graduate (robotics) who builds production AI systems.
          Before this I built Handy AI, a WhatsApp maintenance coordinator for property managers with Claude
          intake, emergency detection, a Postgres job queue and 350+ tests. I’m authorized to work in the US
          and relocating to New York.
        </p>
        <div className={s.ctas}>
          <a className={`${s.btn} ${s.primary}`} href={CV}>
            Download my CV (PDF)
          </a>
          <a className={s.btn} href="mailto:danielengelberg131@gmail.com">
            danielengelberg131@gmail.com
          </a>
          <a className={s.btn} href="https://www.linkedin.com/in/danielengelberg/">
            LinkedIn
          </a>
        </div>
      </section>

      <footer className={s.footer}>
        Built with TypeScript, Next.js, PostgreSQL and the Claude API. Deployed on Vercel and Neon.
      </footer>
    </div>
  );
}
