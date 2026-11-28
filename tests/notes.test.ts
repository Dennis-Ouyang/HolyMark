import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Subscript, Superscript } from "@lezer/markdown";
import { cjkEmphasis, highlight } from "../src/editor/cjkEmphasis";
import { lineSpans, noteAtomRanges, notes, resolveNoteRange } from "../src/editor/notes";

const mdState = (doc: string) =>
  EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis, highlight, Superscript, Subscript] }), notes()],
  });

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

describe("批注选区校验与规整（resolveNoteRange）", () => {
  it("禁止给已有批注内部、跨批注或批注源代码加批注", () => {
    const doc = "前文{==原文内容==}{>>@我 2026-11-27：旧批注<<}后文";
    const st = mdState(doc);
    // 选在已有批注原文内部
    const qStart = doc.indexOf("原文");
    expect(resolveNoteRange(st, qStart, qStart + 2).ok).toBe(false);
    // 跨过整条批注
    expect(resolveNoteRange(st, 0, doc.length).ok).toBe(false);
    // 选在批注源代码（body）里
    const bodyStart = doc.indexOf("旧批注");
    expect(resolveNoteRange(st, bodyStart, bodyStart + 3).ok).toBe(false);
    // 选到散落的 CriticMarkup 控制符
    const stray = mdState("这里有 {== 符号");
    expect(resolveNoteRange(stray, 4, 7).ok).toBe(false);
  });

  it("禁止只选中控制字符或 Markdown 格式符号，自动裁掉行首块标记", () => {
    const h = mdState("## 标题文字 {#sec-1}");
    // 选整行标题：自动裁掉 ## 与 {#sec-1}，保留「标题文字」
    const res = resolveNoteRange(h, 0, h.doc.length);
    expect(res.ok).toBe(true);
    if (res.ok) expect(h.sliceDoc(res.from, res.to)).toBe("标题文字");
    // 只选「## 」
    expect(resolveNoteRange(h, 0, 3).ok).toBe(false);
    // 只选 ** 或控制字符
    const b = mdState("普通 **粗体** 文字");
    const sIdx = b.doc.toString().indexOf("**");
    expect(resolveNoteRange(b, sIdx, sIdx + 2).ok).toBe(false);
    // 选「**粗」会自动裁掉开头的 **，保留「粗」
    const trimRes = resolveNoteRange(b, sIdx, sIdx + 3);
    expect(trimRes.ok).toBe(true);
    if (trimRes.ok) expect(b.sliceDoc(trimRes.from, trimRes.to)).toBe("粗");
    // 跨过半个 **（从「普通」选到「粗」）会截断加粗符号，拒绝
    expect(resolveNoteRange(b, 0, sIdx + 3).ok).toBe(false);
    // 含 ASCII 控制字符，拒绝
    const ctrl = mdState("abc\u0007def");
    expect(resolveNoteRange(ctrl, 0, 7).ok).toBe(false);
  });

  it("禁止代码块、属性区、公式块、表格、跨段落、行内代码/公式/链接地址内部", () => {
    const fm = mdState("---\ntitle: 测试\n---\n\n正文内容");
    expect(resolveNoteRange(fm, 4, 12).ok).toBe(false);
    expect(resolveNoteRange(fm, fm.doc.toString().indexOf("正文"), fm.doc.length).ok).toBe(true);

    const code = mdState("```ts\nconst a = 1;\n```");
    expect(resolveNoteRange(code, 6, 15).ok).toBe(false);

    const math = mdState("$$\nx + y = z\n$$");
    expect(resolveNoteRange(math, 3, 10).ok).toBe(false);

    const twoP = mdState("第一段\n\n第二段");
    expect(resolveNoteRange(twoP, 0, twoP.doc.length).ok).toBe(false);

    const inline = mdState("参考 `10.1038/nature12373` 与 $E=mc^2$ 和 [链接](https://example.com) 结尾");
    const s = inline.doc.toString();
    // 行内代码内部拒绝
    expect(resolveNoteRange(inline, s.indexOf("10.1038"), s.indexOf("nature")).ok).toBe(false);
    // 完整选中整段行内代码允许
    expect(resolveNoteRange(inline, s.indexOf("`10.1038"), s.indexOf("12373`") + 6).ok).toBe(true);
    // 行内公式内部拒绝
    expect(resolveNoteRange(inline, s.indexOf("E=mc"), s.indexOf("c^2")).ok).toBe(false);
    // 链接 URL 内部拒绝
    expect(resolveNoteRange(inline, s.indexOf("https://"), s.indexOf("example.com")).ok).toBe(false);
    // 链接可见文字内部允许
    const linkTxt = resolveNoteRange(inline, s.indexOf("链接"), s.indexOf("链接") + 2);
    expect(linkTxt.ok).toBe(true);
  });
});

describe("批注完整性保护（noteIntegrity）", () => {
  it("删空批注原文时自动清掉残余的 {====}{>>…<<}", () => {
    const doc = "前{==原文==}{>>@我 2026-11-27：注<<}后";
    const st = mdState(doc);
    const qf = doc.indexOf("原文");
    const next = st.update({ changes: { from: qf, to: qf + 2, insert: "" } }).state;
    expect(next.doc.toString()).toBe("前后");
  });

  it("跨过批注左边界删除时自动清掉右侧残余 ==}{>>…<<}", () => {
    const doc = "前{==原文==}{>>@我 2026-11-27：注<<}后";
    const st = mdState(doc);
    const next = st.update({ changes: { from: 0, to: doc.indexOf("文"), insert: "" } }).state;
    expect(next.doc.toString()).toBe("文后");
  });

  it("修改批注原文但不删空时保持批注完整", () => {
    const doc = "前{==原文==}{>>@我 2026-11-27：注<<}后";
    const st = mdState(doc);
    const qf = doc.indexOf("原文");
    const next = st.update({ changes: { from: qf, to: qf + 2, insert: "新词" } }).state;
    expect(next.doc.toString()).toBe("前{==新词==}{>>@我 2026-11-27：注<<}后");
  });
});
