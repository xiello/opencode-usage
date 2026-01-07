# opencode-usage

CLI tool to track and display OpenCode token usage statistics.

## Installation

```bash
git clone https://github.com/xiello/opencode-usage.git
cd opencode-usage
bun install
```

The CLI is ready to use immediately after clone (dist/ is included).

## Usage

### Static Reports

```bash
# Show all-time totals
opencode-usage

# Last 7 days
opencode-usage --since 7d

# Group by agent/model/provider/session
opencode-usage --by agent
opencode-usage --by model --limit 10

# JSON output
opencode-usage --json
```

### Live Dashboard

```bash
opencode-usage live
```

Real-time TUI showing:
- Month-to-date totals (cost, tokens, messages)
- Provider budget progress bars
- Per-model usage with health indicators
- Rate limit alerts

**Keybindings:**
- `a` - Toggle MTD / All Time view
- `c` - Cycle sort mode (cost / tokens / name)
- `r` - Refresh
- `?` - Help
- `q` - Quit

## Configuration

### Budgets

Create `~/.config/opencode-usage/budgets.json`:

```json
{
  "anthropic": {
    "monthlyCost": 100
  },
  "openai": {
    "monthlyTokens": 50000000
  }
}
```

Supports either `monthlyCost` (in dollars) or `monthlyTokens` per provider.

### Limits (optional)

Create `~/.config/opencode-usage/limits.json`:

```json
{
  "anthropic": {
    "tokens5h": 5000000,
    "tokensDaily": 20000000
  }
}
```

## Data Source

Reads from OpenCode's local storage at `~/.local/share/opencode/storage/`.

## Development

```bash
bun run typecheck
bun run build
```

## License

MIT
