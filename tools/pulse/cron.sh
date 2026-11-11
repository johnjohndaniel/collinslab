#!/usr/bin/env bash
# Turn the hourly project pulse on or off. Usage: tools/pulse/cron.sh on|off|status
# "on" installs the hourly crontab line and runs one cycle now. "off" removes the line.
# Code, config (~/.config/collinslab/pulse.json) and state (~/.local/state/collinslab/pulse/) stay in place.
set -euo pipefail
RUN="$(cd "$(dirname "$0")" && pwd)/run.sh"
LOG="$HOME/.local/state/collinslab/pulse.log"
LINE="0 * * * * /usr/bin/flock -n /tmp/collinslab-pulse.lock $RUN >> $LOG 2>&1"
others() { crontab -l 2>/dev/null | grep -vF "$RUN" || true; }
case "${1:-status}" in
  on)
    { others; echo "$LINE"; } | crontab -
    echo "pulse on: hourly at :00"
    env -i HOME="$HOME" PATH=/usr/bin:/bin LANG=C.UTF-8 /usr/bin/flock -n /tmp/collinslab-pulse.lock "$RUN" >> "$LOG" 2>&1 || true
    tail -3 "$LOG" ;;
  off)
    others | crontab -
    echo "pulse off" ;;
  status)
    if crontab -l 2>/dev/null | grep -qF "$RUN"; then echo "pulse on"; else echo "pulse off"; fi
    tail -2 "$LOG" 2>/dev/null || true ;;
  *) echo "usage: $0 on|off|status" >&2; exit 2 ;;
esac
