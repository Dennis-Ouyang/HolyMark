import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { cjkEmphasis, highlight } from "../src/editor/cjkEmphasis";

/** 解析一段文字，返回所有高亮的内容 */
function highlights(doc: string) {
  const st = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis, highlight] })] });
  const out: string[] = [];
  ensureSyntaxTree(st, st.doc.length, 5000)!.iterate({
    enter: (n) => { if (n.name === "Highlight") out.push(st.sliceDoc(n.from, n.to)); },
  });
  return out;
}

describe("高亮和批注不抢 ==", () => {
  it("两条批注之间的文字不被高亮", () => {
    expect(highlights("甲{==乙==}{>>@我 2026-01-01：一<<}丙丁戊{==己==}{>>@我 2026-01-01：二<<}庚。")).toEqual([]);
  });
  it("批注后面真正的高亮照常识别", () => {
    expect(highlights("甲{==乙==}{>>@我 2026-01-01：一<<}丙丁==戊==己。")).toEqual(["==戊=="]);
  });
  it("普通高亮、紧跟批注之后的高亮", () => {
    expect(highlights("这是==重点==。")).toEqual(["==重点=="]);
    expect(highlights("{==乙==}{>>@我 2026-01-01：一<<}==紧跟==")).toEqual(["==紧跟=="]);
  });
});
