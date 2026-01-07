import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { MessageRecord } from "../types";
import type {
  LiveState,
  WindowStats,
  ProviderWindowStats,
  ModelWindowStats,
  TimeSeriesPoint,
  LimitsConfig,
  BudgetsConfig,
  RateLimitEvent,
  HealthStatus,
  ModelHealthStatus,
  SortMode,
} from "./types";
import { getMonthStartTimestamp } from "./calendar";

const DEFAULT_CONFIG_PATH = join(
  homedir(),
  ".config",
  "opencode-usage",
  "limits.json"
);

const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export function createInitialState(): LiveState {
  return {
    messageIndex: new Map(),
    messages: [],
    rateLimitEvents: [],
    limits: {},
    budgets: {},
    currentWindow: "5h",
    viewMode: "mtd",
    sortMode: "cost",
    lastUpdate: Date.now(),
    timeSeries: [],
  };
}

export async function loadLimitsConfig(
  configPath?: string
): Promise<LimitsConfig> {
  const path = configPath || DEFAULT_CONFIG_PATH;
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as LimitsConfig;
  } catch {
    return {};
  }
}

export async function loadBudgetsConfig(
  configPath?: string
): Promise<BudgetsConfig> {
  const path = configPath || join(homedir(), ".config", "opencode-usage", "budgets.json");
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as BudgetsConfig;
  } catch {
    return {};
  }
}

export function addMessage(state: LiveState, msg: MessageRecord): boolean {
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

export function addMessages(state: LiveState, msgs: MessageRecord[]): number {
  let added = 0;
  for (const msg of msgs) {
    if (addMessage(state, msg)) {
      added++;
    }
  }
  return added;
}

export function addRateLimitEvent(
  state: LiveState,
  event: RateLimitEvent
): void {
  state.rateLimitEvents.push(event);
  state.rateLimitEvents.sort((a, b) => a.timestamp - b.timestamp);
}

function updateTimeSeries(state: LiveState, msg: MessageRecord): void {
  if (!msg.tokens) return;

  const minuteBucket = Math.floor(msg.time.created / 60000) * 60000;
  const existing = state.timeSeries.find((p) => p.timestamp === minuteBucket);

  const totalTokens =
    msg.tokens.input + msg.tokens.output + msg.tokens.reasoning;

  if (existing) {
    existing.tokens += totalTokens;
    existing.cost += msg.cost || 0;
  } else {
    state.timeSeries.push({
      timestamp: minuteBucket,
      tokens: totalTokens,
      cost: msg.cost || 0,
    });
    state.timeSeries.sort((a, b) => a.timestamp - b.timestamp);
  }
}

export function getMessagesInWindow(
  state: LiveState,
  windowMs: number
): MessageRecord[] {
  const cutoff = Date.now() - windowMs;
  return state.messages.filter((m) => m.time.created >= cutoff);
}

export function getMessagesMTD(state: LiveState): MessageRecord[] {
  const monthStart = getMonthStartTimestamp();
  return state.messages.filter((m) => m.time.created >= monthStart);
}

export function getAllMessages(state: LiveState): MessageRecord[] {
  return state.messages;
}

function getRateLimitsInWindow(
  state: LiveState,
  windowMs: number
): RateLimitEvent[] {
  const cutoff = Date.now() - windowMs;
  return state.rateLimitEvents.filter((e) => e.timestamp >= cutoff);
}

export function computeWindowStats(messages: MessageRecord[]): WindowStats {
  return messages.reduce(
    (acc, msg) => {
      if (!msg.tokens) return acc;
      const tokens =
        msg.tokens.input + msg.tokens.output + msg.tokens.reasoning;
      return {
        totalTokens: acc.totalTokens + tokens,
        totalInput: acc.totalInput + msg.tokens.input,
        totalOutput: acc.totalOutput + msg.tokens.output,
        totalReasoning: acc.totalReasoning + msg.tokens.reasoning,
        totalCost: acc.totalCost + (msg.cost || 0),
        messageCount: acc.messageCount + 1,
      };
    },
    {
      totalTokens: 0,
      totalInput: 0,
      totalOutput: 0,
      totalReasoning: 0,
      totalCost: 0,
      messageCount: 0,
    }
  );
}

export function getWindowStats(state: LiveState, windowMs: number): WindowStats {
  const messages = getMessagesInWindow(state, windowMs);
  return computeWindowStats(messages);
}

export function getMTDStats(state: LiveState): WindowStats {
  const messages = getMessagesMTD(state);
  return computeWindowStats(messages);
}

export function getAllTimeStats(state: LiveState): WindowStats {
  return computeWindowStats(state.messages);
}

function computeHealthStatus(
  rateLimitCount5m: number,
  lastRateLimit?: number
): HealthStatus {
  if (rateLimitCount5m >= 3) return "throttled";
  if (rateLimitCount5m >= 1) return "warn";
  if (lastRateLimit && Date.now() - lastRateLimit < 5 * 60 * 1000) return "warn";
  return "ok";
}

function computeModelHealthStatus(
  lastSeen: number,
  providerThrottled: boolean
): ModelHealthStatus {
  const now = Date.now();
  if (providerThrottled) return "error";
  if (now - lastSeen > STALE_THRESHOLD_MS) return "stale";
  return "active";
}

export function getProviderStatsMTD(state: LiveState): ProviderWindowStats[] {
  const messages = getMessagesMTD(state);
  return computeProviderStats(state, messages);
}

export function getProviderStatsAll(state: LiveState): ProviderWindowStats[] {
  return computeProviderStats(state, state.messages);
}

function computeProviderStats(
  state: LiveState,
  messages: MessageRecord[]
): ProviderWindowStats[] {
  const rateLimits5m = getRateLimitsInWindow(state, 5 * 60 * 1000);

  const groups = new Map<string, MessageRecord[]>();
  for (const msg of messages) {
    const provider = msg.providerID || "unknown";
    const existing = groups.get(provider) || [];
    existing.push(msg);
    groups.set(provider, existing);
  }

  const rateLimitsByProvider = new Map<string, RateLimitEvent[]>();
  for (const event of rateLimits5m) {
    const existing = rateLimitsByProvider.get(event.providerID) || [];
    existing.push(event);
    rateLimitsByProvider.set(event.providerID, existing);
  }

  const allProviders = new Set([
    ...groups.keys(),
    ...rateLimitsByProvider.keys(),
    ...Object.keys(state.budgets),
  ]);

  const results: ProviderWindowStats[] = [];

  for (const providerID of allProviders) {
    const providerMsgs = groups.get(providerID) || [];
    const stats = computeWindowStats(providerMsgs);
    const providerRateLimits = rateLimitsByProvider.get(providerID) || [];

    const lastRateLimit =
      providerRateLimits.length > 0
        ? Math.max(...providerRateLimits.map((e) => e.timestamp))
        : undefined;

    const health = {
      status: computeHealthStatus(providerRateLimits.length, lastRateLimit),
      rateLimitCount5m: providerRateLimits.length,
      lastRateLimit,
    };

    const budget = state.budgets[providerID];
    let budgetTokens: number | undefined;
    let budgetPercent: number | undefined;
    let budgetCost: number | undefined;
    let budgetCostPercent: number | undefined;

    if (budget?.monthlyTokens) {
      budgetTokens = budget.monthlyTokens;
      budgetPercent = (stats.totalTokens / budget.monthlyTokens) * 100;
    }

    if (budget?.monthlyCost) {
      budgetCost = budget.monthlyCost;
      budgetCostPercent = (stats.totalCost / budget.monthlyCost) * 100;
    }

    results.push({
      ...stats,
      providerID,
      health,
      budgetTokens,
      budgetPercent,
      budgetCost,
      budgetCostPercent,
    });
  }

  return results.sort((a, b) => b.totalCost - a.totalCost);
}

export function getModelStatsMTD(
  state: LiveState,
  sortMode: SortMode = "cost"
): ModelWindowStats[] {
  const messages = getMessagesMTD(state);
  return computeModelStats(state, messages, sortMode);
}

export function getModelStatsAll(
  state: LiveState,
  sortMode: SortMode = "cost"
): ModelWindowStats[] {
  return computeModelStats(state, state.messages, sortMode);
}

function computeModelStats(
  state: LiveState,
  messages: MessageRecord[],
  sortMode: SortMode
): ModelWindowStats[] {
  const rateLimits5m = getRateLimitsInWindow(state, 5 * 60 * 1000);
  const throttledProviders = new Set<string>();
  for (const event of rateLimits5m) {
    if (rateLimits5m.filter((e) => e.providerID === event.providerID).length >= 3) {
      throttledProviders.add(event.providerID);
    }
  }

  const groups = new Map<string, MessageRecord[]>();
  for (const msg of messages) {
    const key = msg.modelID || "unknown";
    const existing = groups.get(key) || [];
    existing.push(msg);
    groups.set(key, existing);
  }

  const totalStats = computeWindowStats(messages);
  const results: ModelWindowStats[] = [];

  for (const [modelID, msgs] of groups) {
    const stats = computeWindowStats(msgs);
    const providerID = msgs[0]?.providerID || "unknown";
    const lastSeen = Math.max(...msgs.map((m) => m.time.created));
    const providerThrottled = throttledProviders.has(providerID);

    const sharePercent =
      totalStats.totalTokens > 0
        ? (stats.totalTokens / totalStats.totalTokens) * 100
        : 0;

    results.push({
      ...stats,
      modelID,
      providerID,
      health: {
        status: computeModelHealthStatus(lastSeen, providerThrottled),
        lastSeen,
        providerThrottled,
      },
      sharePercent,
      lastSeen,
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

export function getSparklineData(
  state: LiveState,
  windowMs: number,
  bucketCount: number = 30
): number[] {
  const cutoff = Date.now() - windowMs;
  const bucketMs = windowMs / bucketCount;
  const buckets: number[] = new Array(bucketCount).fill(0);

  for (const point of state.timeSeries) {
    if (point.timestamp < cutoff) continue;
    const bucketIndex = Math.floor((point.timestamp - cutoff) / bucketMs);
    if (bucketIndex >= 0 && bucketIndex < bucketCount) {
      buckets[bucketIndex] += point.tokens;
    }
  }

  return buckets;
}

export function pruneOldData(
  state: LiveState,
  maxAgeMs: number = 90 * 24 * 60 * 60 * 1000
): void {
  const cutoff = Date.now() - maxAgeMs;

  state.messages = state.messages.filter((m) => m.time.created >= cutoff);
  state.messageIndex = new Map(state.messages.map((m) => [m.id, m]));
  state.rateLimitEvents = state.rateLimitEvents.filter(
    (e) => e.timestamp >= cutoff
  );
  state.timeSeries = state.timeSeries.filter((p) => p.timestamp >= cutoff);
}
