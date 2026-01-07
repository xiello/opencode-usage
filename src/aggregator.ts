import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type {
  MessageRecord,
  SessionRecord,
  AggregatedUsage,
  UsageByKey,
} from "./types";

const OPENCODE_STORAGE = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "storage"
);
const MESSAGE_DIR = join(OPENCODE_STORAGE, "message");
const SESSION_DIR = join(OPENCODE_STORAGE, "session");

export async function loadAllMessages(
  sinceTimestamp?: number
): Promise<MessageRecord[]> {
  const messages: MessageRecord[] = [];

  try {
    const sessionDirs = await readdir(MESSAGE_DIR);

    for (const sessionDir of sessionDirs) {
      const sessionPath = join(MESSAGE_DIR, sessionDir);
      try {
        const files = await readdir(sessionPath);
        const msgFiles = files.filter(
          (f) => f.startsWith("msg_") && f.endsWith(".json")
        );

        for (const file of msgFiles) {
          try {
            const content = await readFile(join(sessionPath, file), "utf-8");
            const msg: MessageRecord = JSON.parse(content);

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

export async function loadAllSessions(): Promise<Map<string, SessionRecord>> {
  const sessions = new Map<string, SessionRecord>();

  try {
    const projectDirs = await readdir(SESSION_DIR);

    for (const projectDir of projectDirs) {
      const projectPath = join(SESSION_DIR, projectDir);
      try {
        const files = await readdir(projectPath);
        const sesFiles = files.filter(
          (f) => f.startsWith("ses_") && f.endsWith(".json")
        );

        for (const file of sesFiles) {
          try {
            const content = await readFile(join(projectPath, file), "utf-8");
            const session: SessionRecord = JSON.parse(content);
            sessions.set(session.id, session);
          } catch {}
        }
      } catch {}
    }
  } catch {}

  return sessions;
}

export function aggregateTotal(messages: MessageRecord[]): AggregatedUsage {
  return messages.reduce(
    (acc, msg) => {
      if (!msg.tokens) return acc;
      return {
        totalInput: acc.totalInput + msg.tokens.input,
        totalOutput: acc.totalOutput + msg.tokens.output,
        totalReasoning: acc.totalReasoning + msg.tokens.reasoning,
        totalCacheRead: acc.totalCacheRead + (msg.tokens.cache?.read || 0),
        totalCacheWrite: acc.totalCacheWrite + (msg.tokens.cache?.write || 0),
        totalCost: acc.totalCost + (msg.cost || 0),
        messageCount: acc.messageCount + 1,
      };
    },
    {
      totalInput: 0,
      totalOutput: 0,
      totalReasoning: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
      messageCount: 0,
    }
  );
}

export function aggregateByKey(
  messages: MessageRecord[],
  keyFn: (msg: MessageRecord) => string
): UsageByKey[] {
  const groups = new Map<string, AggregatedUsage>();

  for (const msg of messages) {
    if (!msg.tokens) continue;

    const key = keyFn(msg);
    const existing = groups.get(key) || {
      totalInput: 0,
      totalOutput: 0,
      totalReasoning: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalCost: 0,
      messageCount: 0,
    };

    groups.set(key, {
      totalInput: existing.totalInput + msg.tokens.input,
      totalOutput: existing.totalOutput + msg.tokens.output,
      totalReasoning: existing.totalReasoning + msg.tokens.reasoning,
      totalCacheRead: existing.totalCacheRead + (msg.tokens.cache?.read || 0),
      totalCacheWrite: existing.totalCacheWrite + (msg.tokens.cache?.write || 0),
      totalCost: existing.totalCost + (msg.cost || 0),
      messageCount: existing.messageCount + 1,
    });
  }

  return Array.from(groups.entries())
    .map(([key, usage]) => ({ key, ...usage }))
    .sort((a, b) => b.totalCost - a.totalCost);
}

export function parseSinceArg(since: string): number | undefined {
  const now = Date.now();

  const relativeMatch = since.match(/^(\d+)([dhwm])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const multipliers: Record<string, number> = {
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
      m: 30 * 24 * 60 * 60 * 1000,
    };
    return now - value * multipliers[unit];
  }

  const dateMatch = since.match(/^\d{4}-\d{2}-\d{2}$/);
  if (dateMatch) {
    return new Date(since).getTime();
  }

  console.error(`Invalid --since format: ${since}`);
  console.error("Use relative (7d, 30d, 1h) or absolute (YYYY-MM-DD)");
  return undefined;
}
