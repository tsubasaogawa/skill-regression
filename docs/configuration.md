# 設定

## `compare` の主なオプション

| オプション | 説明 |
| --- | --- |
| `--old` / `--new` | 旧 / 新モデル。`--old` 省略時は suite.yaml の `baseline_model` |
| `--skill`, `--case` | 対象を絞る |
| `--runs`, `--runs-max` | ケースあたりの反復数と、判定が曖昧なときの追加反復の上限 |
| `--old-skills-dir` | 旧側だけ別の Skill ディレクトリを使う。ケースと入力ファイルは新側のものを両側で共有する (SKILL.md 修正前後の比較に) |
| `--aggregate-drop-pt` | 集計合格率がこれ以上 (0〜1) 下がったら DEGRADED |
| `--max-cost-usd` | 実績コストが上限に達したら以降の Skill を開始しない |
| `--webhook` | Slack Incoming Webhook 互換の URL に要約を POST |
| `--non-interactive` | 対話しない。必須項目が無ければ終了コード 3 |
| `--no-cache` | 同じ鍵の結果があっても再実行する |

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

## キャッシュ

実行結果は `Skill 名 + hash(Skill ディレクトリ) + hash(ケースと入力ファイル) + モデル + judge + runs-max` を鍵にキャッシュする。Skill ディレクトリのハッシュからは `evals/` を除くが、ケースが参照する入力ファイルの内容はケース側のハッシュに含める。旧モデルの条件が変わらなければ、別の新モデルとの比較では旧モデルの結果を再利用する。新モデル側も同じ条件なら再利用する。

キャッシュ形式はバージョン管理し、旧形式の実行結果は再利用しない。キャッシュに記録された Claude Code のバージョンが現在と異なる場合は標準エラーに警告を出す (再利用はする。`--no-cache` で再実行)。

## Store

既定は `./.skilldrift/`。

```
results.jsonl      # run ごとの正規化結果 (キャッシュの実体)
verdicts.jsonl     # ケース行と Skill 行 (case: null) の判定履歴。trend の元
raw/               # promptfoo の生 JSON
generated/         # LLM 生成ケース
reports/claude/<new-model>/<timestamp>/report.md, report.json
```
