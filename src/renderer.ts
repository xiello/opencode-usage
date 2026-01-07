import type { AggregatedUsage, UsageByKey, SessionRecord } from "./types";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : " ".repeat(len - str.length) + str;
}

export function renderTotalUsage(usage: AggregatedUsage, since?: string): void {
  const period = since ? `(since ${since})` : "(all time)";
  console.log(`\nOpenCode Token Usage ${period}\n`);
  console.log("=".repeat(50));

  console.log(`Messages:      ${formatNumber(usage.messageCount)}`);
  console.log(`Total Cost:    ${formatCost(usage.totalCost)}`);
  console.log("");
  console.log("Token Breakdown:");
  console.log(`  Input:       ${padLeft(formatNumber(usage.totalInput), 10)}`);
  console.log(`  Output:      ${padLeft(formatNumber(usage.totalOutput), 10)}`);
  console.log(`  Reasoning:   ${padLeft(formatNumber(usage.totalReasoning), 10)}`);
  console.log(`  Cache Read:  ${padLeft(formatNumber(usage.totalCacheRead), 10)}`);
  console.log(`  Cache Write: ${padLeft(formatNumber(usage.totalCacheWrite), 10)}`);
  console.log("");
}

export function renderTable(
  data: UsageByKey[],
  label: string,
  sessions?: Map<string, SessionRecord>,
  limit?: number
): void {
  const rows = limit ? data.slice(0, limit) : data;

  console.log(`\nUsage by ${label}:\n`);

  const header = [
    padRight(label.charAt(0).toUpperCase() + label.slice(1), 30),
    padLeft("Input", 10),
    padLeft("Output", 10),
    padLeft("Reasoning", 10),
    padLeft("Cache R", 10),
    padLeft("Cache W", 10),
    padLeft("Cost", 10),
    padLeft("Msgs", 6),
  ].join(" | ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const row of rows) {
    let displayKey = row.key;
    if (label === "session" && sessions) {
      const session = sessions.get(row.key);
      displayKey = session?.title || row.key.slice(0, 20);
    }

    const line = [
      padRight(displayKey.slice(0, 30), 30),
      padLeft(formatNumber(row.totalInput), 10),
      padLeft(formatNumber(row.totalOutput), 10),
      padLeft(formatNumber(row.totalReasoning), 10),
      padLeft(formatNumber(row.totalCacheRead), 10),
      padLeft(formatNumber(row.totalCacheWrite), 10),
      padLeft(formatCost(row.totalCost), 10),
      padLeft(row.messageCount.toString(), 6),
    ].join(" | ");

    console.log(line);
  }

  if (limit && data.length > limit) {
    console.log(`\n... and ${data.length - limit} more`);
  }

  console.log("");
}

export function renderJson(
  total: AggregatedUsage,
  byKey?: UsageByKey[],
  groupBy?: string
): void {
  const output: Record<string, unknown> = { total };
  if (byKey && groupBy) {
    output[`by${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}`] = byKey;
  }
  console.log(JSON.stringify(output, null, 2));
}
