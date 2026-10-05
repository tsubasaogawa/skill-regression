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
  files: []                 # relative to the Skill directory, copied into the fixture
  assertions:
    - type: skill_used      # skill_used | skill_not_used | regex | contains | file_exists | llm_rubric
    - type: contains
      value: peekaboo
```

`llm_rubric` assertions run by default through the judge model (`--judge`) on the `anthropic:claude-agent-sdk` provider with your Claude Code login, no tools, and a short grading system prompt, so no `ANTHROPIC_API_KEY` is needed. Grading calls consume your plan usage like the Skill runs. With `--no-llm-rubric`, `compare` drops them from every case, including generated `quality` cases. A case left with no assertions passes trivially. Keep `llm_rubric` on for a more accurate evaluation: deterministic assertions cannot see differences in response quality between models.

From cases tagged `trigger` or `no-trigger`, skilldrift also computes trigger precision and recall. On top of the per-case trigger outcome, it compares precision and recall with their own Beta posteriors and feeds a regression in either into the Skill verdict. A metric with a zero denominator shows as `n/a` and skilldrift skips its comparison. At run time, skilldrift rewrites `/tmp` in prompts and assertions to `<fixture>/tmp`.
