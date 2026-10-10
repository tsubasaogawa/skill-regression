# skilldrift

Test Claude Code Skills against a new model before you adopt it.

skilldrift runs the same cases against an old model and a candidate model, with repeated runs for each Skill.

It compares pass rates with a Beta posterior and assigns each Skill one of five verdicts: `REGRESSED`, `DEGRADED`, `INCONCLUSIVE`, `IMPROVED`, or `UNCHANGED`.

Runs use promptfoo's [`anthropic:claude-agent-sdk`](https://www.promptfoo.dev/) provider, so your Claude Code login is sufficient.

## Why use skilldrift?

- Find regressions at the Skill and case level. A model can improve its aggregate score while it makes individual Skills or cases worse. skilldrift compares the two models case by case.
- Make decisions from repeated evidence. LLM output varies, so skilldrift repeats cases, calculates `P(new < old)` with a Beta posterior, and adds runs when the result remains ambiguous.
- Add a pre-release regression gate to your Skill's CI.

## Requirements

- Node.js 22.22 or later and pnpm
- Claude Code. Use your Claude Code login

skilldrift grades `llm_rubric` assertions by default. Pass `--no-llm-rubric` to skip the LLM judge and use deterministic assertions.

```sh
pnpx skilldrift --help
```

## Usage

```sh
# Create suite.yaml to avoid repeating options and pin CI settings
skilldrift init --baseline-model claude-sonnet-5-5

# Review the Skills and cases that will run
skilldrift compare --dry-run

# Compare an old model with a candidate model.
# --old defaults to baseline_model in suite.yaml.
skilldrift compare --old claude-sonnet-5 --new claude-sonnet-5-5

# Compare one Skill
skilldrift compare --old claude-sonnet-5 --new claude-sonnet-5-5 --skill my-skill

# View verdict history
skilldrift trend --skill my-skill

# Export generated cases for review and maintenance
skilldrift cases export my-skill > ~/.claude/skills/my-skill/evals/cases.yaml
```

promptfoo prints `Using unknown model for Claude Agent SDK: <model>` when its model list does not include your model. The comparison still runs. Set `LOG_LEVEL=error` to hide that message and promptfoo's other warnings.

```sh
LOG_LEVEL=error skilldrift compare --old claude-sonnet-5 --new claude-sonnet-5-5
```

## Security considerations

skilldrift runs each Skill on your host with Claude Code tools set to `bypassPermissions`. It does not provide a sandbox.

- `SKILL.md`, bundled scripts, case prompts, and instructions in generated cases can execute commands with your user account's privileges.
- A case can add `.claude/settings.json` to its fixture through `files`. Claude Code then loads that file's hooks and other settings.
- Run untrusted Skills in an isolated environment, such as a container or devcontainer.

## Documentation

- [Configuration](docs/configuration.md): `compare` options, suite.yaml, cache, Store
- [Cases](docs/cases.md): lookup order and the neutral case format
- [Verdicts and exit codes](docs/verdicts.md): verdict criteria, exit codes, flags
- [Development](DEVELOPMENT.md): build, tests, source layout

## References

Research and primary sources on model updates that regress existing Skills and prompts:

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
