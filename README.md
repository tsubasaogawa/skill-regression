# skilldrift

新しいモデルが出たときに、Claude Code の Skill がデグレードしていないかを自動判定する CLI。

旧モデルと新モデルで同じ Skill を同じケースで複数回実行する。

合格率の差を Beta 事後分布で比較し、Skill ごとに REGRESSED / DEGRADED / INCONCLUSIVE / IMPROVED / UNCHANGED を出す。

実行は [promptfoo](https://www.promptfoo.dev/) の `anthropic:claude-agent-sdk` provider 経由で、Claude Code のログインで動く。

## メリット

- Skill 単位でデグレードを検出できる。モデル単体で性能が上がっても、個別の Skill やケースはデグレードしうるため (参考文献を参照)、集計ではなくケースごとに新旧モデルを比較する。
- デグレードの有無を確率で判定する。LLM の出力はばらつくので 1 回の比較では信用できない。複数回実行して Beta 事後分布で P(新 < 旧) を出し、曖昧なら反復を自動で追加する。
- Skill の CI に本 CLI を組み込むことでリリース前のデグレ確認に使える。

## 必要なもの

- Node.js 22.22 以上、pnpm
- Claude Code (Skill の実行とケース生成はログインで動く)
- `llm_rubric` assertion を使う場合は環境変数 `ANTHROPIC_API_KEY` (judge は Anthropic Messages API を直接呼ぶ。生成ケースは必ず `llm_rubric` を含む)

```sh
pnpx skilldrift --help
```

## 使い方

```sh
# suite.yaml の雛形を作る
skilldrift init --baseline-model claude-sonnet-5-5

# 対象 Skill とケース数を確認する
skilldrift compare --dry-run

# 旧モデルと新モデルを比較する
skilldrift compare --new claude-opus-5-5 --runs 5 --runs-max 15

# 判定履歴を見る
skilldrift trend --skill my-skill

# 生成ケースを人手ケースに昇格させる
skilldrift cases export my-skill > ~/.claude/skills/my-skill/evals/cases.yaml
```

## セキュリティ上の注意

評価対象の Skill は Claude Code の全ツールを許可した状態 (`bypassPermissions`) でホスト上に直接実行される。サンドボックスはない。

- Skill の SKILL.md や同梱スクリプト、ケースの prompt、生成ケースに含まれる指示は、実行ユーザーの権限で任意のコマンドとして実行されうる
- ケースの `files` で `.claude/settings.json` を fixture に置くと、hooks などの設定も有効になる
- 信頼できない Skill を評価するときは、コンテナや devcontainer など隔離された環境で実行すること

## ドキュメント

- [設定](docs/configuration.md): `compare` のオプション、suite.yaml、キャッシュ、Store
- [ケース](docs/cases.md): ケースの探索順と中立形式
- [判定と終了コード](docs/verdicts.md): 判定条件、終了コード、フラグ
- [開発](DEVELOPMENT.md): ビルド、テスト、ソース構成

## 参考文献

新モデルの登場で既存の Skill やプロンプトが退行しうることを示す研究と一次資料。

- Anthropic「[Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)」: Skill の有効性は基盤モデルに依存するため、使う予定のモデルすべてでテストせよと明記
- Anthropic「[Prompting Claude Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)」: 旧モデル向けの Skill は新モデルには指示が細かすぎ、出力品質を下げうる
- Anthropic「[Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)」: 旧モデル向けの強い表現が新モデルでは過剰に発火する
- Anthropic「[Improving skill-creator](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills)」: 新モデルへの eval 実行を Skill メンテナンスの手段として位置付け
- Ma, Yang, Kästner 2024「[(Why) Is My Prompt Getting Worse?](https://arxiv.org/abs/2311.11123)」CAIN 2024: 全体精度が改善した更新の 87.9% で個別プロンプトの退行が発生
- Xu & Wu 2026「[What Aggregate Scores Miss](https://arxiv.org/abs/2608.17719)」: 集計スコアが +7.3 pp でも 8.3% の項目が安定して退行
- Cacioli 2026「[Beyond the Mean](https://arxiv.org/abs/2604.27405)」: 平均は改善しても項目の 28〜39% が悪化
- Sheng & Lu 2026「[No Universal Signal Predicts Sample-Level LLM Regression](https://arxiv.org/abs/2608.13607)」: 退行する項目を事前予測する汎用シグナルはなく、更新ごとの回帰テストが唯一の検出手段
- Wang et al. 2025「[PromptBridge](https://arxiv.org/abs/2512.01420)」: 特定モデル向けに最適化したプロンプトは他モデルで 2〜11 pt 低下 (Model Drifting)
- Sclar et al. 2024「[Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design](https://arxiv.org/abs/2310.11324)」ICLR 2024: 書式の効き方はモデル間で弱くしか相関しない
- Nori et al. 2024「[From Medprompt to o1](https://arxiv.org/abs/2411.03590)」: 旧世代向けの few-shot / CoT が推論モデルでは逆効果
- Liang et al. 2025「[Prompts Are Programs Too!](https://arxiv.org/abs/2409.12447)」FSE 2025: マイナーバージョン変更でプロンプトがほぼ全て壊れたという実務者の報告
- Tripathi et al. 2025「[Prompt Migration](https://arxiv.org/abs/2507.05573)」: モデル更新で本番アプリのテスト合格率が 100% から 97.3% に低下し、プロンプト書き直しで回復

## ライセンス

MIT
