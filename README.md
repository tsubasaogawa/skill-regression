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

`compare` の主なオプション:

| オプション | 説明 |
| --- | --- |
| `--old` / `--new` | 旧 / 新モデル。`--old` 省略時は suite.yaml の `baseline_model` |
| `--skill`, `--case` | 対象を絞る |
| `--runs`, `--runs-max` | ケースあたりの反復数と、判定が曖昧なときの追加反復の上限 |
| `--old-skills-dir` | 旧側だけ別の Skill ディレクトリを使う (SKILL.md 修正前後の比較に) |
| `--aggregate-drop-pt` | 集計合格率がこれ以上 (0〜1) 下がったら DEGRADED |
| `--max-cost-usd` | 実績コストが上限に達したら以降の Skill を開始しない |
| `--webhook` | Slack Incoming Webhook 互換の URL に要約を POST |
| `--non-interactive` | 対話しない。必須項目が無ければ終了コード 3 |
| `--no-cache` | 同じ鍵の結果があっても再実行する |

旧モデルの結果は `hash(Skill ディレクトリ) + hash(ケース) + モデル + judge + runs-max` を鍵にキャッシュされ、Skill もケースも変わらなければ 2 回目以降は新モデルだけを実行する。

## suite.yaml

```yaml
baseline_model: claude-sonnet-5-5
# skills: [my-skill]            # 省略時は --skills-dir 配下の全 Skill
runs: 5
aggregate_drop_pt: 0.1
case_generator_model: claude-sonnet-5-5
max_cost_usd: 20
```

値は CLI 引数 → suite.yaml → 既定値 → 対話入力の順で解決する。

## ケース

Skill ごとに次の順でケースを決める。

1. `<skill>/evals/cases.yaml` (中立形式)
2. `<skill>/evals/evals.json` (Anthropic skill-creator 形式。読み込み時に中立形式へ変換)
3. どちらも無ければ `case_generator_model` が SKILL.md から生成する (trigger 3、no-trigger 2、quality 3)。生成結果は `<store>/generated/<skill>/<skill-hash>.yaml` に保存され、SKILL.md が同じ間は再利用される。レポートには `generated-cases` フラグが付く

中立形式の例:

```yaml
- name: should-trigger-01
  prompt: 合言葉を教えて
  tags: [trigger]           # trigger | no-trigger | quality
  files: []                 # Skill ディレクトリ相対。fixture にコピーされる
  assertions:
    - type: skill_used      # skill_used | skill_not_used | regex | contains | file_exists | llm_rubric
    - type: contains
      value: ピカブー
```

`trigger` / `no-trigger` タグのケースからは発火の precision / recall も算出し、その回帰も Skill 判定に反映する。prompt や assertion 内の `/tmp` は実行時に `<fixture>/tmp` へ書き換えられる。

## 判定と終了コード

| 判定 | 条件 |
| --- | --- |
| REGRESSED | P(p_new < p_old) >= 0.95 のケースがある、または発火 precision / recall が退行 |
| DEGRADED | REGRESSED 無しで、集計合格率の低下が `aggregate_drop_pt` 以上 |
| INCONCLUSIVE | 追加反復を使い切っても P_reg が 0.8〜0.95 に留まる |
| IMPROVED | P_reg <= 0.05 のケースがある |
| UNCHANGED | 上記以外 |

終了コードは 0 = 退行無し、1 = 決定的 assertion の REGRESSED あり、2 = DEGRADED / INCONCLUSIVE / 一部未実行、3 = 入力エラー。`llm_rubric` だけに依存する退行は 1 にせずレポートのみ。

フラグ: `generated-cases` (生成ケース)、`judge-dependent` (judge 依存)、`partial` (エラー run あり)、`low-power` (反復が少なく新モデルが全滅しても REGRESSED に届かない)。

## Store

既定は `./.skilldrift/`。

```
results.jsonl      # run ごとの正規化結果 (キャッシュの実体)
verdicts.jsonl     # ケース行と Skill 行 (case: null) の判定履歴。trend の元
raw/               # promptfoo の生 JSON
generated/         # LLM 生成ケース
reports/claude/<new-model>/<timestamp>/report.md, report.json
```

## 開発

```sh
pnpm test                 # vitest
scripts/acceptance.sh     # 合成 Skill で UNCHANGED / REGRESSED を実機確認 (Claude Code の使用量を消費)
```

設計の経緯と残タスクは `implementation_plan.md` を参照。

## ライセンス

MIT
