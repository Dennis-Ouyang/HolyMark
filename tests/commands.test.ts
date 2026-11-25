import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { activeStyles, toggleStyle } from "../src/editor/commands";
import { cjkEmphasis } from "../src/editor/cjkEmphasis";

type S = "bold" | "italic" | "strike";
const mk = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis] })] });

/** 在 doc 里选中 [from, to)，按顺序切换格式，每次保持选中同样的字；返回最后的文本和选中的文字 */
function run(doc: string, sel: string, steps: S[], same = true) {
  let state = mk(doc);
  let from = doc.indexOf(sel), to = from + sel.length;
  const trail: string[] = [];
  for (const s of steps) {
    const r = toggleStyle(state, from, to, s, true)!;
    state = state.update({ changes: r.changes, selection: { anchor: r.anchor, head: r.head } }).state;
    from = r.anchor; to = r.head;
    trail.push(state.doc.toString());
    if (same) expect(state.sliceDoc(from, to)).toBe(sel); // 选区始终是原来那些字
  }
  return { text: state.doc.toString(), trail, active: activeStyles(state, from, to) };
}

describe("toggleStyle：连续切换格式", () => {
  it("加粗、斜体、删除线依次叠加，再逐个去掉", () => {
    const r = run("前文 文字 后文", "文字", ["bold", "italic", "strike", "bold", "strike", "italic"]);
    expect(r.trail).toEqual([
      "前文 **文字** 后文",
      "前文 ***文字*** 后文",
      "前文 ~~***文字***~~ 后文",
      "前文 ~~*文字*~~ 后文",
      "前文 *文字* 后文",
      "前文 文字 后文",
    ]);
    expect([...r.active]).toEqual([]);
  });

  it("用户报告的顺序：加粗、斜体、删除线，再加粗体、减删除线、再加斜体", () => {
    const r = run("这是一段测试文字。", "测试", ["bold", "italic", "strike", "bold", "strike", "italic"]);
    // 第 4 步去掉粗体（三种都有时再点粗体是“去掉”），第 6 步去掉斜体：最后什么格式都没有，文字完好
    expect(r.trail[2]).toBe("这是一段~~***测试***~~文字。");
    expect(r.trail[3]).toBe("这是一段~~*测试*~~文字。");
    expect(r.text).toBe("这是一段测试文字。");
  });

  it("每一步的结果都能被解析回同样的格式", () => {
    const seq: S[] = ["strike", "bold", "italic", "strike", "italic", "bold", "italic", "strike"];
    let state = mk("甲乙丙丁戊");
    let from = 1, to = 4;
    const want = new Set<S>();
    for (const s of seq) {
      const r = toggleStyle(state, from, to, s, true)!;
      state = state.update({ changes: r.changes }).state;
      from = r.anchor; to = r.head;
      if (want.has(s)) want.delete(s); else want.add(s);
      expect([...activeStyles(state, from, to)].sort()).toEqual([...want].sort());
      expect(state.sliceDoc(from, to)).toBe("乙丙丁");
    }
  });

  it("只给粗体里的一部分去掉粗体：拆成两段", () => {
    const r = run("**甲乙丙丁**", "乙丙", ["bold"]);
    expect(r.text).toBe("**甲**乙丙**丁**");
  });

  const apply = (doc: string, from: number, to: number, s: S) => {
    const state = mk(doc);
    const r = toggleStyle(state, from, to, s, true)!;
    const next = state.update({ changes: r.changes }).state;
    return { text: next.doc.toString(), sel: next.sliceDoc(r.anchor, r.head) };
  };

  it("选区跨过已有格式的一部分：合并成一段", () => {
    // 选中「甲**乙」（源码里的 0–4），乙已经是粗体
    expect(apply("甲**乙丙**丁", 0, 4, "bold")).toEqual({ text: "**甲乙丙**丁", sel: "甲乙" });
  });

  it("部分有粗体时点粗体：全部加粗", () => {
    expect(apply("甲**乙**丙", 0, 7, "bold")).toEqual({ text: "**甲乙丙**", sel: "甲乙丙" });
  });

  it("首尾的空格留在符号外面", () => {
    const r = run("one two three", " two ", ["bold"], false);
    expect(r.text).toBe("one **two** three");
  });

  it("标题、列表、引用的行首标记不被包进去", () => {
    expect(run("# 标题文字", "# 标题文字", ["bold"], false).text).toBe("# **标题文字**");
    expect(run("- 列表项", "- 列表项", ["italic"], false).text).toBe("- *列表项*");
    const multi = run("> 第一行\n> 第二行", "第一行\n> 第二行", ["strike"], false);
    expect(multi.text).toBe("> ~~第一行~~\n> ~~第二行~~");
  });

  it("链接、行内代码、公式、文献引用、批注作为整体，不被拆开", () => {
    expect(run("看[这个链接](https://a.b)吧", "这个", ["bold"], false).text).toBe("看**[这个链接](https://a.b)**吧");
    expect(run("代码 `a*b` 结束", "`a*b`", ["italic"]).text).toBe("代码 *`a*b`* 结束");
    expect(run("公式 $x^2$ 和 [@zhang2021]", "$x^2$ 和 [@zhang2021]", ["bold"]).text).toBe("公式 **$x^2$ 和 [@zhang2021]**");
  });

  it("光标在粗体里、没有选区时：去掉这段粗体", () => {
    const state = mk("甲**乙丙**丁");
    const r = toggleStyle(state, 4, 4, "bold", true)!;
    const next = state.update({ changes: r.changes }).state;
    expect(next.doc.toString()).toBe("甲乙丙丁");
    expect(r.anchor).toBe(2);
  });

  it("没有选区、也不在格式里：插入一对符号，光标在中间", () => {
    const r = toggleStyle(mk("甲乙"), 1, 1, "strike", true)!;
    expect(r.changes.insert).toBe("~~~~");
    expect(r.anchor).toBe(3);
  });

  it("不保持选区时，光标放到格式符号后面", () => {
    const state = mk("前 文字 后");
    const r = toggleStyle(state, 2, 4, "bold", false)!;
    const next = state.update({ changes: r.changes }).state;
    expect(next.doc.toString()).toBe("前 **文字** 后");
    expect(r.anchor).toBe(8);
    expect(r.head).toBe(8);
  });

  it("activeStyles：光标在格式里也算", () => {
    const state = mk("甲~~***乙***~~丙 `代码`");
    expect([...activeStyles(state, 7, 7)].sort()).toEqual(["bold", "italic", "strike"]);
    expect([...activeStyles(state, 0, 1)]).toEqual([]);
    const c = state.doc.toString().indexOf("代码");
    expect(activeStyles(state, c, c + 2).has("code")).toBe(true);
  });
});
