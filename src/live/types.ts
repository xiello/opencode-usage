import type { MessageRecord } from "../types";

export type WindowSize = "5m" | "1h" | "5h" | "24h";
export type ViewMode = "mtd" | "all";
export type SortMode = "cost" | "tokens" | "name";

export const WINDOW_MS: Record<WindowSize, number> = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "5h": 5 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

export interface ProviderBudget {
  monthlyTokens?: number;
  monthlyCost?: number;
}

export interface BudgetsConfig {
  [providerID: string]: ProviderBudget;
}

export interface ProviderLimits {
  tokens5h?: number;
  tokensDaily?: number;
  cost5h?: number;
  costDaily?: number;
}

export interface LimitsConfig {
  [providerID: string]: ProviderLimits;
}

export interface RateLimitEvent {
  timestamp: number;
  providerID: string;
  modelID?: string;
  errorMessage: string;
  partID: string;
}

export type HealthStatus = "ok" | "warn" | "throttled";
export type ModelHealthStatus = "active" | "stale" | "error";

export interface ProviderHealth {
  status: HealthStatus;
  rateLimitCount5m: number;
  lastRateLimit?: number;
}

export interface ModelHealth {
  status: ModelHealthStatus;
  lastSeen: number;
  providerThrottled: boolean;
}

export interface WindowStats {
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalReasoning: number;
  totalCost: number;
  messageCount: number;
}

export interface ProviderWindowStats extends WindowStats {
  providerID: string;
  health: ProviderHealth;
  limitPercent?: number;
  budgetTokens?: number;
  budgetPercent?: number;
  budgetCost?: number;
  budgetCostPercent?: number;
}

export interface ModelWindowStats extends WindowStats {
  modelID: string;
  providerID: string;
  health: ModelHealth;
  sharePercent: number;
  lastSeen: number;
}

export interface TimeSeriesPoint {
  timestamp: number;
  tokens: number;
  cost: number;
}

export interface LiveState {
  messageIndex: Map<string, MessageRecord>;
  messages: MessageRecord[];
  rateLimitEvents: RateLimitEvent[];
  limits: LimitsConfig;
  budgets: BudgetsConfig;
  currentWindow: WindowSize;
  viewMode: ViewMode;
  sortMode: SortMode;
  lastUpdate: number;
  timeSeries: TimeSeriesPoint[];
}

export type GroupBy = "provider" | "model" | "agent";

export interface LiveOptions {
  window?: WindowSize;
  groupBy?: GroupBy;
  configPath?: string;
}
