#!/usr/bin/env node
import {
  loadAllMessages,
  loadAllSessions,
  aggregateTotal,
  aggregateByKey,
  parseSinceArg,
} from "./aggregator";
import { renderTotalUsage, renderTable, renderJson } from "./renderer";
import type { CliOptions, MessageRecord } from "./types";
import type { LiveOptions, WindowSize } from "./live/types";
import { startLive } from "./live";

function isLiveCommand(): boolean {
  return process.argv[2] === "live";
}

function parseLiveArgs(): LiveOptions {
  const args = process.argv.slice(3);
  const options: LiveOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--window" && args[i + 1]) {
      const value = args[++i];
      if (["5m", "1h", "5h", "24h"].includes(value)) {
        options.window = value as WindowSize;
      }
    } else if (arg === "--config" && args[i + 1]) {
      options.configPath = args[++i];
    }
  }

  return options;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--since" && args[i + 1]) {
      options.since = args[++i];
    } else if (arg === "--by" && args[i + 1]) {
      const value = args[++i];
      if (["agent", "session", "model", "provider"].includes(value)) {
        options.by = value as CliOptions["by"];
      } else {
        console.error(`Invalid --by value: ${value}`);
        console.error("Valid values: agent, session, model, provider");
        process.exit(1);
      }
    } else if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
opencode-usage - Track and display OpenCode token usage statistics

USAGE:
  opencode-usage [options]
  opencode-usage live [options]

COMMANDS:
  live               Start real-time fullscreen dashboard

STATIC OPTIONS:
  --since <period>   Filter by time period
                     Relative: 7d, 30d, 1h, 1w, 1m
                     Absolute: YYYY-MM-DD

  --by <grouping>    Group usage by:
                     agent    - Usage per agent (Sisyphus, explore, etc.)
                     session  - Usage per session
                     model    - Usage per model (gpt-5.2, etc.)
                     provider - Usage per provider (openai, google, etc.)

  --limit <n>        Limit number of rows in grouped output

  --json             Output as JSON

  --help, -h         Show this help

LIVE OPTIONS:
  --window <size>    Initial window size: 5m, 1h, 5h, 24h (default: 5h)
  --config <path>    Path to limits config file

EXAMPLES:
  opencode-usage                    # Show all-time totals
  opencode-usage --since 7d         # Last 7 days
  opencode-usage --by agent         # Group by agent
  opencode-usage live               # Start live dashboard
  opencode-usage live --window 1h   # Live with 1 hour window
`);
}

function getKeyFn(by: CliOptions["by"]): (msg: MessageRecord) => string {
  switch (by) {
    case "agent":
      return (msg) => msg.agent || "unknown";
    case "session":
      return (msg) => msg.sessionID;
    case "model":
      return (msg) => msg.modelID || "unknown";
    case "provider":
      return (msg) => msg.providerID || "unknown";
    default:
      return (msg) => msg.agent || "unknown";
  }
}

async function main(): Promise<void> {
  if (isLiveCommand()) {
    const liveOptions = parseLiveArgs();
    await startLive(liveOptions);
    return;
  }

  const options = parseArgs();

  if (options.help) {
    showHelp();
    return;
  }

  const sinceTimestamp = options.since
    ? parseSinceArg(options.since)
    : undefined;

  const [messages, sessions] = await Promise.all([
    loadAllMessages(sinceTimestamp),
    loadAllSessions(),
  ]);

  if (messages.length === 0) {
    console.log("No usage data found.");
    console.log("Make sure OpenCode has been used at least once.");
    return;
  }

  const total = aggregateTotal(messages);

  if (options.by) {
    const keyFn = getKeyFn(options.by);
    const grouped = aggregateByKey(messages, keyFn);

    if (options.json) {
      renderJson(total, grouped, options.by);
    } else {
      renderTotalUsage(total, options.since);
      renderTable(grouped, options.by, sessions, options.limit);
    }
  } else {
    if (options.json) {
      renderJson(total);
    } else {
      renderTotalUsage(total, options.since);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
