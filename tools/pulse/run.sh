#!/usr/bin/env bash
# Hourly project pulse: scan -> (stop if unchanged) -> Claude orchestrator with Haiku workers -> push to D1.
# Cron: 0 * * * * /usr/bin/flock -n /tmp/collinslab-pulse.lock <repo>/tools/pulse/run.sh >> ~/.local/state/collinslab/pulse.log 2>&1
# Extra arguments go to scan.py (--force, --only SLUG ...). Set PULSE_NO_PUSH=1 to stop before D1.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${PULSE_STATE:-$HOME/.local/state/collinslab/pulse}"
BUDGET="${PULSE_BUDGET_USD:-6}"
CLAUDE="$HOME/.local/bin/claude"
mkdir -p "$STATE/projects" "$STATE/runs"
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

changed="$(/usr/bin/python3 "$REPO/tools/pulse/scan.py" --state "$STATE" "$@")" || { echo "$(ts) scan failed"; exit 1; }
if [ "$changed" = "unchanged" ]; then
  echo "$(ts) unchanged"
  exit 0
fi

agents="$(jq -n --rawfile p "$REPO/tools/pulse/worker.md" \
  '{"pulse-worker": {description: "Summarise one project into one pulse JSON file.", prompt: $p, tools: ["Read", "Glob", "Grep", "Write"], model: "haiku"}}')"
prompt="$(cat "$REPO/tools/pulse/orchestrator.md")

STATE=$STATE"
run="$STATE/runs/$(date -u +%Y%m%dT%H%M%S).jsonl"
start=$(date +%s)
# Isolation: no user settings (they grant bypassPermissions), no MCP servers, no shell or network,
# writes only inside STATE, no reads of secrets.
cd "$STATE" && timeout 2700 "$CLAUDE" -p "$prompt" \
  --model sonnet --agents "$agents" \
  --setting-sources project --strict-mcp-config \
  --allowedTools Read Glob Grep Agent "Edit(/$STATE/**)" \
  --disallowedTools Bash WebFetch WebSearch NotebookEdit CronCreate CronDelete RemoteTrigger PushNotification SendMessage Workflow Skill EnterWorktree DesignSync \
    "Read(/$HOME/.config/**)" "Read(/$HOME/.ssh/**)" "Read(/$HOME/.claude/.credentials.json)" "Read(//**/.dev.vars)" "Read(//**/*.env)" \
  --permission-mode dontAsk --max-turns 120 --max-budget-usd "$BUDGET" \
  --output-format stream-json --verbose > "$run" 2> "$run.err"
rc=$?
secs=$(( $(date +%s) - start ))
summary="$(jq -r 'select(.type=="result") | "\(.result | gsub("\n"; " ") | .[0:120]) cost=$\(.total_cost_usd * 100 | round / 100) turns=\(.num_turns)"' "$run" 2>/dev/null | tail -1)"
echo "$(ts) changed=[$changed] claude rc=$rc ${secs}s $summary"

if [ "${PULSE_NO_PUSH:-0}" != "1" ]; then
  /usr/bin/python3 "$REPO/tools/pulse/push.py" --state "$STATE" || echo "$(ts) push failed"
fi
# Keep the 48 newest run transcripts.
ls -1t "$STATE"/runs/*.jsonl 2>/dev/null | tail -n +49 | while read -r f; do rm -f -- "$f" "$f.err"; done
