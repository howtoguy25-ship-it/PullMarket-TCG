// Quick QA pass over a generated JSONL dataset before you spend GPU time
// training on it. Not a substitute for actually reading a sample by hand —
// see finetune/README.md — but catches the mechanical failures.
//
// Usage: tsx finetune/validateDataset.ts finetune/data/synthetic-*.jsonl

import fs from "fs";

const MIN_ASSISTANT_CHARS = 80;
const MAX_ASSISTANT_CHARS = 6000;

interface Record_ {
  category: string;
  kind: string;
  answerMode: string;
  messages: { role: string; content: string }[];
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx finetune/validateDataset.ts <path-to-jsonl>");
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter((l) => l.trim());
  const byCategory: Record<string, number> = {};
  const issues: string[] = [];
  let ok = 0;

  lines.forEach((line, i) => {
    let record: Record_;
    try {
      record = JSON.parse(line);
    } catch {
      issues.push(`line ${i + 1}: invalid JSON`);
      return;
    }

    const user = record.messages?.find((m) => m.role === "user")?.content ?? "";
    const assistant = record.messages?.find((m) => m.role === "assistant")?.content ?? "";

    if (!user.trim()) issues.push(`line ${i + 1} [${record.category}]: empty user message`);
    if (assistant.length < MIN_ASSISTANT_CHARS) issues.push(`line ${i + 1} [${record.category}]: assistant reply suspiciously short (${assistant.length} chars)`);
    if (assistant.length > MAX_ASSISTANT_CHARS) issues.push(`line ${i + 1} [${record.category}]: assistant reply suspiciously long (${assistant.length} chars)`);
    if (!/\*\*.+\*\*/.test(assistant)) issues.push(`line ${i + 1} [${record.category}]: missing a **bold heading** — format may not match the app`);

    byCategory[record.category] = (byCategory[record.category] ?? 0) + 1;
    if (user.trim() && assistant.length >= MIN_ASSISTANT_CHARS) ok++;
  });

  console.log(`${lines.length} total examples, ${ok} pass basic checks, ${issues.length} issues flagged.\n`);
  console.log("Per category:");
  Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, n]) => console.log(`  ${cat}: ${n}`));

  if (issues.length) {
    console.log("\nFlagged issues (first 20):");
    issues.slice(0, 20).forEach((issue) => console.log(`  - ${issue}`));
  }

  console.log(
    "\nThis only catches mechanical problems (empty fields, missing formatting, wildly short/long replies).\n" +
      "Read an actual random sample of ~20-30 examples yourself before training — that's the check this script can't do for you.",
  );
}

main();
