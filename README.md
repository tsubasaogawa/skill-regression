# skilldrift

A CLI that tells you whether a new model has regressed your Claude Code Skills.

skilldrift runs each Skill against the same cases on the old model and the new one, several times each.

It compares the pass rates with a Beta posterior and labels each Skill REGRESSED, DEGRADED, INCONCLUSIVE, IMPROVED, or UNCHANGED.

Runs go through the `anthropic:claude-agent-sdk` provider of [promptfoo](https://www.promptfoo.dev/), so your Claude Code login is enough.

## Why

- Catches regressions per Skill. A model can score higher overall while individual Skills or cases get worse (see References), so skilldrift compares old and new per case instead of in aggregate.
- Reports regressions as probabilities. LLM output varies, so one comparison proves little. skilldrift repeats each case, computes P(new < old) from a Beta posterior, and adds runs when the result stays ambiguous.
- Fits into a Skill's CI as a pre-release regression gate.

## Requirements

- Node.js 22.22 or later, pnpm
- Claude Code (Skill runs and case generation use your login)
- `ANTHROPIC_API_KEY` only if you pass `--llm-rubric`. Without the flag, `llm_rubric` assertions (including those in generated `quality` cases) are ignored. The judge calls the Anthropic Messages API itself. Enabling `--llm-rubric` is recommended for a more accurate evaluation.

```sh
pnpx skilldrift --help
```

## Usage

```sh
# Scaffold suite.yaml
skilldrift init --baseline-model claude-sonnet-5-5

# Check which Skills and how many cases will run
skilldrift compare --dry-run

# Compare the old model with a new one
skilldrift compare --new claude-opus-5-5 --runs 5 --runs-max 15

# Show verdict history
skilldrift trend --skill my-skill

# Promote generated cases to hand-written ones
skilldrift cases export my-skill > ~/.claude/skills/my-skill/evals/cases.yaml
```

## Security

skilldrift runs the Skills under test on your host with Claude Code's tools unrestricted (`bypassPermissions`). There is no sandbox.

- SKILL.md, bundled scripts, case prompts, and instructions inside generated cases can run arbitrary commands with your user's privileges.
- A case that places `.claude/settings.json` in the fixture via `files` also activates hooks and other settings from that file.
- Run untrusted Skills in an isolated environment such as a container or devcontainer.

## Documentation

- [Configuration](docs/configuration.md): `compare` options, suite.yaml, cache, Store
- [Cases](docs/cases.md): lookup order and the neutral case format
- [Verdicts and exit codes](docs/verdicts.md): verdict criteria, exit codes, flags
- [Development](DEVELOPMENT.md): build, tests, source layout

## References

Research and primary sources showing that a new model can regress existing Skills and prompts.

- Anthropic, "[Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)": Skill effectiveness depends on the underlying model, so test on each model you plan to use.
- Anthropic, "[Prompting Claude Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)": Skills written for older models can over-specify instructions for newer ones and lower output quality.
- Anthropic, "[Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)": forceful wording written for older models over-triggers on newer ones.
- Anthropic, "[Improving skill-creator](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills)": positions running evals against new models as part of Skill maintenance.
- Ma, Yang, Kästner 2024, "[(Why) Is My Prompt Getting Worse?](https://arxiv.org/abs/2311.11123)", CAIN 2024: 87.9% of updates that improved overall accuracy regressed individual prompts.
- Xu & Wu 2026, "[What Aggregate Scores Miss](https://arxiv.org/abs/2608.17719)": 8.3% of items regressed across runs despite a +7.3 pp gain in the aggregate score.
- Cacioli 2026, "[Beyond the Mean](https://arxiv.org/abs/2604.27405)": 28 to 39% of items got worse while the mean improved.
- Sheng & Lu 2026, "[No Universal Signal Predicts Sample-Level LLM Regression](https://arxiv.org/abs/2608.13607)": no general signal predicts which items will regress, so per-update regression testing is the only way to catch them.
- Wang et al. 2025, "[PromptBridge](https://arxiv.org/abs/2512.01420)": prompts tuned for one model drop 2 to 11 points on other models (Model Drifting).
- Sclar et al. 2024, "[Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design](https://arxiv.org/abs/2310.11324)", ICLR 2024: formatting effects show weak correlation across models.
- Nori et al. 2024, "[From Medprompt to o1](https://arxiv.org/abs/2411.03590)": few-shot and chain-of-thought prompting designed for earlier models hurt reasoning models.
- Liang et al. 2025, "[Prompts Are Programs Too!](https://arxiv.org/abs/2409.12447)", FSE 2025: practitioners report that a minor version change broke all but a few of their prompts.
- Tripathi et al. 2025, "[Prompt Migration](https://arxiv.org/abs/2507.05573)": a model update dropped a production app's test pass rate from 100% to 97.3%, and rewriting the prompts restored it.

## License

MIT
