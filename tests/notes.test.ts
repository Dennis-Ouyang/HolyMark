import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { lineSpans, noteAtomRanges } from "../src/editor/notes";

describe("批注的整体跳过范围", () => {
  const doc = "第一段\n甲{==乙==}{>>@我 2026-01-01：一<<}丙{==丁==}{>>@我 2026-01-01：二<<}戊\n末段";
  const st = EditorState.create({ doc });
  const l2 = st.doc.line(2);
  it("同一行被切成几段可见范围时，合并成一行再扫", () => {
    // 模拟隐藏符号把第 2 行切成三段
    const parts = [{ from: l2.from, to: l2.from + 4 }, { from: l2.from + 10, to: l2.from + 20 }, { from: l2.from + 30, to: l2.to }];
    expect(lineSpans(st, parts)).toEqual([[l2.from, l2.to]]);
    const r = noteAtomRanges(st, parts);
    expect(r.length).toBe(4);
    for (let i = 1; i < r.length; i++) expect(r[i][0]).toBeGreaterThanOrEqual(r[i - 1][1]);
  });
  it("相邻行的范围也合并，不重复", () => {
    const r = noteAtomRanges(st, [{ from: 0, to: 2 }, { from: l2.from, to: l2.to }, { from: l2.to + 1, to: st.doc.length }]);
    expect(r.length).toBe(4);
  });
});
