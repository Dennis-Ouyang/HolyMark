import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { emptyPairs, trackPair } from "../src/editor/emptyPairs";
import { tabKey, inCodeBlock } from "../src/editor/keys";
import { toggleStyle } from "../src/editor/commands";

/** 足够给命令用的假 view */
function fake(doc: string, at: number) {
  let state = EditorState.create({ doc, selection: EditorSelection.cursor(at), extensions: [markdown({ base: markdownLanguage }), history(), emptyPairs()] });
  const view = { get state() { return state; }, dispatch: (...specs: any[]) => { state = state.update(...specs).state; } };
  return view;
}

describe("B9 空的格式符号对", () => {
  it("没打字就移走光标：删掉 ****", () => {
    const v = fake("甲乙", 1);
    const res = toggleStyle(v.state, 1, 1, "bold", false)!;
    v.dispatch({ changes: res.changes, selection: { anchor: res.anchor }, effects: trackPair.of({ from: 1, mark: "**" }) });
    expect(v.state.doc.toString()).toBe("甲****乙");
    v.dispatch({ selection: { anchor: 0 } });
    expect(v.state.doc.toString()).toBe("甲乙");
  });
  it("打了字就保留", () => {
    const v = fake("甲乙", 1);
    v.dispatch({ changes: { from: 1, insert: "**" + "**" }, selection: { anchor: 3 }, effects: trackPair.of({ from: 1, mark: "**" }) });
    v.dispatch({ changes: { from: 3, insert: "丙" }, selection: { anchor: 4 } });
    v.dispatch({ selection: { anchor: 0 } });
    expect(v.state.doc.toString()).toBe("甲**丙**乙");
  });
  it("先 ⌘B 再 ⌘I（嵌套的空符号对）也一起删掉", () => {
    const v = fake("甲乙", 1);
    v.dispatch({ changes: { from: 1, insert: "****" }, selection: { anchor: 3 }, effects: trackPair.of({ from: 1, mark: "**" }) });
    v.dispatch({ changes: { from: 3, insert: "**" }, selection: { anchor: 4 }, effects: trackPair.of({ from: 3, mark: "*" }) });
    expect(v.state.doc.toString()).toBe("甲******乙");
    v.dispatch({ selection: { anchor: 0 } });
    expect(v.state.doc.toString()).toBe("甲乙");
  });
  it("撤销能回到插入之前", () => {
    const v = fake("甲乙", 1);
    v.dispatch({ changes: { from: 1, insert: "~~~~" }, selection: { anchor: 3 }, effects: trackPair.of({ from: 1, mark: "~~" }) });
    v.dispatch({ selection: { anchor: 6 } });
    expect(v.state.doc.toString()).toBe("甲乙");
    undo(v as never);
    expect(v.state.doc.toString()).not.toContain("~~~~乙~~");
  });
});

describe("B8 Tab", () => {
  it("普通段落里不插空格", () => {
    const v = fake("段落文字", 0);
    expect(tabKey(v as never, 1)).toBe(true);
    expect(v.state.doc.toString()).toBe("段落文字");
  });
  it("列表里调层级、代码块里缩进", () => {
    const v = fake("- 一\n- 二", 5);
    tabKey(v as never, 1);
    expect(v.state.doc.toString()).toBe("- 一\n  - 二");
    const c = fake("```\ncode\n```", 5);
    expect(inCodeBlock(c.state, 5)).toBe(true);
  });
});
