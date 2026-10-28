import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPng } from "../src/eval/receipts/render";
import { REF_DATE, SPECS, truth } from "../src/eval/receipts/specs";

// Renders every spec to data/receipts/<id>.png and writes labels.json with the ground truth.
const dir = join(process.cwd(), "data", "receipts");
mkdirSync(dir, { recursive: true });

const labels = SPECS.map((s) => {
  const file = `${s.id}.png`;
  writeFileSync(join(dir, file), renderPng(s));
  return {
    id: s.id,
    file,
    submittedBy: s.submittedBy,
    tags: s.tags,
    duplicateOf: s.duplicateOf ?? null,
    expected: truth(s),
  };
});

writeFileSync(join(dir, "labels.json"), JSON.stringify({ refDate: REF_DATE, receipts: labels }, null, 2) + "\n");
console.log(`Wrote ${labels.length} receipts and labels.json to ${dir}`);
