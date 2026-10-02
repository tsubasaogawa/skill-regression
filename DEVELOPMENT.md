# Development

## Commands

```sh
pnpm install
pnpm dev -- compare --dry-run   # run src/cli.ts through tsx
pnpm build                      # tsc to dist/
pnpm test                       # vitest
scripts/acceptance.sh           # check UNCHANGED / REGRESSED on synthetic Skills against real models (consumes Claude Code usage)
```

`scripts/acceptance.sh` reads `MODEL` (default sonnet) and `RUNS` (default 3) from the environment.

## Layout

```
src/
  cli.ts        # commander entry point. init / compare / trend / cases subcommands, webhook delivery
  config/       # defaults and suite.yaml loading
  cases/        # cases.yaml / evals.json loading, LLM generation, Skill and case hashing
  planner/      # fixture directory assembly
  runner/       # execution through promptfoo and result normalization
  comparator/   # Beta posterior comparison and verdicts
  reporter/     # report.md / report.json generation
  store/        # results.jsonl / verdicts.jsonl read and write
test/           # vitest, about one file per src module
fixtures/       # Skills used by the tests
```
