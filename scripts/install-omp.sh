#!/bin/sh
# frontmatter + core prompt → omp agent definition, and the /docent slash command extension (ADR 0044)
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
case "${1:-}" in
  --project) dest=".omp/agents"; extensions=".omp/extensions" ;;
  "")        dest="$HOME/.omp/agent/agents"; extensions="$HOME/.omp/agent/extensions" ;;
  *) echo "usage: $0 [--project]" >&2; exit 2 ;;
esac
mkdir -p "$dest" "$extensions"
cat "$root/adapters/omp/frontmatter.md" "$root/prompt/docent.md" > "$dest/vibecoder-docent.md"
cp "$root/adapters/omp/docent-command.ts" "$extensions/vibecoder-docent-command.ts"
echo "installed: $dest/vibecoder-docent.md"
echo "installed: $extensions/vibecoder-docent-command.ts (/docent, 새 omp 세션부터 적용)"
