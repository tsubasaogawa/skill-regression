# 判定と終了コード

| 判定 | 条件 |
| --- | --- |
| REGRESSED | P(p_new < p_old) >= 0.95 のケースがある、または発火 precision / recall が退行 |
| DEGRADED | REGRESSED 無しで、集計合格率の低下が `aggregate_drop_pt` 以上 |
| INCONCLUSIVE | 追加反復を使い切っても P_reg が 0.8〜0.95 に留まる |
| IMPROVED | P_reg <= 0.05 のケースがある |
| UNCHANGED | 上記以外 |

終了コードは 0 = 退行無し、1 = 決定的 assertion または発火判定の REGRESSED あり、2 = DEGRADED / INCONCLUSIVE / 一部未実行、3 = 入力エラー。`llm_rubric` だけに依存する退行は 1 にせずレポートのみ。同じケースに決定的 assertion と `llm_rubric` がある場合も、決定的 assertion の合格率を別に比較して終了コードに反映する。

フラグ: `generated-cases` (生成ケース)、`judge-dependent` (judge 依存)、`partial` (エラー run あり)、`low-power` (反復が少なく新モデルが全滅しても REGRESSED に届かない)。
