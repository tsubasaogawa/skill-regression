# skilldrift 実装計画 (フェーズ 1 MVP)

作成日: 2026-09-25
設計元: Obsidian ノート「新モデル登場時に Skill の退行を自動判定するツールの設計」

## 1. 実機確認で確定した事項

設計ノートで「要確認」としていた項目を、promptfoo 0.123.1 の型定義とバンドル、公式ドキュメント、手元の Skill で確認した結果。

### 1.1 環境

| 項目 | 確認結果 |
| --- | --- |
| 実行環境 | WSL2 Ubuntu1804、Node v25.2.1、npm 11.18.0、git 2.48.1、tsx 4.23.15 |
| promptfoo | 0.123.1 (npm 最新)。`~/dev/skilldrift` に `pnpm add promptfoo@0.123.1` 済み (パッケージ管理は pnpm 11.9.0、`packageManager` フィールドで固定)。ESM (`"type": "module"`)、`engines.node >= 22.22.0`、exports は `.` と `./contracts` のみ |
| Claude Code | 2.1.282 (`claude` は mise shim) |
| Codex CLI | 0.156.1 (`codex` は mise shim) |
| 対象 Skill | `~/.claude/skills` 配下に 20 ディレクトリ (設計時の 16 個から増加)。`evals/evals.json` を持つのは `database-sync-masking-duration`、`estimate-story-point`、`markdown-backlog-converter` の 3 個。`evals/cases.yaml` を持つ Skill は無し |

### 1.2 promptfoo ライブラリ API

- `evaluate(testSuite: EvaluateTestSuite, options?: EvaluateOptions): Promise<Eval>`
- `EvaluateTestSuite = { prompts, providers, writeLatestResults?, author? } & Omit<TestSuiteConfig, 'prompts' | 'providers'>`。`tests`、`defaultTest` はここに載せる
- `EvaluateOptions` (zod スキーマ) の主要キー: `repeat`、`maxConcurrency`、`cache`、`delay`、`timeoutMs`、`maxEvalTimeMs`、`silent`、`showProgressBar`、`progressCallback(completed, total, index, evalStep, metrics)`、`abortSignal`
- 結果取得: `await evalRecord.toEvaluateSummary()` が `EvaluateSummaryV3 { version: 3, timestamp, results: EvaluateResult[], prompts, stats }` を返す。`getResults()`、`toResultsFile()` もある
- `EvaluateResult` の主要フィールド: `testIdx`、`promptIdx`、`testCase`、`provider: { id, label }`、`response`、`error`、`failureReason`、`success`、`score`、`latencyMs`、`gradingResult`、`namedScores`、`cost`、`metadata`、`tokenUsage`
- `GradingResult`: `pass`、`score`、`reason`、`componentResults?: GradingResult[]` (assertion ごとの結果)、`assertion?`
- **`--repeat` の各回は `EvaluateResult` に `repeatIndex` を持たない**。同じ `(provider.label, testIdx)` の行が反復数ぶん並ぶだけなので、Runner は `(label, testCase.description)` でグループ化して行数を run 数として扱う。反復回の識別は出現順で `run_idx` を振る

### 1.3 `anthropic:claude-agent-sdk` provider

- 設定キー: `working_dir`、`model`、`permission_mode` (`default` / `plan` / `acceptEdits` / `bypassPermissions` / `dontAsk` / `auto`)、`tools`、`allow_all_tools`、`append_allowed_tools`、`disallowed_tools`、`skills` (string[] または `'all'`)、`setting_sources` (`'user'` / `'project'` / `'local'`)、`plugins`、`env`、`max_thinking_tokens`、`max_budget_usd`、`session_id`、`path_to_claude_code_executable`、`apiKey`
- `skills` を指定すると provider が内部で `Skill` ツールを有効化する (バンドル内で `derivedTools.add("Skill")`)。`setting_sources: ['project']` で `working_dir/.claude/skills/<name>/SKILL.md` を探索する
- レスポンス: `output`、`tokenUsage`、`cost` (`total_cost_usd`)、`sessionId`、`metadata.skillCalls` (Skill ツール呼び出しを正規化)、`metadata.toolCalls`、`metadata.numTurns`、`metadata.durationMs`、`metadata.assistantErrors`
- **Claude Code のバージョンはレスポンスに含まれない**。skilldrift 側で `claude --version` を実行して結果に記録する
- Node 22.22 以上が必須 (現環境は 25 で問題無し)

### 1.4 `openai:codex-sdk` provider

- 設定キー: `apiKey`、`model`、`working_dir`、`sandbox_mode` (`read-only` / `workspace-write` / `danger-full-access`)、`skip_git_repo_check`、`additional_directories`、`enable_streaming`、`model_reasoning_effort`、`network_access_enabled`、`web_search_enabled`、`cli_env` (例: `CODEX_HOME`)、`inherit_process_env`、`cli_config`、`codex_path_override`、`persist_threads`、`thread_id`
- 発火判定は **heuristic**: 成功したシェルコマンドが `.agents/skills/<name>/SKILL.md` を参照していれば `skillCalls` に `{ name, path, source: 'heuristic' }` を積む。設計ノートの「読んだ = 使った」近似は正しい。`enable_streaming: true` は進捗イベントの取得に必要
- 設定ノートに書いた `enable_streaming` は OpenTelemetry span 取得用でもあり、発火判定には進捗イベントが要るので MVP でも true にする

### 1.5 `skill-used` / `not-skill-used` assertion

- 構文: `type: skill-used`、`value: <skill-name>` または `value: { pattern: 'glob', min, max }`。否定形は `type: not-skill-used`
- `metadata.skillCalls` を読む。`is_error: true` の呼び出しは `skill-used` を満たさない
- 対応 provider: Claude Agent SDK、Codex SDK、Codex Security、OpenCode SDK
- assertion 一覧 (バンドル `evaluator-*.js`) に `javascript`、`regex`、`llm-rubric`、`trajectory:tool-used` などが揃っている。`file_exists` は promptfoo に無いので `javascript` assertion (`file://` 形式) で `fs.existsSync(path.join(working_dir, p))` を書く

### 1.6 `evals.json` (skill-creator 形式) の実体

3 Skill の共通構造:

```json
{
  "skill_name": "...",
  "evals": [
    {
      "id": 1,
      "name": "任意 (estimate-story-point のみ)",
      "prompt": "...",
      "expected_output": "自由記述",
      "files": ["evals/files/xxx.md"],
      "assertions": ["自由記述 ..."],      // estimate-story-point
      "expectations": ["自由記述 ..."]     // markdown-backlog-converter
    }
  ]
}
```

- `expected_output`、`assertions[]`、`expectations[]` はすべて自由記述 → 中立形式では `llm_rubric` に変換する。決定的 assertion に落とせるのは `expectations` の「Creates /tmp/xxx」パターン程度で、正規表現で `file_exists` に変換を試み、失敗したら `llm_rubric` にする
- `files[]` は Skill ディレクトリ相対パス。fixture の作業ディレクトリに同じ相対パスでコピーする
- 発火系 (`trigger` / `no-trigger`) のケースは 3 Skill とも持たない。`evals.json` 由来のケースはすべて `quality` タグとし、発火判定は `skill_used` を補助 assertion として自動付与する (`evals.json` のケースは全て「発火すべき」依頼であるため)
- 3 Skill とも `evals.json` 由来だけでは CI ゲート対象の決定的 assertion がほぼ無い。設計ノートの懸念どおり

## 2. 設計からの変更点

| 項目 | 設計ノート | 変更 | 理由 |
| --- | --- | --- | --- |
| Runner の実行方式 | `promptfoo eval -c ... --repeat k -o results.json` を subprocess で | ライブラリ `evaluate()` を直接呼び、`toEvaluateSummary()` で受け取る | 設計ノート「実装計画」の方針どおり。CLI 経由だと `promptfoo` の DB 書き込みと YAML 変換が挟まり、型も失う |
| run の識別 | `--repeat` の各回が別レコードであることを確認 | 別レコードになるが `repeatIndex` は無い。出現順で `run_idx` を振る | 1.2 参照 |
| `file_exists` assertion | `javascript` assertion で存在確認 | 同じ。`file://assets/file_exists.js` を skilldrift が生成して fixture に置く | promptfoo に file 系 assertion が無い |
| `claudeVersion` の記録 | provider の結果から取る想定 | `claude --version` を skilldrift が実行して記録 | 1.3 参照 |
| 対象 Skill 数 | 16 | 20 (`skill-creator` は除外) | 手元の増加 |

## 3. リポジトリ構成 (TypeScript、ESM)

```
~/dev/skilldrift/
  package.json            # name: skilldrift, type: module, bin: skilldrift
  tsconfig.json           # target ES2022, module NodeNext, strict
  src/
    cli.ts                # commander: compare / init / trend / cases export
    config/
      suite.ts            # suite.yaml の読み込みと既定値、引数解決 (CLI → suite → 既定 → 対話)
      defaults.ts
    cases/
      types.ts            # 中立形式 Case / Assertion 型
      load.ts             # 解決順序: cases.yaml → evals.json → generated
      fromEvalsJson.ts    # skill-creator 形式 → 中立形式
      hash.ts             # cases-hash, skill-hash
    planner/
      plan.ts             # (skill, case, model, runs) 一覧、キャッシュ鍵判定、コスト見積り
      fixture.ts          # fixtures/<skill>/ 生成 (.claude/skills と .agents/skills へコピー、files コピー、assets)
    runner/
      promptfoo.ts        # 中立形式 → EvaluateTestSuite 変換、evaluate() 実行、RunResult 正規化
      types.ts            # RunResult
      version.ts          # claude --version / codex --version
    comparator/
      beta.ts             # Beta 事後分布と P(p_new < p_old) の計算
      verdict.ts          # ケース単位 / 発火 precision・recall / Skill 単位の判定
    store/
      store.ts            # results.jsonl / verdicts.jsonl 追記、raw 保存、キャッシュ照会
    reporter/
      markdown.ts
      json.ts
      exitCode.ts
  assets/
    file_exists.js        # promptfoo javascript assertion (fixture へコピー)
  test/                   # vitest。comparator と fromEvalsJson を中心に
  README.md, LICENSE (MIT), implementation_plan.md (本ファイル)
```

依存: `promptfoo`、`commander`、`yaml`、`zod`、開発用に `typescript`、`tsx`、`vitest`。パッケージ管理は pnpm (`pnpm-lock.yaml` をコミット、`.npmrc` の `engine-strict=true` で Node 22.22 未満を拒否、ビルドスクリプトの許可は `pnpm-workspace.yaml` の `allowBuilds` で管理)。

## 4. 実装順序

| 順 | 内容 | 完了条件 |
| --- | --- | --- |
| 1 | scaffold (package.json、tsconfig、cli 骨格、`--dry-run`) | `skilldrift compare --dry-run` が Skill 一覧と解決後のケース数 (出所) を表示する |
| 2 | 中立形式の型と `evals.json` 変換 | 3 Skill の `evals.json` を読んで中立形式 YAML を出力できる。単体テストあり |
| 3 | fixture 生成 | `fixtures/<skill>/.claude/skills/<skill>/SKILL.md`、`.agents/skills/<skill>/SKILL.md`、`evals/files/*`、`assets/file_exists.js` が生成される |
| 4 | Runner (promptfoo 変換 + `evaluate()` + 正規化) | 1 Skill 1 ケース 1 run を実機で回し `RunResult` が得られる。`skillCalls` から `triggered` を取れる |
| 5 | Comparator (Beta 比較、判定表) | 単体テスト: 5/5 vs 2/5 で REGRESSED、5/5 vs 5/5 で UNCHANGED、5/5 vs 4/5 で AMBIGUOUS |
| 6 | Store と旧モデルキャッシュ | 同じ鍵で 2 回目は旧モデルを実行しない |
| 7 | Reporter (Markdown / JSON / 終了コード) | 設計ノートの JSON スキーマどおりに出力 |
| 8 | MVP 受け入れ | 同一モデル同士の比較が UNCHANGED になる。SKILL.md を意図的に壊した比較が REGRESSED になる |

順 1 から 3 と 5 は API を呼ばずに進められる。順 4 以降の実機確認は Claude Code のログイン (プラン使用量) を消費する。

## 5. promptfoo への変換仕様 (Runner)

中立形式 → `EvaluateTestSuite`:

```ts
{
  prompts: ['{{prompt}}'],
  providers: [
    { id: 'anthropic:claude-agent-sdk', label: 'claude/<old-model>', config: { model, working_dir, setting_sources: ['project'], skills: [skill], permission_mode: 'acceptEdits' } },
    { id: 'anthropic:claude-agent-sdk', label: 'claude/<new-model>', config: { ... } },
  ],
  defaultTest: { options: { provider: '<judge_model>' } },
  tests: cases.map(c => ({
    description: c.name,
    vars: { prompt: c.prompt },
    metadata: { tags: c.tags },
    assert: c.assertions.map(toPromptfooAssertion),
  })),
}
// options: { repeat: runs, cache: false, maxConcurrency, silent: true, progressCallback }
```

assertion 対応:

| 中立形式 | promptfoo |
| --- | --- |
| `skill_used` | `{ type: 'skill-used', value: skill }` |
| `skill_not_used` | `{ type: 'not-skill-used', value: skill }` |
| `regex` | `{ type: 'regex', value: pattern }` |
| `contains` | `{ type: 'icontains', value }` |
| `file_exists` | `{ type: 'javascript', value: 'file://assets/file_exists.js', config: { path } }` |
| `llm_rubric` | `{ type: 'llm-rubric', value: rubric }` (judge は `defaultTest.options.provider` で固定) |

`RunResult` への正規化:

- `agent` / `model` は `provider.label` を `/` で分割
- `case` は `testCase.description`
- `passed` は `success`、`score` は `score`
- `triggered` は `response.metadata.skillCalls` に `is_error` でない該当 Skill があるか
- `judge_dependent` は `gradingResult.componentResults[].assertion.type` に `llm-rubric` が含まれるか
- `error` は `error` または `failureReason !== 0`。エラー run は判定から除外し `errors` に計上
- `cost_usd` は `cost`、`claude_version` は別途取得した値

## 6. 未解決 / 次に確認すること

- `evaluate()` はローカル DB (drizzle / sqlite) に書き込む。`writeLatestResults: false` で抑制できるか、あるいは `PROMPTFOO_DISABLE_*` 系の環境変数が要るかは順 4 で確認する
- `permission_mode` の既定値。Skill が Write を使うケース (markdown-backlog-converter) では `acceptEdits` が要る。fixture 内で完結させるため `working_dir` を fixture にし、`/tmp` 出力は fixture 内パスに書き換えるか検討する
- `defaultTest.options.provider` の judge 指定形式 (文字列 `anthropic:messages:claude-haiku-4-5` で通るか)
- Codex 側の Skill 読み取りが `.agents/skills/` で確実に起きるか (フェーズ 2)
- 同一テストの反復行の順序が provider 内で安定しているか (run_idx の一貫性は判定には影響しないが、raw との対応付けに使う)
