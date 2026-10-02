# 開発

## コマンド

```sh
pnpm install
pnpm dev -- compare --dry-run   # tsx で src/cli.ts を直接実行
pnpm build                      # tsc → dist/
pnpm test                       # vitest
scripts/acceptance.sh           # 合成 Skill で UNCHANGED / REGRESSED を実機確認 (Claude Code の使用量を消費)
```

`scripts/acceptance.sh` は `MODEL` (既定 sonnet) と `RUNS` (既定 3) を環境変数で上書きできる。

## 構成

```
src/
  cli.ts        # commander のエントリ。init / compare / trend / cases の各サブコマンド、webhook 送信
  config/       # 既定値と suite.yaml の読み込み
  cases/        # cases.yaml / evals.json の読み込み、LLM 生成、Skill とケースのハッシュ
  planner/      # fixture ディレクトリの組み立て
  runner/       # promptfoo 経由の実行と結果の正規化
  comparator/   # Beta 事後分布による比較と判定
  reporter/     # report.md / report.json の生成
  store/        # results.jsonl / verdicts.jsonl の読み書き
test/           # vitest。おおむね src のモジュール単位
fixtures/       # テスト用 Skill
```
