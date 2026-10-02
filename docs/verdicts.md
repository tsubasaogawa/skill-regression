# Verdicts and exit codes

| Verdict | Condition |
| --- | --- |
| REGRESSED | At least one case has P(p_new < p_old) >= 0.95, or trigger precision or recall regressed |
| DEGRADED | No REGRESSED case, and the aggregate pass rate dropped by `aggregate_drop_pt` or more |
| INCONCLUSIVE | P_reg stays between 0.8 and 0.95 after skilldrift exhausts the extra runs |
| IMPROVED | At least one case has P_reg <= 0.05 |
| UNCHANGED | Anything else |

Exit codes: 0 = no regression, 1 = REGRESSED on a deterministic assertion or on trigger detection, 2 = DEGRADED, INCONCLUSIVE, or some cases did not run, 3 = input error. A regression that rests on `llm_rubric` alone stays in the report and does not raise the exit code to 1. When a case has both deterministic assertions and `llm_rubric`, skilldrift compares the deterministic pass rate on its own and uses that for the exit code.

Flags: `generated-cases` (cases came from the generator), `judge-dependent` (verdict depends on the judge), `has-errors` (some runs errored and were excluded), `low-power` (too few runs: the Skill would not reach REGRESSED even if the new model failed each run).
