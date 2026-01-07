export interface MessageTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

export interface MessageRecord {
  id: string;
  sessionID: string;
  role: string;
  time: {
    created: number;
    completed?: number;
  };
  modelID?: string;
  providerID?: string;
  mode?: string;
  agent?: string;
  cost?: number;
  tokens?: MessageTokens;
}

export interface SessionRecord {
  id: string;
  version?: string;
  projectID?: string;
  directory?: string;
  parentID?: string;
  title?: string;
  time: {
    created: number;
    updated?: number;
  };
}

export interface AggregatedUsage {
  totalInput: number;
  totalOutput: number;
  totalReasoning: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  messageCount: number;
}

export interface UsageByKey extends AggregatedUsage {
  key: string;
}

export interface CliOptions {
  since?: string;
  by?: "agent" | "session" | "model" | "provider";
  json?: boolean;
  limit?: number;
  help?: boolean;
}
