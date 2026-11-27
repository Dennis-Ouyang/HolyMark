import { describe, expect, it } from "vitest";
import { markdownToRichHtml, RichOptions } from "../src/lib/richCopy";

const opts = (target: "word" | "wechat"): RichOptions => ({ target, citeLabel: (k) => (k === "zhang2021" ? "张伟, 2021" : "@" + k), math: (t, d) => `<math data-d="${d}">${t}</math>` });

describe("复制为带格式的文字", () => {
  it("标题、强调、链接带内联样式", () => {
    const h = markdownToRichHtml("## 3.2　样本 {#s}\n\n这是**重点**和[链接](https://a.com)。", opts("word"));
    expect(h).toMatch(/<h2 style="[^"]+">3\.2　样本<\/h2>/);
    expect(h).toContain("<strong>重点</strong>");
    expect(h).toMatch(/<a href="https:\/\/a.com" style="[^"]+">链接<\/a>/);
    expect(h).not.toContain("{#s}");
  });
  it("属性区去掉，批注只留原文，引用写成作者年份", () => {
    const h = markdownToRichHtml("---\ntitle: x\n---\n# 题\n\n{==原文==}{>>@我 2026-11-25：改<<}见[@zhang2021]。", opts("word"));
    expect(h).not.toContain("title: x");
    expect(h).toContain("原文见（张伟, 2021）。");
    expect(h).not.toContain("{>>");
  });
  it("Word：公式用 MathML，下划线不被当成强调", () => {
    const h = markdownToRichHtml("设 $L_{ext}$ 为负荷：\n\n$$\na_i = b_i\n$$\n", opts("word"));
    expect(h).toContain('<math data-d="false">L_{ext}</math>');
    expect(h).toContain('<math data-d="true">a_i = b_i</math>');
    expect(h).not.toContain("<em>");
  });
  it("公众号：公式先放占位，代码块空格和换行写死、带底色", () => {
    const h = markdownToRichHtml("$x^2$\n\n```py\na = 1\n  b\n```", opts("wechat"));
    expect(h).toContain('<img data-tex="x^2" data-display="0"');
    expect(h).toMatch(/<pre style="[^"]*background:#f6f8fa[^"]*"><code>a&nbsp;=&nbsp;1<br>&nbsp;&nbsp;b<\/code><\/pre>/);
  });
  it("代码块里的 $ 不是公式", () => {
    const h = markdownToRichHtml("```\necho $HOME $PATH\n```", opts("word"));
    expect(h).toContain("echo $HOME $PATH");
  });
  it("表格、单独成段的图片带图注、待办", () => {
    const h = markdownToRichHtml("| a | b |\n| --- | ---: |\n| 1 | 2 |\n\n![图 1](x.png){width=50%}\n\n- [x] 完成\n- [ ] 未完成", { ...opts("word"), resolveImage: (s) => "/abs/" + s });
    expect(h).toMatch(/<td style="[^"]*text-align:right;">2<\/td>/);
    expect(h).toContain('<img src="/abs/x.png" alt="图 1"');
    expect(h).toMatch(/<p style="[^"]+">图 1<\/p>/);
    expect(h).toContain("☑ 完成");
    expect(h).toContain("☐ 未完成");
  });
});
