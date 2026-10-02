# skilldrift

新しいモデルが出たときに、Claude Code の Skill が退行していないかを自動判定する CLI。

旧モデルと新モデルで同じ Skill を同じケースで複数回実行し、合格率の差を Beta 事後分布で比較して Skill ごとに REGRESSED / DEGRADED / INCONCLUSIVE / IMPROVED / UNCHANGED を出す。実行は [promptfoo](https://www.promptfoo.dev/) の `anthropic:claude-agent-sdk` provider 経由で、Claude Code のログインで動く。

## 必要なもの

- Node.js 22.22 以上、pnpm
- Claude Code (ログイン済み)
- `ANTHROPIC_API_KEY` (`llm_rubric` assertion の judge を使うときだけ)

```sh
pnpm install
pnpm build
node dist/cli.js --help
```

## 使い方

```sh
# suite.yaml の雛形を作る
skilldrift init --baseline-model claude-sonnet-5-5

# 対象 Skill とケース数を確認する (API は呼ばない)
skilldrift compare --dry-run

# 旧モデルと新モデルを比較する
skilldrift compare --new claude-opus-5-5 --runs 5 --runs-max 15

# 判定履歴を見る
skilldrift trend --skill my-skill

# 生成ケースを人手ケースに昇格させる
skilldrift cases export my-skill > ~/.claude/skills/my-skill/evals/cases.yaml
```

## ドキュメント

- [設定](docs/configuration.md): `compare` のオプション、suite.yaml、キャッシュ、Store
- [ケース](docs/cases.md): ケースの探索順と中立形式
- [判定と終了コード](docs/verdicts.md): 判定条件、終了コード、フラグ
- [開発](DEVELOPMENT.md): ビルド、テスト、ソース構成

## ライセンス

MIT
