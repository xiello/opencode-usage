import type { LiveOptions } from "./types";
import {
  createInitialState,
  loadLimitsConfig,
  loadBudgetsConfig,
  addMessages,
  addRateLimitEvent,
  pruneOldData,
} from "./state";
import { MessageWatcher } from "./watcher";
import { RateLimitWatcher } from "./rateLimits";
import { createUI, renderUI, setupKeyBindings } from "./ui";

export async function startLive(options: LiveOptions): Promise<void> {
  const state = createInitialState();

  if (options.window) {
    state.currentWindow = options.window;
  }

  const [limits, budgets] = await Promise.all([
    loadLimitsConfig(options.configPath),
    loadBudgetsConfig(),
  ]);
  state.limits = limits;
  state.budgets = budgets;

  const messageWatcher = new MessageWatcher();
  const rateLimitWatcher = new RateLimitWatcher();

  const ui = createUI();

  ui.summaryBox.setContent(" Loading...");
  ui.screen.render();

  const [initialMessages, initialRateLimits] = await Promise.all([
    messageWatcher.loadAllMessages(),
    rateLimitWatcher.loadRecentEvents(),
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
    rateLimitWatcher.startWatching(),
  ]);

  const refreshInterval = setInterval(() => {
    pruneOldData(state);
    renderUI(ui, state);
  }, 10000);

  setupKeyBindings(ui, state, () => {
    pruneOldData(state);
    renderUI(ui, state);
  });

  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());

  function cleanup(): void {
    clearInterval(refreshInterval);
    messageWatcher.stop();
    rateLimitWatcher.stop();
    process.exit(0);
  }
}
