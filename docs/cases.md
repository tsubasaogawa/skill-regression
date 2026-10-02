# ケース

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

`trigger` / `no-trigger` タグのケースからは発火の precision / recall も算出する。各ケースの発火正誤に加え、precision / recall をそれぞれ Beta 事後分布で比較し、その退行も Skill 判定に反映する。分母が 0 の指標は `n/a` とし、指標自体の比較は行わない。prompt や assertion 内の `/tmp` は実行時に `<fixture>/tmp` へ書き換えられる。
