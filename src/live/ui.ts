import blessed from "blessed";
import type {
  LiveState,
  ProviderWindowStats,
  ModelWindowStats,
  HealthStatus,
  ModelHealthStatus,
  ViewMode,
  SortMode,
} from "./types";
import {
  getMTDStats,
  getAllTimeStats,
  getProviderStatsMTD,
  getProviderStatsAll,
  getModelStatsMTD,
  getModelStatsAll,
} from "./state";
import { getCurrentMonthName } from "./calendar";

const HEALTH_COLORS: Record<HealthStatus, string> = {
  ok: "green",
  warn: "yellow",
  throttled: "red",
};

const MODEL_HEALTH_COLORS: Record<ModelHealthStatus, string> = {
  active: "green",
  stale: "yellow",
  error: "red",
};

const MODEL_HEALTH_ICONS: Record<ModelHealthStatus, string> = {
  active: "●",
  stale: "◐",
  error: "○",
};

const PROVIDER_HEALTH_ICONS: Record<HealthStatus, string> = {
  ok: "●",
  warn: "◐",
  throttled: "○",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatCost(n: number): string {
  return "$" + n.toFixed(2);
}

function makeProgressBar(percent: number, width: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return " ".repeat(len - str.length) + str;
}

export interface UIComponents {
  screen: blessed.Widgets.Screen;
  summaryBox: blessed.Widgets.BoxElement;
  providersBox: blessed.Widgets.BoxElement;
  modelsBox: blessed.Widgets.BoxElement;
  alertsBox: blessed.Widgets.BoxElement;
  footerBox: blessed.Widgets.BoxElement;
}

export function createUI(): UIComponents {
  const screen = blessed.screen({
    smartCSR: true,
    title: "OpenCode Usage - Live",
    fullUnicode: true,
    tput: false as unknown as blessed.Widgets.IScreenOptions["tput"],
    terminal: "xterm-256color",
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
      border: { fg: "cyan" },
    },
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
      border: { fg: "green" },
    },
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
      style: { fg: "cyan" },
    },
    style: {
      border: { fg: "blue" },
    },
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
      border: { fg: "red" },
    },
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
      bg: "blue",
    },
  });

  return {
    screen,
    summaryBox,
    providersBox,
    modelsBox,
    alertsBox,
    footerBox,
  };
}

export function renderUI(ui: UIComponents, state: LiveState): void {
  const isViewMTD = state.viewMode === "mtd";

  const stats = isViewMTD ? getMTDStats(state) : getAllTimeStats(state);
  const viewLabel = isViewMTD ? `Month-to-Date (${getCurrentMonthName()})` : "All Time";

  ui.summaryBox.setLabel(` ${viewLabel} `);
  ui.summaryBox.setContent(
    ` Total Cost: {bold}${formatCost(stats.totalCost)}{/bold}          ` +
      `Total Tokens: {bold}${formatTokens(stats.totalTokens)}{/bold}          ` +
      `Messages: {bold}${stats.messageCount}{/bold}`
  );

  const providers = isViewMTD ? getProviderStatsMTD(state) : getProviderStatsAll(state);
  renderProviders(ui.providersBox, providers);

  const models = isViewMTD
    ? getModelStatsMTD(state, state.sortMode)
    : getModelStatsAll(state, state.sortMode);
  renderModels(ui.modelsBox, models, state.sortMode);

  renderAlerts(ui.alertsBox, state);

  const viewToggle = isViewMTD ? "All" : "MTD";
  const sortLabel = state.sortMode === "cost" ? "tokens" : state.sortMode === "tokens" ? "name" : "cost";
  ui.footerBox.setContent(
    ` {bold}[a]{/bold}:${viewToggle}  {bold}[c]{/bold}:sort(${sortLabel})  {bold}[?]{/bold}:help  {bold}[q]{/bold}:quit `
  );

  ui.screen.render();
}

function renderProviders(box: blessed.Widgets.BoxElement, providers: ProviderWindowStats[]): void {
  box.setLabel(" Provider Budgets ");

  if (providers.length === 0) {
    box.setContent(" No provider data");
    return;
  }

  const lines: string[] = [];
  const barWidth = 20;

  for (const p of providers.slice(0, 5)) {
    const healthColor = HEALTH_COLORS[p.health.status];
    const healthIcon = PROVIDER_HEALTH_ICONS[p.health.status];

    const providerName = padRight(p.providerID, 12);
    const costStr = padLeft(formatCost(p.totalCost), 8);
    const tokensStr = formatTokens(p.totalTokens);

    let line = ` {${healthColor}-fg}${healthIcon}{/${healthColor}-fg} ${providerName} ${costStr}  `;

    if (p.budgetCost && p.budgetCostPercent !== undefined) {
      const budgetStr = `${formatCost(p.totalCost)}/${formatCost(p.budgetCost)}`;
      const bar = makeProgressBar(p.budgetCostPercent, barWidth);
      const barColor = p.budgetCostPercent >= 90 ? "red" : p.budgetCostPercent >= 70 ? "yellow" : "green";
      const percentStr = padLeft(`${Math.round(p.budgetCostPercent)}%`, 4);
      const warning = p.budgetCostPercent >= 90 ? " {red-fg}⚠{/red-fg}" : "";
      line += `${padRight(budgetStr, 16)} {${barColor}-fg}${bar}{/${barColor}-fg} ${percentStr}${warning}`;
    } else if (p.budgetTokens && p.budgetPercent !== undefined) {
      const budgetStr = `${tokensStr}/${formatTokens(p.budgetTokens)}`;
      const bar = makeProgressBar(p.budgetPercent, barWidth);
      const barColor = p.budgetPercent >= 90 ? "red" : p.budgetPercent >= 70 ? "yellow" : "green";
      const percentStr = padLeft(`${Math.round(p.budgetPercent)}%`, 4);
      const warning = p.budgetPercent >= 90 ? " {red-fg}⚠{/red-fg}" : "";
      line += `${padRight(budgetStr, 16)} {${barColor}-fg}${bar}{/${barColor}-fg} ${percentStr}${warning}`;
    } else {
      line += `${padRight(tokensStr, 16)} (no budget)`;
    }

    if (p.health.rateLimitCount5m > 0) {
      line += ` {red-fg}[${p.health.rateLimitCount5m} 429s]{/red-fg}`;
    }

    lines.push(line);
  }

  box.setContent(lines.join("\n"));
}

function renderModels(
  box: blessed.Widgets.BoxElement,
  models: ModelWindowStats[],
  sortMode: SortMode
): void {
  const sortLabel = sortMode === "cost" ? "cost" : sortMode === "tokens" ? "tokens" : "name";
  box.setLabel(` Models (sorted by ${sortLabel}) `);

  if (models.length === 0) {
    box.setContent(" No model data");
    return;
  }

  const header =
    " " +
    padRight("Model", 28) +
    padLeft("Cost", 10) +
    padLeft("Tokens", 10) +
    "  Share        " +
    "Health";

  const lines: string[] = [` {bold}${header}{/bold}`];
  const shareBarWidth = 8;

  for (const m of models.slice(0, 15)) {
    const healthColor = MODEL_HEALTH_COLORS[m.health.status];
    const healthIcon = MODEL_HEALTH_ICONS[m.health.status];

    const modelName = padRight(m.modelID.slice(0, 26), 28);
    const costStr = padLeft(formatCost(m.totalCost), 10);
    const tokensStr = padLeft(formatTokens(m.totalTokens), 10);
    const shareBar = makeProgressBar(m.sharePercent, shareBarWidth);
    const sharePercent = padLeft(`${Math.round(m.sharePercent)}%`, 4);

    const line =
      ` ${modelName}${costStr}${tokensStr}  ${shareBar} ${sharePercent}  ` +
      `{${healthColor}-fg}${healthIcon}{/${healthColor}-fg}`;

    lines.push(line);
  }

  if (models.length > 15) {
    lines.push(` ... and ${models.length - 15} more models`);
  }

  box.setContent(lines.join("\n"));
}

function renderAlerts(box: blessed.Widgets.BoxElement, state: LiveState): void {
  box.setLabel(" Alerts ");

  const recentAlerts = state.rateLimitEvents
    .filter((e) => Date.now() - e.timestamp < 30 * 60 * 1000)
    .slice(-3)
    .reverse();

  if (recentAlerts.length === 0) {
    box.setContent(" {green-fg}No recent rate limit errors{/green-fg}");
    return;
  }

  const lines = recentAlerts.map((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const msg = e.errorMessage.length > 50 ? e.errorMessage.slice(0, 50) + "..." : e.errorMessage;
    return ` {red-fg}[${time}]{/red-fg} ${e.providerID}: ${msg}`;
  });

  box.setContent(lines.join("\n"));
}

export function setupKeyBindings(
  ui: UIComponents,
  state: LiveState,
  onRefresh: () => void
): void {
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
    const modes: SortMode[] = ["cost", "tokens", "name"];
    const currentIdx = modes.indexOf(state.sortMode);
    state.sortMode = modes[(currentIdx + 1) % modes.length];
    renderUI(ui, state);
  });

  ui.screen.key("?", () => {
    showHelp(ui);
  });
}

function showHelp(ui: UIComponents): void {
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
      bg: "black",
    },
    label: " Help ",
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
