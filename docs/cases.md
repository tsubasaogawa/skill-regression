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

`llm_rubric` assertions are opt-in. Without `--llm-rubric`, `compare` drops them from every case, including generated `quality` cases, and needs no `ANTHROPIC_API_KEY`. With the flag, they run through the judge model (`--judge`). A case left with no assertions passes trivially. For a more accurate evaluation, we recommend enabling `llm_rubric`: deterministic assertions cannot see differences in response quality between models.

From cases tagged `trigger` or `no-trigger`, skilldrift also computes trigger precision and recall. On top of the per-case trigger outcome, it compares precision and recall with their own Beta posteriors and feeds a regression in either into the Skill verdict. A metric with a zero denominator shows as `n/a` and skilldrift skips its comparison. At run time, skilldrift rewrites `/tmp` in prompts and assertions to `<fixture>/tmp`.
