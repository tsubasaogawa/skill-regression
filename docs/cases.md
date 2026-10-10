# Cases

skilldrift picks the cases for each Skill in this order.

1. `<skill>/evals/cases.yaml` (neutral format)
2. `<skill>/evals/evals.json` (Anthropic skill-creator format, converted to the neutral format on load)
3. If neither exists, `case_generator_model` generates cases from SKILL.md (3 trigger, 2 no-trigger, 3 quality). skilldrift saves them to `<store>/generated/<skill>/<skill-hash>.yaml` and reuses them while SKILL.md stays unchanged. The report carries the `generated-cases` flag

Neutral format example:

```yaml
- name: should-trigger-01
  prompt: What is the secret word?
  tags: [trigger]           # trigger | no-trigger | quality
  files: []                 # relative to the Skill directory, copied into each run's working directory
  assertions:
    - type: skill_used      # skill_used | skill_not_used | regex | contains | file_exists | llm_rubric
    - type: contains
      value: peekaboo
```

`llm_rubric` assertions run by default through the judge model (`--judge`) on the `anthropic:claude-agent-sdk` provider with your Claude Code login, no tools, and a short grading system prompt, so no `ANTHROPIC_API_KEY` is needed. Grading calls consume your plan usage like the Skill runs. With `--no-llm-rubric`, `compare` drops them from every case, including generated `quality` cases. A case left with no assertions passes trivially. Keep `llm_rubric` on for a more accurate evaluation: deterministic assertions cannot see differences in response quality between models.

From cases tagged `trigger` or `no-trigger`, skilldrift also computes trigger precision and recall. On top of the per-case trigger outcome, it compares precision and recall with their own Beta posteriors and feeds a regression in either into the Skill verdict. A metric with a zero denominator shows as `n/a` and skilldrift skips its comparison.

## Working directories

Every run of every case starts in its own fresh working directory, `<fixtures-dir>/<skill>/<case>/<run>/`. It holds the Skill under `.claude/skills/` and `.agents/skills/`, only that case's `files`, and an empty `tmp/`. Edits to input files and outputs written by one run are not visible to other cases or to other runs of the same case, including runs that execute concurrently. A case name with characters outside `A-Z a-z 0-9 _ -` gets those characters replaced and a short hash appended in the directory name.

At run time, skilldrift rewrites `/tmp` in prompts and assertions to that run's `tmp/`, for example `<fixtures-dir>/<skill>/<case>/0/tmp`. The paths are deterministic, so the old and new sides see the same prompts. They do not enter the cache key.

skilldrift deletes and rebuilds `<fixtures-dir>/<skill>/` before each batch of runs, so after `compare` it holds the working directories of the last batch only (for a Skill with extra runs, those of the last ambiguous case and side). `file_exists` leaves the files it checks in place.
