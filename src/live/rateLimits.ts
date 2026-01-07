import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import type { RateLimitEvent } from "./types";

const OPENCODE_STORAGE = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "storage"
);
const PART_DIR = join(OPENCODE_STORAGE, "part");

interface PartRecord {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  tool?: string;
  state?: {
    status?: string;
    output?: string;
    error?: string;
  };
}

const RATE_LIMIT_PATTERNS = [
  /429/i,
  /too many requests/i,
  /rate limit/i,
  /throttl/i,
  /quota exceeded/i,
  /capacity/i,
];

const PROVIDER_HINTS: Record<string, string[]> = {
  anthropic: ["claude", "anthropic", "sonnet", "opus", "haiku"],
  openai: ["openai", "gpt", "o1", "o3", "chatgpt"],
  google: ["google", "gemini", "palm", "vertex"],
  openrouter: ["openrouter"],
};

function detectProvider(text: string, tool?: string): string {
  const lower = (text + (tool || "")).toLowerCase();
  for (const [provider, hints] of Object.entries(PROVIDER_HINTS)) {
    if (hints.some((h) => lower.includes(h))) {
      return provider;
    }
  }
  return "unknown";
}

function isRateLimitError(part: PartRecord): boolean {
  if (part.state?.status !== "completed" && part.state?.status !== "error") {
    return false;
  }

  const textToCheck = [
    part.state?.output || "",
    part.state?.error || "",
  ].join(" ");

  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(textToCheck));
}

export class RateLimitWatcher extends EventEmitter {
  private seenParts = new Set<string>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  async loadRecentEvents(sinceMs: number = 60 * 60 * 1000): Promise<RateLimitEvent[]> {
    const events: RateLimitEvent[] = [];
    const cutoff = Date.now() - sinceMs;

    try {
      const messageDirs = await readdir(PART_DIR);

      for (const messageDir of messageDirs) {
        const messagePath = join(PART_DIR, messageDir);
        try {
          const files = await readdir(messagePath);
          const partFiles = files.filter(
            (f) => f.startsWith("prt_") && f.endsWith(".json")
          );

          for (const file of partFiles) {
            const filePath = join(messagePath, file);
            this.seenParts.add(filePath);

            try {
              const fileStat = await stat(filePath);
              if (fileStat.mtimeMs < cutoff) continue;

              const content = await readFile(filePath, "utf-8");
              const part: PartRecord = JSON.parse(content);

              if (isRateLimitError(part)) {
                const errorMessage =
                  part.state?.output || part.state?.error || "";
                events.push({
                  timestamp: fileStat.mtimeMs,
                  providerID: detectProvider(errorMessage, part.tool),
                  modelID: undefined,
                  errorMessage: errorMessage.slice(0, 200),
                  partID: part.id,
                });
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}

    return events;
  }

  async startWatching(): Promise<void> {
    this.startPolling();
  }

  private async processNewFile(filePath: string): Promise<void> {
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await readFile(filePath, "utf-8");
      const part: PartRecord = JSON.parse(content);

      if (isRateLimitError(part)) {
        const errorMessage = part.state?.output || part.state?.error || "";
        const event: RateLimitEvent = {
          timestamp: Date.now(),
          providerID: detectProvider(errorMessage, part.tool),
          modelID: undefined,
          errorMessage: errorMessage.slice(0, 200),
          partID: part.id,
        };
        this.emit("rateLimit", event);
      }
    } catch {}
  }

  private startPolling(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.poll(), 5000);
  }

  private async poll(): Promise<void> {
    try {
      const messageDirs = await readdir(PART_DIR);

      for (const messageDir of messageDirs) {
        const messagePath = join(PART_DIR, messageDir);
        try {
          const files = await readdir(messagePath);
          const partFiles = files.filter(
            (f) => f.startsWith("prt_") && f.endsWith(".json")
          );

          for (const file of partFiles) {
            const filePath = join(messagePath, file);
            if (this.seenParts.has(filePath)) continue;
            this.seenParts.add(filePath);
            await this.processNewFile(filePath);
          }
        } catch {}
      }
    } catch {}
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
