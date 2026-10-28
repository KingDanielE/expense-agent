import { Resvg } from "@resvg/resvg-js";
import { amounts, type Currency, type ReceiptSpec, ZERO_DECIMAL } from "./specs";

const SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€", GBP: "£", ILS: "₪", JPY: "¥" };
const MONO = "Courier New, Consolas, monospace";
const HAND = "Segoe Print, Comic Sans MS, cursive";

export function money(amount: number, currency: Currency, style: "us" | "eu" = "us"): string {
  const decimals = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const [int, frac] = amount.toFixed(decimals).split(".");
  const sep = style === "eu" ? "." : ",";
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const number = frac ? `${grouped}${style === "eu" ? "," : "."}${frac}` : grouped;
  return style === "eu" ? `${number} ${SYMBOL[currency]}` : `${SYMBOL[currency]}${number}`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Line =
  | { kind: "center"; text: string; size?: number; bold?: boolean }
  | { kind: "pair"; left: string; right: string; bold?: boolean; hand?: boolean; blur?: number }
  | { kind: "left"; text: string; size?: number }
  | { kind: "rule" }
  | { kind: "gap" };

function lines(s: ReceiptSpec): Line[] {
  const style = s.layout?.numberStyle ?? "us";
  const m = (n: number) => money(n, s.currency, style);
  const out: Line[] = [
    { kind: "center", text: s.merchant.toUpperCase(), size: 4, bold: true },
    { kind: "center", text: s.address, size: -3 },
    { kind: "gap" },
  ];

  if (s.notReceipt) {
    out.push({ kind: "center", text: "~ LUNCH MENU ~", bold: true }, { kind: "rule" });
    for (const i of s.items) out.push({ kind: "pair", left: i.description, right: m(i.unitPrice) });
    out.push({ kind: "rule" }, { kind: "center", text: "Ask about today's specials", size: -2 });
    return out;
  }

  out.push({ kind: "left", text: `Date: ${s.layout?.dateText ?? s.date}   12:41` }, { kind: "rule" });
  for (const i of s.items) {
    const label = i.quantity > 1 ? `${i.quantity} x ${i.description}` : i.description;
    out.push({ kind: "pair", left: label, right: m(i.quantity * i.unitPrice) });
  }
  const a = amounts(s);
  out.push({ kind: "rule" }, { kind: "pair", left: "Subtotal", right: m(a.subtotal) });
  if (s.taxRate > 0) {
    const label = s.taxLabel ?? `Tax ${(s.taxRate * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
    out.push({ kind: "pair", left: label, right: m(a.tax) });
  }
  const hand = s.layout?.handwrittenTip;
  if (s.tip !== undefined) out.push({ kind: "pair", left: "Tip", right: m(s.tip), hand });
  else if (hand) out.push({ kind: "pair", left: "Tip", right: "" });
  out.push({ kind: "pair", left: "TOTAL", right: m(a.total), bold: true, hand, blur: s.layout?.blurTotal });

  if (s.extraLines?.length) {
    out.push({ kind: "gap" });
    for (const t of s.extraLines) out.push({ kind: "left", text: t, size: -2 });
  }
  out.push({ kind: "gap" }, { kind: "center", text: "VISA **** 4821  APPROVED", size: -2 });
  out.push({ kind: "center", text: "Thank you!", size: -1 });
  return out;
}

function seeded(id: string) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return ((h ^= h >>> 15) >>> 0) / 4294967296;
  };
}

export function receiptSvg(s: ReceiptSpec): string {
  const size = s.layout?.fontSize ?? 15;
  const width = s.layout?.width ?? 420;
  const pad = 24;
  const lh = Math.round(size * 1.55);
  const ls = lines(s);
  const height = pad * 2 + ls.reduce((h, l) => h + (l.kind === "gap" ? lh / 2 : lh), 0) + lh;
  const margin = 40;
  const W = width + margin * 2;
  const H = height + margin * 2;

  const parts: string[] = [];
  let y = pad + lh;
  for (const l of ls) {
    if (l.kind === "gap") {
      y += lh / 2;
      continue;
    }
    if (l.kind === "rule") {
      parts.push(`<text x="${pad}" y="${y}" font-size="${size}" font-family="${MONO}" fill="#333">${"-".repeat(Math.floor((width - pad * 2) / (size * 0.6)))}</text>`);
    } else if (l.kind === "center") {
      const fs = size + (l.size ?? 0);
      parts.push(`<text x="${width / 2}" y="${y}" text-anchor="middle" font-size="${fs}" font-family="${MONO}" font-weight="${l.bold ? 700 : 400}" fill="#222">${esc(l.text)}</text>`);
    } else if (l.kind === "left") {
      parts.push(`<text x="${pad}" y="${y}" font-size="${size + (l.size ?? 0)}" font-family="${MONO}" fill="#222">${esc(l.text)}</text>`);
    } else {
      const weight = l.bold ? 700 : 400;
      const filter = l.blur ? ` filter="url(#blur)"` : "";
      parts.push(`<text x="${pad}" y="${y}" font-size="${size}" font-family="${MONO}" font-weight="${weight}" fill="#222">${esc(l.left)}</text>`);
      if (l.hand) {
        parts.push(`<line x1="${width - pad - 120}" y1="${y + 3}" x2="${width - pad}" y2="${y + 3}" stroke="#555" stroke-width="1"/>`);
        if (l.right) {
          parts.push(`<text x="${width - pad - 8}" y="${y - 2}" text-anchor="end" font-size="${size + 5}" font-family="${HAND}" fill="#1d3fa8" transform="rotate(-4 ${width - pad - 60} ${y})">${esc(l.right)}</text>`);
        }
      } else {
        parts.push(`<text x="${width - pad}" y="${y}" text-anchor="end" font-size="${size}" font-family="${MONO}" font-weight="${weight}" fill="#222"${filter}>${esc(l.right)}</text>`);
      }
    }
    y += lh;
  }

  const rnd = seeded(s.id);
  const specks = Array.from({ length: s.layout?.noise ?? 0 }, () => {
    const r = (0.4 + rnd() * 1.4).toFixed(2);
    const shade = Math.floor(120 + rnd() * 100);
    return `<circle cx="${(rnd() * width).toFixed(1)}" cy="${(rnd() * height).toFixed(1)}" r="${r}" fill="rgb(${shade},${shade},${shade})" opacity="0.6"/>`;
  });

  const rotate = s.layout?.rotate ?? 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><filter id="blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${s.layout?.blurTotal ?? 0}"/></filter></defs>
<rect width="${W}" height="${H}" fill="#cfc9bd"/>
<g transform="translate(${margin} ${margin}) rotate(${rotate.toFixed(2)} ${width / 2} ${height / 2})">
<rect width="${width}" height="${height}" fill="#fbfaf5" stroke="#e5e1d8"/>
${parts.join("\n")}
${specks.join("\n")}
</g>
</svg>`;
}

export function renderPng(s: ReceiptSpec): Buffer {
  const resvg = new Resvg(receiptSvg(s), {
    font: { loadSystemFonts: true, defaultFontFamily: "Courier New" },
    fitTo: { mode: "zoom", value: 1.5 },
  });
  return Buffer.from(resvg.render().asPng());
}
