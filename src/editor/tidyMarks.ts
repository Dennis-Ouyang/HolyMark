/**
 * 排版整理找到的重复字词（的的、了了……）：在正文里标一条波浪线，只让人看，不改。
 * 改到这几个字时那一处标记就去掉；换文件时整个编辑器状态重建，标记也就没了。
 */
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

export const setTidyMarks = StateEffect.define<{ from: number; to: number }[]>();
const mark = Decoration.mark({ class: "hm-repeat", attributes: { title: "这里有重复的字词，是不是多打了？" } });

export const tidyMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    if (tr.docChanged) {
      const touched: [number, number][] = [];
      tr.changes.iterChangedRanges((a, b) => touched.push([a, b]));
      v = v.map(tr.changes).update({ filter: (f, t) => !touched.some(([a, b]) => f <= b && t >= a) });
    }
    for (const e of tr.effects) if (e.is(setTidyMarks)) v = Decoration.set(e.value.filter((r) => r.to <= tr.state.doc.length).map((r) => mark.range(r.from, r.to)), true);
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});
