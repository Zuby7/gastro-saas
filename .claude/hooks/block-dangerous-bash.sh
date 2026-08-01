#!/usr/bin/env bash
# PreToolUse hook for Bash: blocks a fixed deny-list of destructive/dangerous commands.
# Reads the tool-call JSON from stdin, extracts .tool_input.command, checks it against
# patterns from the source brief's §16.3 "dangerous command hooks" list.
# Exit 2 blocks the tool call (Claude sees the stderr message); exit 0 allows it.
# No loops, no retries, no external calls here — deliberately simple and terminating.

set -euo pipefail

input="$(cat)"
command=$(printf '%s' "$input" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' || true)

if [ -z "$command" ]; then
  exit 0
fi

deny_patterns=(
  'git[[:space:]]+push[[:space:]]+.*--force'
  'git[[:space:]]+push[[:space:]]+.*-f([[:space:]]|$)'
  'git[[:space:]]+reset[[:space:]]+--hard'
  'git[[:space:]]+clean[[:space:]]+-[a-z]*f[a-z]*d'
  'rm[[:space:]]+-rf[[:space:]]+/'
  'DROP[[:space:]]+TABLE'
  'DROP[[:space:]]+DATABASE'
  'TRUNCATE[[:space:]]+TABLE'
  'supabase[[:space:]]+db[[:space:]]+reset.*(--linked|prod)'
  '\.env[^.]'
  'cat[[:space:]]+.*\.env'
  'git[[:space:]]+add[[:space:]]+.*\.env'
  'git[[:space:]]+commit[[:space:]]+--no-verify'
  '--no-gpg-sign'
)

for pattern in "${deny_patterns[@]}"; do
  if printf '%s' "$command" | grep -Eiq "$pattern"; then
    echo "Blocked by .claude/hooks/block-dangerous-bash.sh: command matches deny pattern '$pattern'. If this is genuinely intended, ask the user to run it manually." >&2
    exit 2
  fi
done

exit 0
