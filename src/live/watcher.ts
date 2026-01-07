import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import type { MessageRecord } from "../types";

const OPENCODE_STORAGE = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "storage"
);
const MESSAGE_DIR = join(OPENCODE_STORAGE, "message");

export interface WatcherEvents {
  message: (msg: MessageRecord) => void;
  error: (err: Error) => void;
}

export class MessageWatcher extends EventEmitter {
  private seenFiles = new Set<string>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  async loadAllMessages(): Promise<MessageRecord[]> {
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
            const filePath = join(sessionPath, file);
            this.seenFiles.add(filePath);

            try {
              const content = await readFile(filePath, "utf-8");
              const msg: MessageRecord = JSON.parse(content);

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

  async startWatching(): Promise<void> {
    this.startPolling();
  }

  private async processNewFile(filePath: string): Promise<void> {
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const content = await readFile(filePath, "utf-8");
      const msg: MessageRecord = JSON.parse(content);

      if (msg.tokens) {
        this.emit("message", msg);
      }
    } catch {}
  }

  private startPolling(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.poll(), 8000);
  }

  private async poll(): Promise<void> {
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
            const filePath = join(sessionPath, file);
            if (this.seenFiles.has(filePath)) continue;
            this.seenFiles.add(filePath);
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
