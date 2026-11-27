import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { classifyLink, headingPos, isLocalHref, linkAt, openLink } from "../src/editor/links";

describe("链接分类", () => {
  const doc = "/w/稿件/正文/03.md";
  it("网页、锚点、相对和绝对路径、file:", () => {
    expect(classifyLink("https://example.com/a", doc)).toEqual({ kind: "web", url: "https://example.com/a" });
    expect(classifyLink("mailto:a@b.c", doc)).toEqual({ kind: "web", url: "mailto:a@b.c" });
    expect(classifyLink("#研究问题", doc)).toEqual({ kind: "anchor", id: "研究问题" });
    expect(classifyLink("../资料/导师意见.md", doc)).toEqual({ kind: "file", abs: "/w/稿件/资料/导师意见.md", md: true });
    expect(classifyLink("<受访者 编码表.xlsx>", doc)).toEqual({ kind: "file", abs: "/w/稿件/正文/受访者 编码表.xlsx", md: false });
    expect(classifyLink("%E8%A1%A8.pdf", doc)).toEqual({ kind: "file", abs: "/w/稿件/正文/表.pdf", md: false });
    expect(classifyLink("C:/资料/a.MARKDOWN", doc)).toEqual({ kind: "file", abs: "C:/资料/a.MARKDOWN", md: true });
    expect(classifyLink("file:///Users/x/a.pdf", doc)).toEqual({ kind: "file", abs: "/Users/x/a.pdf", md: false });
    expect(classifyLink("javascript:alert(1)", doc)).toBeNull();
  });
  it("本机链接判断", () => {
    expect(isLocalHref("a.pdf")).toBe(true);
    expect(isLocalHref("https://x")).toBe(false);
    expect(isLocalHref("#x")).toBe(false);
  });
  it("openLink 分发", () => {
    const got: string[] = [];
    const hooks = { docPath: () => doc, openUrl: (u: string) => got.push("url " + u), openFile: (a: string, md: boolean) => got.push(`file ${a} ${md}`) };
    openLink("https://x.org", hooks); openLink("b.md", hooks);
    expect(got).toEqual(["url https://x.org", "file /w/稿件/正文/b.md true"]);
  });
});

describe("找链接和标题", () => {
  const st = EditorState.create({ doc: "# 研究 问题\n\n看[这里](https://x.org)和 <https://y.org> 还有 [@zhang2021]。", extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(st, st.doc.length, 5000);
  it("光标处的链接地址", () => {
    const t = st.doc.toString();
    expect(linkAt(st, t.indexOf("这里") + 1)?.href).toBe("https://x.org");
    expect(linkAt(st, t.indexOf("y.org"))?.href).toBe("https://y.org");
    expect(linkAt(st, t.indexOf("zhang"))).toBeNull();
  });
  it("锚点找标题", () => {
    expect(headingPos(st, "研究问题")).toBe(0);
    expect(headingPos(st, "没有")).toBeNull();
  });
});

describe("链接指向哪里（阅读模式、跨文件锚点）", () => {
  const doc = "/稿/正文/03.md";
  it("www 开头的补成网页", () => expect(classifyLink("www.a.com", doc)).toEqual({ kind: "web", url: "https://www.a.com" }));
  it("本文锚点：编码过的也认", () => expect(classifyLink("#%E6%A0%B7%E6%9C%AC", doc)).toEqual({ kind: "anchor", id: "样本" }));
  it("另一篇 Markdown，带锚点", () => expect(classifyLink("../资料/导师意见.md#第三章", doc)).toEqual({ kind: "file", abs: "/稿/资料/导师意见.md", md: true, anchor: "第三章" }));
  it("尖括号里有空格的路径", () => expect(classifyLink("<../资料/a b.md>", doc)).toEqual({ kind: "file", abs: "/稿/资料/a b.md", md: true }));
  it("其他文件、Windows 路径；非 Markdown 的 # 不当锚点", () => {
    expect(classifyLink("../资料/表.xlsx", doc)).toEqual({ kind: "file", abs: "/稿/资料/表.xlsx", md: false });
    expect(classifyLink("C:\\a\\b.pdf#page=3", doc)).toEqual({ kind: "file", abs: "C:/a/b.pdf", md: false });
  });
  it("openLink 把锚点交给打开文件的一方", () => {
    const got: string[] = [];
    openLink("../资料/导师意见.md#第三章", { docPath: () => doc, openUrl: () => {}, openFile: (a, md, anchor) => got.push(`${a} ${md} ${anchor}`) });
    expect(got).toEqual(["/稿/资料/导师意见.md true 第三章"]);
  });
});

describe("按 Pandoc 规则找标题", () => {
  const st = EditorState.create({ doc: "# 第一章 绪论\n\n## 3.2 样本与数据 {#sample}\n\n## Results -- Summary\n", extensions: [markdown({ base: markdownLanguage })] });
  it("自动锚点、{#id}、标题原文", () => {
    expect(headingPos(st, "第一章-绪论")).toBe(0);
    expect(headingPos(st, "sample")).toBe(st.doc.toString().indexOf("## 3.2"));
    expect(headingPos(st, "3.2 样本与数据")).toBe(st.doc.toString().indexOf("## 3.2")); // 有人直接写标题原文
    expect(headingPos(st, "results-summary")).toBe(st.doc.toString().indexOf("## Results"));
  });
});
