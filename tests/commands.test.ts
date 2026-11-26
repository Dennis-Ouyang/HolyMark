import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { activeStyles, indentList, toggleStyle } from "../src/editor/commands";
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

describe("indentList：子列表", () => {
  const run = (doc: string, at: string, dir: 1 | -1) => {
    let state = mk(doc);
    const pos = doc.indexOf(at);
    state = state.update({ selection: { anchor: pos } }).state;
    const v = { get state() { return state; }, dispatch: (spec: any) => { state = state.update(spec).state; } };
    const handled = indentList(v as any, dir);
    return { handled, text: state.doc.toString() };
  };
  it("Tab 变成上一项的子项，缩进对齐到上一项的文字", () => {
    expect(run("- 甲\n- 乙", "乙", 1).text).toBe("- 甲\n  - 乙");
    expect(run("1. 甲\n2. 乙", "乙", 1).text).toBe("1. 甲\n   1. 乙");
    expect(run("- [ ] 甲\n- [x] 乙", "乙", 1).text).toBe("- [ ] 甲\n  - [x] 乙");
  });
  it("有序子项接着已有的子项编号", () => {
    expect(run("1. 甲\n   1. 子一\n2. 乙", "乙", 1).text).toBe("1. 甲\n   1. 子一\n   2. 乙");
  });
  it("⇧Tab 回到上一级，有序列表接着上一级编号", () => {
    expect(run("- 甲\n  - 乙", "乙", -1).text).toBe("- 甲\n- 乙");
    expect(run("1. 甲\n   1. 乙", "乙", -1).text).toBe("1. 甲\n2. 乙");
  });
  it("第一项不能缩进，但吃掉 Tab；不在列表里交给普通 Tab", () => {
    expect(run("- 甲\n- 乙", "甲", 1)).toEqual({ handled: true, text: "- 甲\n- 乙" });
    expect(run("正文", "正", 1).handled).toBe(false);
  });
});

describe("高亮、上下标、标题级别", async () => {
  const { highlight } = await import("../src/editor/cjkEmphasis");
  const { Superscript, Subscript } = await import("@lezer/markdown");
  const { ensureSyntaxTree } = await import("@codemirror/language");
  const { shiftHeading } = await import("../src/editor/commands");
  const names = (doc: string) => {
    const st = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis, highlight, Superscript, Subscript] })] });
    const out: string[] = [];
    ensureSyntaxTree(st, doc.length, 5000)!.iterate({ enter: (n) => { if (["Highlight", "Superscript", "Subscript", "Strikethrough"].includes(n.name)) out.push(`${n.name}:${doc.slice(n.from, n.to)}`); } });
    return out;
  };
  it("识别 ==高亮==、^上标^、~下标~，和 ~~删除线~~ 共存", () => {
    expect(names("甲==重点==乙 H~2~O x^2^ ~~删~~")).toEqual(["Highlight:==重点==", "Subscript:~2~", "Superscript:^2^", "Strikethrough:~~删~~"]);
  });
  it("批注 {==原文==} 里的 == 不算高亮", () => {
    expect(names("看{==这句==}{>>改一下<<}")).toEqual([]);
  });
  it("⌘= 提升、⌘- 降低标题级别，正文和标题 6 之间互转", () => {
    const step = (doc: string, dir: 1 | -1) => { let st = EditorState.create({ doc }); shiftHeading({ get state() { return st; }, dispatch: (s: any) => { st = st.update(s).state; } } as any, dir); return st.doc.toString(); };
    expect(step("## 标题", -1)).toBe("# 标题");
    expect(step("## 标题", 1)).toBe("### 标题");
    expect(step("正文", -1)).toBe("###### 正文");
    expect(step("###### 标题", 1)).toBe("标题");
    expect(step("# 标题", -1)).toBe("# 标题");
  });
});

describe("blockInsertSpec：图片自成一段", async () => {
  const { blockInsertSpec } = await import("../src/editor/commands");
  const apply = (doc: string, at: string, text = "![图](a.png)") => {
    const pos = at === "" ? doc.length : doc.indexOf(at);
    const r = blockInsertSpec(doc, pos, text);
    const out = doc.slice(0, r.from) + r.insert + doc.slice(r.from);
    return { out, cursorAt: out.slice(r.cursor, r.cursor + 3) };
  };
  it("在一段文字下面只换了一行：补出空行，不并进上一段", () => {
    expect(apply("第一段\n", "").out).toBe("第一段\n\n![图](a.png)\n\n");
  });
  it("插在一段话中间：前后都断开，光标落在后半段开头", () => {
    expect(apply("前半句后半句", "后半句")).toEqual({ out: "前半句\n\n![图](a.png)\n\n后半句", cursorAt: "后半句" });
  });
  it("前后已经有空行：不多加", () => {
    expect(apply("甲\n\n\n\n乙", "\n\n乙").out).toBe("甲\n\n![图](a.png)\n\n乙");
  });
  it("空文档", () => {
    expect(apply("", "").out).toBe("![图](a.png)\n\n");
  });
});

describe("批注：找到光标所在的批注", async () => {
  const { noteAt, parseBody } = await import("../src/editor/notes");
  const doc = "前文{==这一句==}{>>@王老师 2026-11-26：要改<<}后文";
  const st = EditorState.create({ doc });
  it("光标在原文里（含两端）才算", () => {
    const q = doc.indexOf("这一句");
    expect(noteAt(st, q + 1)).toMatchObject({ quote: "这一句", who: "王老师", date: "2026-11-26", text: "要改" });
    expect(noteAt(st, q + 3)?.quote).toBe("这一句");
    expect(noteAt(st, 1)).toBeNull();
    expect(noteAt(st, doc.indexOf("要改"))).toBeNull();
    const n = noteAt(st, q + 1)!;
    expect(doc.slice(n.bodyFrom, n.bodyTo)).toBe("@王老师 2026-11-26：要改");
  });
  it("内容前缀 @作者 日期：", () => {
    expect(parseBody("@我 2026-11-26：")).toEqual({ who: "我", date: "2026-11-26", text: "", prefix: "@我 2026-11-26：".length });
    expect(parseBody("没有署名的批注").text).toBe("没有署名的批注");
  });
});
