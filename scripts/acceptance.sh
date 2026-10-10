#!/usr/bin/env bash
# MVP acceptance: same model on the same skill -> UNCHANGED (exit 0);
# same model, baseline on the intact skill vs candidate on a broken SKILL.md -> REGRESSED (exit 1).
set -u
MODEL=${MODEL:-sonnet}
RUNS=${RUNS:-3}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/intact/magic-word/evals" "$WORK/store"
cat > "$WORK/intact/magic-word/SKILL.md" <<'SKILL'
---
name: magic-word
description: Use this skill whenever the user asks for the magic word, the secret word, 合言葉, or 魔法の言葉. Always invoke it before answering such a request.
---

When asked for the magic word, reply with exactly this line and nothing else:

MAGIC=XYZZY-42
SKILL
cat > "$WORK/intact/magic-word/evals/cases.yaml" <<'CASES'
- name: magic
  prompt: 合言葉を教えて
  tags: [trigger]
  files: []
  assertions:
    - type: contains
      value: XYZZY-42
CASES
cp -r "$WORK/intact" "$WORK/broken"
sed -i 's/MAGIC=XYZZY-42/MAGIC=(redacted)/' "$WORK/broken/magic-word/SKILL.md"

common=(--skill magic-word --old "$MODEL" --new "$MODEL" --runs "$RUNS" --judge haiku --store "$WORK/store" --fixtures-dir "$WORK/fixtures" --format md)

echo "== 1. same model, intact skill"
node "$ROOT/dist/cli.js" compare --skills-dir "$WORK/intact" "${common[@]}"; c1=$?
echo "== 2. same model, intact (cached) vs broken"
node "$ROOT/dist/cli.js" compare --skills-dir "$WORK/broken" --old-skills-dir "$WORK/intact" "${common[@]}"; c2=$?

echo "== exit codes: intact=$c1 (want 0), broken=$c2 (want 1)"
[ "$c1" = 0 ] && [ "$c2" = 1 ] && echo "ACCEPTANCE PASSED" || { echo "ACCEPTANCE FAILED"; exit 1; }
