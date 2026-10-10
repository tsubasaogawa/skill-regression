# Configuration

## Main `compare` options

| Option | Description |
| --- | --- |
| `--old` / `--new` | Old and new model. Without `--old`, skill-regression uses `baseline_model` from suite.yaml |
| `--skill`, `--case` | Limit the run to specific Skills or cases |
| `--runs`, `--runs-max` | Runs per case (default 3), and the cap on extra runs added when a verdict stays ambiguous (default: the larger of 10 and `--runs`) |
| `--old-skills-dir` | Use a different Skill directory for the old side. Both sides share the new side's cases and input files (for comparing a SKILL.md before and after an edit) |
| `--aggregate-drop-pt` | Mark the Skill DEGRADED when the aggregate pass rate drops by at least this much (0 to 1) |
| `--max-cost-usd` | Stop starting new Skills once the recorded cost reaches this limit |
| `--webhook` | POST a summary to a Slack Incoming Webhook compatible URL |
| `--non-interactive` | Skip prompts. Exit with code 3 when a required value is missing |
| `--no-cache` | Re-run even when a result with the same key exists |

## suite.yaml

suite.yaml is optional. Create it with `init` when you want to stop repeating `--old`, `--runs`, and other options on every run, or to pin the settings in CI.

```yaml
baseline_model: claude-sonnet-5-5
# skills: [my-skill]            # defaults to all Skills under --skills-dir
runs: 5
aggregate_drop_pt: 0.1
case_generator_model: claude-sonnet-5-5
max_cost_usd: 20
```

skill-regression resolves each value in this order: CLI argument, suite.yaml, built-in default, interactive prompt.

`init` writes suite.yaml to `<store>/suite.yaml` by default (see [Store](#store)), and `compare` reads it from there. Change the location with `--suite <file>`.

## Cache

skill-regression caches each result under the key `Skill name + hash(Skill directory) + hash(cases and input files) + model + judge + runs-max`. The Skill directory hash excludes `evals/`, while the case hash includes the contents of input files the cases reference. As long as the old model's conditions stay the same, a comparison against a different new model reuses the old model's results. The new side reuses results under the same rule.

The cache format carries a version, and skill-regression ignores results written in an older format. If the Claude Code version recorded in the cache differs from the current one, skill-regression prints a warning to stderr but still reuses the results. Pass `--no-cache` to re-run.

## Store

Defaults to `$XDG_DATA_HOME/skill-regression/`, or `~/.local/share/skill-regression/` when `XDG_DATA_HOME` is unset, empty, or not an absolute path. Change it with `--store <dir>`.

```
results.jsonl      # normalized result per run (the cache itself)
verdicts.jsonl     # verdict history, one row per Skill. Source for trend
generated/         # LLM-generated cases
reports/claude/<new-model>/<timestamp>/report.md, report.json
```
