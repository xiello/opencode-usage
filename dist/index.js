#!/usr/bin/env node

// src/aggregator.ts
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
var OPENCODE_STORAGE = join(homedir(), ".local", "share", "opencode", "storage");
var MESSAGE_DIR = join(OPENCODE_STORAGE, "message");
var SESSION_DIR = join(OPENCODE_STORAGE, "session");
async function loadAllMessages(sinceTimestamp) {
  const messages = [];
  try {
    const sessionDirs = await readdir(MESSAGE_DIR);
    for (const sessionDir of sessionDirs) {
      const sessionPath = join(MESSAGE_DIR, sessionDir);
      try {
        const files = await readdir(sessionPath);
        const msgFiles = files.filter((f) => f.startsWith("msg_") && f.endsWith(".json"));
        for (const file of msgFiles) {
          try {
            const content = await readFile(join(sessionPath, file), "utf-8");
            const msg = JSON.parse(content);
            if (sinceTimestamp && msg.time.created < sinceTimestamp) {
              continue;
            }
            if (msg.tokens) {
              messages.push(msg);
            }
          } catch {}
        }
      } catch {}
    }
  } catch (err) {
    console.error(`Could not read message directory: ${MESSAGE_DIR}`);
    console.error("Make sure OpenCode has been used at least once.");
  }
  return messages;
}
async function loadAllSessions() {
  const sessions = new Map;
  try {
    const projectDirs = await readdir(SESSION_DIR);
    for (const projectDir of projectDirs) {
      const projectPath = join(SESSION_DIR, projectDir);
      try {
        const files = await readdir(projectPath);
        const sesFiles = files.filter((f) => f.startsWith("ses_") && f.endsWith(".json"));
        for (const file of sesFiles) {
          try {
            const content = await readFile(join(projectPath, file), "utf-8");
            const session = JSON.parse(content);
            sessions.set(session.id, session);
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return sessions;
}
function aggregateTotal(messages) {
  return messages.reduce((acc, msg) => {
    if (!msg.tokens)
      return acc;
    return {
      totalInput: acc.totalInput + msg.tokens.input,
      totalOutput: acc.totalOutput + msg.tokens.output,
      totalReasoning: acc.totalReasoning + msg.tokens.reasoning,
      totalCacheRead: acc.totalCacheRead + (msg.tokens.cache?.read || 0),
      totalCacheWrite: acc.totalCacheWrite + (msg.tokens.cache?.write || 0),
      totalCost: acc.totalCost + (msg.cost || 0),
      messageCount: acc.messageCount + 1
    };
  }, {
    totalInput: 0,
    totalOutput: 0,
    totalReasoning: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    totalCost: 0,
    messageCount: 0
  });
}
function aggregateByKey(messages, keyFn) {
  const groups = new Map;
  for (const msg of messages) {
    if (!msg.tokens)
      continue;
    const key = keyFn(msg);
    const existing = groups.get(key) || {
      totalInput: 0,
      totalOutput: 0,
      totalReasoning: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
      messageCount: 0
    };
    groups.set(key, {
      totalInput: existing.totalInput + msg.tokens.input,
      totalOutput: existing.totalOutput + msg.tokens.output,
      totalReasoning: existing.totalReasoning + msg.tokens.reasoning,
      totalCacheRead: existing.totalCacheRead + (msg.tokens.cache?.read || 0),
      totalCacheWrite: existing.totalCacheWrite + (msg.tokens.cache?.write || 0),
      totalCost: existing.totalCost + (msg.cost || 0),
      messageCount: existing.messageCount + 1
    });
  }
  return Array.from(groups.entries()).map(([key, usage]) => ({ key, ...usage })).sort((a, b) => b.totalCost - a.totalCost);
}
function parseSinceArg(since) {
  const now = Date.now();
  const relativeMatch = since.match(/^(\d+)([dhwm])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const multipliers = {
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
      m: 30 * 24 * 60 * 60 * 1000
    };
    return now - value * multipliers[unit];
  }
  const dateMatch = since.match(/^\d{4}-\d{2}-\d{2}$/);
  if (dateMatch) {
    return new Date(since).getTime();
  }
  console.error(`Invalid --since format: ${since}`);
  console.error("Use relative (7d, 30d, 1h) or absolute (YYYY-MM-DD)");
  return;
}

// src/renderer.ts
function formatNumber(n) {
  if (n >= 1e6)
    return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000)
    return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
function formatCost(cost) {
  return `$${cost.toFixed(4)}`;
}
function padRight(str, len) {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}
function padLeft(str, len) {
  return str.length >= len ? str : " ".repeat(len - str.length) + str;
}
function renderTotalUsage(usage, since) {
  const period = since ? `(since ${since})` : "(all time)";
  console.log(`
OpenCode Token Usage ${period}
`);
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
function renderTable(data, label, sessions, limit) {
  const rows = limit ? data.slice(0, limit) : data;
  console.log(`
Usage by ${label}:
`);
  const header = [
    padRight(label.charAt(0).toUpperCase() + label.slice(1), 30),
    padLeft("Input", 10),
    padLeft("Output", 10),
    padLeft("Reasoning", 10),
    padLeft("Cache R", 10),
    padLeft("Cache W", 10),
    padLeft("Cost", 10),
    padLeft("Msgs", 6)
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
      padLeft(row.messageCount.toString(), 6)
    ].join(" | ");
    console.log(line);
  }
  if (limit && data.length > limit) {
    console.log(`
... and ${data.length - limit} more`);
  }
  console.log("");
}
function renderJson(total, byKey, groupBy) {
  const output = { total };
  if (byKey && groupBy) {
    output[`by${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}`] = byKey;
  }
  console.log(JSON.stringify(output, null, 2));
}

// src/live/state.ts
import { readFile as readFile2 } from "fs/promises";
import { join as join2 } from "path";
import { homedir as homedir2 } from "os";

// src/live/calendar.ts
var BRATISLAVA_TZ = "Europe/Bratislava";
function getMonthStartTimestamp() {
  const now = new Date;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRATISLAVA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year").value);
  const month = parseInt(parts.find((p) => p.type === "month").value);
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const offsetFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRATISLAVA_TZ,
    timeZoneName: "shortOffset"
  });
  const offsetParts = offsetFormatter.formatToParts(monthStart);
  const tzPart = offsetParts.find((p) => p.type === "timeZoneName");
  let offsetHours = 1;
  if (tzPart) {
    const match = tzPart.value.match(/GMT([+-])(\d+)/);
    if (match) {
      offsetHours = parseInt(match[2]) * (match[1] === "+" ? 1 : -1);
    }
  }
  const utcMonthStart = new Date(Date.UTC(year, month - 1, 1, -offsetHours, 0, 0, 0));
  return utcMonthStart.getTime();
}
function getCurrentMonthName() {
  const now = new Date;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRATISLAVA_TZ,
    month: "long",
    year: "numeric"
  });
  return formatter.format(now);
}

// src/live/state.ts
var DEFAULT_CONFIG_PATH = join2(homedir2(), ".config", "opencode-usage", "limits.json");
var STALE_THRESHOLD_MS = 30 * 60 * 1000;
function createInitialState() {
  return {
    messageIndex: new Map,
    messages: [],
    rateLimitEvents: [],
    limits: {},
    budgets: {},
    currentWindow: "5h",
    viewMode: "mtd",
    sortMode: "cost",
    lastUpdate: Date.now(),
    timeSeries: []
  };
}
async function loadLimitsConfig(configPath) {
  const path = configPath || DEFAULT_CONFIG_PATH;
  try {
    const content = await readFile2(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}
async function loadBudgetsConfig(configPath) {
  const path = configPath || join2(homedir2(), ".config", "opencode-usage", "budgets.json");
  try {
    const content = await readFile2(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}
function addMessage(state, msg) {
  if (state.messageIndex.has(msg.id)) {
    return false;
  }
  state.messageIndex.set(msg.id, msg);
  state.messages.push(msg);
  state.messages.sort((a, b) => a.time.created - b.time.created);
  state.lastUpdate = Date.now();
  updateTimeSeries(state, msg);
  return true;
}
function addMessages(state, msgs) {
  let added = 0;
  for (const msg of msgs) {
    if (addMessage(state, msg)) {
      added++;
    }
  }
  return added;
}
function addRateLimitEvent(state, event) {
  state.rateLimitEvents.push(event);
  state.rateLimitEvents.sort((a, b) => a.timestamp - b.timestamp);
}
function updateTimeSeries(state, msg) {
  if (!msg.tokens)
    return;
  const minuteBucket = Math.floor(msg.time.created / 60000) * 60000;
  const existing = state.timeSeries.find((p) => p.timestamp === minuteBucket);
  const totalTokens = msg.tokens.input + msg.tokens.output + msg.tokens.reasoning;
  if (existing) {
    existing.tokens += totalTokens;
    existing.cost += msg.cost || 0;
  } else {
    state.timeSeries.push({
      timestamp: minuteBucket,
      tokens: totalTokens,
      cost: msg.cost || 0
    });
    state.timeSeries.sort((a, b) => a.timestamp - b.timestamp);
  }
}
function getMessagesMTD(state) {
  const monthStart = getMonthStartTimestamp();
  return state.messages.filter((m) => m.time.created >= monthStart);
}
function getRateLimitsInWindow(state, windowMs) {
  const cutoff = Date.now() - windowMs;
  return state.rateLimitEvents.filter((e) => e.timestamp >= cutoff);
}
function computeWindowStats(messages) {
  return messages.reduce((acc, msg) => {
    if (!msg.tokens)
      return acc;
    const tokens = msg.tokens.input + msg.tokens.output + msg.tokens.reasoning;
    return {
      totalTokens: acc.totalTokens + tokens,
      totalInput: acc.totalInput + msg.tokens.input,
      totalOutput: acc.totalOutput + msg.tokens.output,
      totalReasoning: acc.totalReasoning + msg.tokens.reasoning,
      totalCost: acc.totalCost + (msg.cost || 0),
      messageCount: acc.messageCount + 1
    };
  }, {
    totalTokens: 0,
    totalInput: 0,
    totalOutput: 0,
    totalReasoning: 0,
    totalCost: 0,
    messageCount: 0
  });
}
function getMTDStats(state) {
  const messages = getMessagesMTD(state);
  return computeWindowStats(messages);
}
function getAllTimeStats(state) {
  return computeWindowStats(state.messages);
}
function computeHealthStatus(rateLimitCount5m, lastRateLimit) {
  if (rateLimitCount5m >= 3)
    return "throttled";
  if (rateLimitCount5m >= 1)
    return "warn";
  if (lastRateLimit && Date.now() - lastRateLimit < 5 * 60 * 1000)
    return "warn";
  return "ok";
}
function computeModelHealthStatus(lastSeen, providerThrottled) {
  const now = Date.now();
  if (providerThrottled)
    return "error";
  if (now - lastSeen > STALE_THRESHOLD_MS)
    return "stale";
  return "active";
}
function getProviderStatsMTD(state) {
  const messages = getMessagesMTD(state);
  return computeProviderStats(state, messages);
}
function getProviderStatsAll(state) {
  return computeProviderStats(state, state.messages);
}
function computeProviderStats(state, messages) {
  const rateLimits5m = getRateLimitsInWindow(state, 5 * 60 * 1000);
  const groups = new Map;
  for (const msg of messages) {
    const provider = msg.providerID || "unknown";
    const existing = groups.get(provider) || [];
    existing.push(msg);
    groups.set(provider, existing);
  }
  const rateLimitsByProvider = new Map;
  for (const event of rateLimits5m) {
    const existing = rateLimitsByProvider.get(event.providerID) || [];
    existing.push(event);
    rateLimitsByProvider.set(event.providerID, existing);
  }
  const allProviders = new Set([
    ...groups.keys(),
    ...rateLimitsByProvider.keys(),
    ...Object.keys(state.budgets)
  ]);
  const results = [];
  for (const providerID of allProviders) {
    const providerMsgs = groups.get(providerID) || [];
    const stats = computeWindowStats(providerMsgs);
    const providerRateLimits = rateLimitsByProvider.get(providerID) || [];
    const lastRateLimit = providerRateLimits.length > 0 ? Math.max(...providerRateLimits.map((e) => e.timestamp)) : undefined;
    const health = {
      status: computeHealthStatus(providerRateLimits.length, lastRateLimit),
      rateLimitCount5m: providerRateLimits.length,
      lastRateLimit
    };
    const budget = state.budgets[providerID];
    let budgetTokens;
    let budgetPercent;
    let budgetCost;
    let budgetCostPercent;
    if (budget?.monthlyTokens) {
      budgetTokens = budget.monthlyTokens;
      budgetPercent = stats.totalTokens / budget.monthlyTokens * 100;
    }
    if (budget?.monthlyCost) {
      budgetCost = budget.monthlyCost;
      budgetCostPercent = stats.totalCost / budget.monthlyCost * 100;
    }
    results.push({
      ...stats,
      providerID,
      health,
      budgetTokens,
      budgetPercent,
      budgetCost,
      budgetCostPercent
    });
  }
  return results.sort((a, b) => b.totalCost - a.totalCost);
}
function getModelStatsMTD(state, sortMode = "cost") {
  const messages = getMessagesMTD(state);
  return computeModelStats(state, messages, sortMode);
}
function getModelStatsAll(state, sortMode = "cost") {
  return computeModelStats(state, state.messages, sortMode);
}
function computeModelStats(state, messages, sortMode) {
  const rateLimits5m = getRateLimitsInWindow(state, 5 * 60 * 1000);
  const throttledProviders = new Set;
  for (const event of rateLimits5m) {
    if (rateLimits5m.filter((e) => e.providerID === event.providerID).length >= 3) {
      throttledProviders.add(event.providerID);
    }
  }
  const groups = new Map;
  for (const msg of messages) {
    const key = msg.modelID || "unknown";
    const existing = groups.get(key) || [];
    existing.push(msg);
    groups.set(key, existing);
  }
  const totalStats = computeWindowStats(messages);
  const results = [];
  for (const [modelID, msgs] of groups) {
    const stats = computeWindowStats(msgs);
    const providerID = msgs[0]?.providerID || "unknown";
    const lastSeen = Math.max(...msgs.map((m) => m.time.created));
    const providerThrottled = throttledProviders.has(providerID);
    const sharePercent = totalStats.totalTokens > 0 ? stats.totalTokens / totalStats.totalTokens * 100 : 0;
    results.push({
      ...stats,
      modelID,
      providerID,
      health: {
        status: computeModelHealthStatus(lastSeen, providerThrottled),
        lastSeen,
        providerThrottled
      },
      sharePercent,
      lastSeen
    });
  }
  switch (sortMode) {
    case "cost":
      return results.sort((a, b) => b.totalCost - a.totalCost);
    case "tokens":
      return results.sort((a, b) => b.totalTokens - a.totalTokens);
    case "name":
      return results.sort((a, b) => a.modelID.localeCompare(b.modelID));
    default:
      return results.sort((a, b) => b.totalCost - a.totalCost);
  }
}
function pruneOldData(state, maxAgeMs = 90 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  state.messages = state.messages.filter((m) => m.time.created >= cutoff);
  state.messageIndex = new Map(state.messages.map((m) => [m.id, m]));
  state.rateLimitEvents = state.rateLimitEvents.filter((e) => e.timestamp >= cutoff);
  state.timeSeries = state.timeSeries.filter((p) => p.timestamp >= cutoff);
}

// src/live/watcher.ts
import { readdir as readdir2, readFile as readFile3 } from "fs/promises";
import { join as join3 } from "path";
import { homedir as homedir3 } from "os";
import { EventEmitter } from "events";
var OPENCODE_STORAGE2 = join3(homedir3(), ".local", "share", "opencode", "storage");
var MESSAGE_DIR2 = join3(OPENCODE_STORAGE2, "message");

class MessageWatcher extends EventEmitter {
  seenFiles = new Set;
  pollInterval = null;
  async loadAllMessages() {
    const messages = [];
    try {
      const sessionDirs = await readdir2(MESSAGE_DIR2);
      for (const sessionDir of sessionDirs) {
        const sessionPath = join3(MESSAGE_DIR2, sessionDir);
        try {
          const files = await readdir2(sessionPath);
          const msgFiles = files.filter((f) => f.startsWith("msg_") && f.endsWith(".json"));
          for (const file of msgFiles) {
            const filePath = join3(sessionPath, file);
            this.seenFiles.add(filePath);
            try {
              const content = await readFile3(filePath, "utf-8");
              const msg = JSON.parse(content);
              if (msg.tokens) {
                messages.push(msg);
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
    return messages;
  }
  async startWatching() {
    this.startPolling();
  }
  async processNewFile(filePath) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const content = await readFile3(filePath, "utf-8");
      const msg = JSON.parse(content);
      if (msg.tokens) {
        this.emit("message", msg);
      }
    } catch {}
  }
  startPolling() {
    if (this.pollInterval)
      return;
    this.pollInterval = setInterval(() => this.poll(), 8000);
  }
  async poll() {
    try {
      const sessionDirs = await readdir2(MESSAGE_DIR2);
      for (const sessionDir of sessionDirs) {
        const sessionPath = join3(MESSAGE_DIR2, sessionDir);
        try {
          const files = await readdir2(sessionPath);
          const msgFiles = files.filter((f) => f.startsWith("msg_") && f.endsWith(".json"));
          for (const file of msgFiles) {
            const filePath = join3(sessionPath, file);
            if (this.seenFiles.has(filePath))
              continue;
            this.seenFiles.add(filePath);
            await this.processNewFile(filePath);
          }
        } catch {}
      }
    } catch {}
  }
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

// src/live/rateLimits.ts
import { readdir as readdir3, readFile as readFile4, stat } from "fs/promises";
import { join as join4 } from "path";
import { homedir as homedir4 } from "os";
import { EventEmitter as EventEmitter2 } from "events";
var OPENCODE_STORAGE3 = join4(homedir4(), ".local", "share", "opencode", "storage");
var PART_DIR = join4(OPENCODE_STORAGE3, "part");
var RATE_LIMIT_PATTERNS = [
  /429/i,
  /too many requests/i,
  /rate limit/i,
  /throttl/i,
  /quota exceeded/i,
  /capacity/i
];
var PROVIDER_HINTS = {
  anthropic: ["claude", "anthropic", "sonnet", "opus", "haiku"],
  openai: ["openai", "gpt", "o1", "o3", "chatgpt"],
  google: ["google", "gemini", "palm", "vertex"],
  openrouter: ["openrouter"]
};
function detectProvider(text, tool) {
  const lower = (text + (tool || "")).toLowerCase();
  for (const [provider, hints] of Object.entries(PROVIDER_HINTS)) {
    if (hints.some((h) => lower.includes(h))) {
      return provider;
    }
  }
  return "unknown";
}
function isRateLimitError(part) {
  if (part.state?.status !== "completed" && part.state?.status !== "error") {
    return false;
  }
  const textToCheck = [
    part.state?.output || "",
    part.state?.error || ""
  ].join(" ");
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(textToCheck));
}

class RateLimitWatcher extends EventEmitter2 {
  seenParts = new Set;
  pollInterval = null;
  async loadRecentEvents(sinceMs = 60 * 60 * 1000) {
    const events = [];
    const cutoff = Date.now() - sinceMs;
    try {
      const messageDirs = await readdir3(PART_DIR);
      for (const messageDir of messageDirs) {
        const messagePath = join4(PART_DIR, messageDir);
        try {
          const files = await readdir3(messagePath);
          const partFiles = files.filter((f) => f.startsWith("prt_") && f.endsWith(".json"));
          for (const file of partFiles) {
            const filePath = join4(messagePath, file);
            this.seenParts.add(filePath);
            try {
              const fileStat = await stat(filePath);
              if (fileStat.mtimeMs < cutoff)
                continue;
              const content = await readFile4(filePath, "utf-8");
              const part = JSON.parse(content);
              if (isRateLimitError(part)) {
                const errorMessage = part.state?.output || part.state?.error || "";
                events.push({
                  timestamp: fileStat.mtimeMs,
                  providerID: detectProvider(errorMessage, part.tool),
                  modelID: undefined,
                  errorMessage: errorMessage.slice(0, 200),
                  partID: part.id
                });
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
    return events;
  }
  async startWatching() {
    this.startPolling();
  }
  async processNewFile(filePath) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const content = await readFile4(filePath, "utf-8");
      const part = JSON.parse(content);
      if (isRateLimitError(part)) {
        const errorMessage = part.state?.output || part.state?.error || "";
        const event = {
          timestamp: Date.now(),
          providerID: detectProvider(errorMessage, part.tool),
          modelID: undefined,
          errorMessage: errorMessage.slice(0, 200),
          partID: part.id
        };
        this.emit("rateLimit", event);
      }
    } catch {}
  }
  startPolling() {
    if (this.pollInterval)
      return;
    this.pollInterval = setInterval(() => this.poll(), 5000);
  }
  async poll() {
    try {
      const messageDirs = await readdir3(PART_DIR);
      for (const messageDir of messageDirs) {
        const messagePath = join4(PART_DIR, messageDir);
        try {
          const files = await readdir3(messagePath);
          const partFiles = files.filter((f) => f.startsWith("prt_") && f.endsWith(".json"));
          for (const file of partFiles) {
            const filePath = join4(messagePath, file);
            if (this.seenParts.has(filePath))
              continue;
            this.seenParts.add(filePath);
            await this.processNewFile(filePath);
          }
        } catch {}
      }
    } catch {}
  }
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

// src/live/ui.ts
import blessed from "blessed";
var HEALTH_COLORS = {
  ok: "green",
  warn: "yellow",
  throttled: "red"
};
var MODEL_HEALTH_COLORS = {
  active: "green",
  stale: "yellow",
  error: "red"
};
var MODEL_HEALTH_ICONS = {
  active: "●",
  stale: "◐",
  error: "○"
};
var PROVIDER_HEALTH_ICONS = {
  ok: "●",
  warn: "◐",
  throttled: "○"
};
function formatTokens(n) {
  if (n >= 1e6)
    return (n / 1e6).toFixed(1) + "M";
  if (n >= 1000)
    return (n / 1000).toFixed(1) + "K";
  return n.toString();
}
function formatCost2(n) {
  return "$" + n.toFixed(2);
}
function makeProgressBar(percent, width) {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round(clamped / 100 * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}
function padRight2(str, len) {
  if (str.length >= len)
    return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}
function padLeft2(str, len) {
  if (str.length >= len)
    return str.slice(0, len);
  return " ".repeat(len - str.length) + str;
}
function createUI() {
  const screen = blessed.screen({
    smartCSR: true,
    title: "OpenCode Usage - Live",
    fullUnicode: true,
    tput: false,
    terminal: "xterm-256color"
  });
  const summaryBox = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: "cyan" }
    }
  });
  const providersBox = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: "100%",
    height: 8,
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: "green" }
    }
  });
  const modelsBox = blessed.box({
    parent: screen,
    top: 11,
    left: 0,
    width: "100%",
    height: "100%-15",
    tags: true,
    border: { type: "line" },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: "│",
      style: { fg: "cyan" }
    },
    style: {
      border: { fg: "blue" }
    }
  });
  const alertsBox = blessed.box({
    parent: screen,
    bottom: 1,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: "red" }
    }
  });
  const footerBox = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: true,
    style: {
      fg: "white",
      bg: "blue"
    }
  });
  return {
    screen,
    summaryBox,
    providersBox,
    modelsBox,
    alertsBox,
    footerBox
  };
}
function renderUI(ui, state) {
  const isViewMTD = state.viewMode === "mtd";
  const stats = isViewMTD ? getMTDStats(state) : getAllTimeStats(state);
  const viewLabel = isViewMTD ? `Month-to-Date (${getCurrentMonthName()})` : "All Time";
  ui.summaryBox.setLabel(` ${viewLabel} `);
  ui.summaryBox.setContent(` Total Cost: {bold}${formatCost2(stats.totalCost)}{/bold}          ` + `Total Tokens: {bold}${formatTokens(stats.totalTokens)}{/bold}          ` + `Messages: {bold}${stats.messageCount}{/bold}`);
  const providers = isViewMTD ? getProviderStatsMTD(state) : getProviderStatsAll(state);
  renderProviders(ui.providersBox, providers);
  const models = isViewMTD ? getModelStatsMTD(state, state.sortMode) : getModelStatsAll(state, state.sortMode);
  renderModels(ui.modelsBox, models, state.sortMode);
  renderAlerts(ui.alertsBox, state);
  const viewToggle = isViewMTD ? "All" : "MTD";
  const sortLabel = state.sortMode === "cost" ? "tokens" : state.sortMode === "tokens" ? "name" : "cost";
  ui.footerBox.setContent(` {bold}[a]{/bold}:${viewToggle}  {bold}[c]{/bold}:sort(${sortLabel})  {bold}[?]{/bold}:help  {bold}[q]{/bold}:quit `);
  ui.screen.render();
}
function renderProviders(box, providers) {
  box.setLabel(" Provider Budgets ");
  if (providers.length === 0) {
    box.setContent(" No provider data");
    return;
  }
  const lines = [];
  const barWidth = 20;
  for (const p of providers.slice(0, 5)) {
    const healthColor = HEALTH_COLORS[p.health.status];
    const healthIcon = PROVIDER_HEALTH_ICONS[p.health.status];
    const providerName = padRight2(p.providerID, 12);
    const costStr = padLeft2(formatCost2(p.totalCost), 8);
    const tokensStr = formatTokens(p.totalTokens);
    let line = ` {${healthColor}-fg}${healthIcon}{/${healthColor}-fg} ${providerName} ${costStr}  `;
    if (p.budgetCost && p.budgetCostPercent !== undefined) {
      const budgetStr = `${formatCost2(p.totalCost)}/${formatCost2(p.budgetCost)}`;
      const bar = makeProgressBar(p.budgetCostPercent, barWidth);
      const barColor = p.budgetCostPercent >= 90 ? "red" : p.budgetCostPercent >= 70 ? "yellow" : "green";
      const percentStr = padLeft2(`${Math.round(p.budgetCostPercent)}%`, 4);
      const warning = p.budgetCostPercent >= 90 ? " {red-fg}⚠{/red-fg}" : "";
      line += `${padRight2(budgetStr, 16)} {${barColor}-fg}${bar}{/${barColor}-fg} ${percentStr}${warning}`;
    } else if (p.budgetTokens && p.budgetPercent !== undefined) {
      const budgetStr = `${tokensStr}/${formatTokens(p.budgetTokens)}`;
      const bar = makeProgressBar(p.budgetPercent, barWidth);
      const barColor = p.budgetPercent >= 90 ? "red" : p.budgetPercent >= 70 ? "yellow" : "green";
      const percentStr = padLeft2(`${Math.round(p.budgetPercent)}%`, 4);
      const warning = p.budgetPercent >= 90 ? " {red-fg}⚠{/red-fg}" : "";
      line += `${padRight2(budgetStr, 16)} {${barColor}-fg}${bar}{/${barColor}-fg} ${percentStr}${warning}`;
    } else {
      line += `${padRight2(tokensStr, 16)} (no budget)`;
    }
    if (p.health.rateLimitCount5m > 0) {
      line += ` {red-fg}[${p.health.rateLimitCount5m} 429s]{/red-fg}`;
    }
    lines.push(line);
  }
  box.setContent(lines.join(`
`));
}
function renderModels(box, models, sortMode) {
  const sortLabel = sortMode === "cost" ? "cost" : sortMode === "tokens" ? "tokens" : "name";
  box.setLabel(` Models (sorted by ${sortLabel}) `);
  if (models.length === 0) {
    box.setContent(" No model data");
    return;
  }
  const header = " " + padRight2("Model", 28) + padLeft2("Cost", 10) + padLeft2("Tokens", 10) + "  Share        " + "Health";
  const lines = [` {bold}${header}{/bold}`];
  const shareBarWidth = 8;
  for (const m of models.slice(0, 15)) {
    const healthColor = MODEL_HEALTH_COLORS[m.health.status];
    const healthIcon = MODEL_HEALTH_ICONS[m.health.status];
    const modelName = padRight2(m.modelID.slice(0, 26), 28);
    const costStr = padLeft2(formatCost2(m.totalCost), 10);
    const tokensStr = padLeft2(formatTokens(m.totalTokens), 10);
    const shareBar = makeProgressBar(m.sharePercent, shareBarWidth);
    const sharePercent = padLeft2(`${Math.round(m.sharePercent)}%`, 4);
    const line = ` ${modelName}${costStr}${tokensStr}  ${shareBar} ${sharePercent}  ` + `{${healthColor}-fg}${healthIcon}{/${healthColor}-fg}`;
    lines.push(line);
  }
  if (models.length > 15) {
    lines.push(` ... and ${models.length - 15} more models`);
  }
  box.setContent(lines.join(`
`));
}
function renderAlerts(box, state) {
  box.setLabel(" Alerts ");
  const recentAlerts = state.rateLimitEvents.filter((e) => Date.now() - e.timestamp < 30 * 60 * 1000).slice(-3).reverse();
  if (recentAlerts.length === 0) {
    box.setContent(" {green-fg}No recent rate limit errors{/green-fg}");
    return;
  }
  const lines = recentAlerts.map((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const msg = e.errorMessage.length > 50 ? e.errorMessage.slice(0, 50) + "..." : e.errorMessage;
    return ` {red-fg}[${time}]{/red-fg} ${e.providerID}: ${msg}`;
  });
  box.setContent(lines.join(`
`));
}
function setupKeyBindings(ui, state, onRefresh) {
  ui.screen.key(["q", "C-c"], () => {
    process.exit(0);
  });
  ui.screen.key("r", () => {
    onRefresh();
  });
  ui.screen.key("a", () => {
    state.viewMode = state.viewMode === "mtd" ? "all" : "mtd";
    renderUI(ui, state);
  });
  ui.screen.key("c", () => {
    const modes = ["cost", "tokens", "name"];
    const currentIdx = modes.indexOf(state.sortMode);
    state.sortMode = modes[(currentIdx + 1) % modes.length];
    renderUI(ui, state);
  });
  ui.screen.key("?", () => {
    showHelp(ui);
  });
}
function showHelp(ui) {
  const helpBox = blessed.box({
    parent: ui.screen,
    top: "center",
    left: "center",
    width: 50,
    height: 12,
    tags: true,
    border: { type: "line" },
    style: {
      border: { fg: "yellow" },
      bg: "black"
    },
    label: " Help "
  });
  helpBox.setContent(`
 {bold}Keyboard Shortcuts{/bold}

 {bold}a{/bold}  Toggle MTD / All Time view
 {bold}c{/bold}  Cycle sort mode (cost → tokens → name)
 {bold}r{/bold}  Refresh data
 {bold}q{/bold}  Quit

 Press ESC or ENTER to close
`);
  ui.screen.render();
  const closeHelp = () => {
    helpBox.destroy();
    ui.screen.render();
  };
  ui.screen.onceKey("escape", closeHelp);
  ui.screen.onceKey("enter", closeHelp);
  ui.screen.onceKey("space", closeHelp);
  ui.screen.onceKey("?", closeHelp);
}

// src/live/index.ts
async function startLive(options) {
  const state = createInitialState();
  if (options.window) {
    state.currentWindow = options.window;
  }
  const [limits, budgets] = await Promise.all([
    loadLimitsConfig(options.configPath),
    loadBudgetsConfig()
  ]);
  state.limits = limits;
  state.budgets = budgets;
  const messageWatcher = new MessageWatcher;
  const rateLimitWatcher = new RateLimitWatcher;
  const ui = createUI();
  ui.summaryBox.setContent(" Loading...");
  ui.screen.render();
  const [initialMessages, initialRateLimits] = await Promise.all([
    messageWatcher.loadAllMessages(),
    rateLimitWatcher.loadRecentEvents()
  ]);
  addMessages(state, initialMessages);
  for (const event of initialRateLimits) {
    addRateLimitEvent(state, event);
  }
  renderUI(ui, state);
  messageWatcher.on("message", (msg) => {
    addMessages(state, [msg]);
    renderUI(ui, state);
  });
  rateLimitWatcher.on("rateLimit", (event) => {
    addRateLimitEvent(state, event);
    renderUI(ui, state);
  });
  await Promise.all([
    messageWatcher.startWatching(),
    rateLimitWatcher.startWatching()
  ]);
  const refreshInterval = setInterval(() => {
    pruneOldData(state);
    renderUI(ui, state);
  }, 1e4);
  setupKeyBindings(ui, state, () => {
    pruneOldData(state);
    renderUI(ui, state);
  });
  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());
  function cleanup() {
    clearInterval(refreshInterval);
    messageWatcher.stop();
    rateLimitWatcher.stop();
    process.exit(0);
  }
}

// src/index.ts
function isLiveCommand() {
  return process.argv[2] === "live";
}
function parseLiveArgs() {
  const args = process.argv.slice(3);
  const options = {};
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--window" && args[i + 1]) {
      const value = args[++i];
      if (["5m", "1h", "5h", "24h"].includes(value)) {
        options.window = value;
      }
    } else if (arg === "--config" && args[i + 1]) {
      options.configPath = args[++i];
    }
  }
  return options;
}
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0;i < args.length; i++) {
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
        options.by = value;
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
function showHelp2() {
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
function getKeyFn(by) {
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
async function main() {
  if (isLiveCommand()) {
    const liveOptions = parseLiveArgs();
    await startLive(liveOptions);
    return;
  }
  const options = parseArgs();
  if (options.help) {
    showHelp2();
    return;
  }
  const sinceTimestamp = options.since ? parseSinceArg(options.since) : undefined;
  const [messages, sessions] = await Promise.all([
    loadAllMessages(sinceTimestamp),
    loadAllSessions()
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
