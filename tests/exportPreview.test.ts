// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { previewHTML } from "../src/lib/exportPreview";
import { cloneOpts, EMPTY } from "../src/lib/exporting";

const ctx = { docDir: "/d", bib: new Map(), resolveImage: (s: string) => s };
const html = (md: string, fmt: "docx" | "pdf" = "docx") => {
  const o = cloneOpts(EMPTY); o.fmt = fmt; o.notes = "comment";
  return previewHTML(md, o, ctx).html;
};
/** 把输出放进一个游离的 DOM 里检查：不能留下脚本、事件处理器、javascript: 地址 */
function executable(h: string) {
  const d = document.createElement("div");
  d.innerHTML = h;
  const bad: string[] = [];
  d.querySelectorAll("*").forEach((el) => {
    if (/^(script|iframe|object|embed|form|base|meta|link|style)$/i.test(el.tagName)) bad.push(el.tagName);
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name)) bad.push(`${el.tagName}@${a.name}`);
      if (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text)/i.test(a.value)) bad.push(`${el.tagName}@${a.name}=${a.value}`);
    }
  });
  return bad;
}

describe("previewHTML 不执行文稿里的脚本", () => {
  it("去掉 script、onerror、javascript: 链接、iframe", () => {
    const md = [
      "# 标题",
      "",
      '正文 <img src="x" onerror="window.__ran=1"> 继续',
      "",
      "<script>window.__ran=2</script>",
      "",
      '<a href="javascript:alert(1)">点我</a> [链接](javascript:alert(2))',
      "",
      '<iframe src="https://example.com"></iframe>',
      "",
      '<div onmouseover="x()"><svg><foreignObject><img src=x onerror=y()></foreignObject></svg></div>',
      "",
      '{==<img src=x onerror=z()>==}{>>@王老师 2026-01-01：<b onclick="q()">看</b><<}',
    ].join("\n");
    for (const fmt of ["docx", "pdf"] as const) {
      const h = html(md, fmt);
      expect(executable(h)).toEqual([]);
      expect(h).not.toMatch(/<script/i);
      expect(h).not.toMatch(/<[^>]*\son\w+\s*=/i);
    }
  });
  it("保留程序生成的公式、批注、图片、目录和普通格式", () => {
    const h = html("# 一\n\n行内 $x^2$ 和 ==高亮== 与 {==原文==}{>>@我 2026-01-01：批注<<}\n\n$$\n\\sqrt{a}\n$$\n\n![图](a.png){width=50%}\n");
    expect(h).toContain('class="katex"');
    expect(h).toContain("pv-mathb");
    expect(h).toContain('<mark class="pv-anno">原文</mark>');
    expect(h).toContain("<mark>高亮</mark>");
    expect(h).toMatch(/<span class="pv-fig" style="width:50%"><img src="\/d\/a.png"/);
    expect(h).toContain('<p class="pv-figp">');
  });
  it("asset: 和 data: 图片地址保留", () => {
    const o = cloneOpts(EMPTY);
    const h1 = previewHTML("![](a.png)", o, { ...ctx, resolveImage: () => "asset://localhost/%2Fd%2Fa.png" }).html;
    expect(h1).toContain('src="asset://localhost/%2Fd%2Fa.png"');
    const h2 = previewHTML("![](a.png)", o, { ...ctx, resolveImage: () => "data:image/png;base64,AAAA" }).html;
    expect(h2).toContain('src="data:image/png;base64,AAAA"');
  });
  it("批注和高亮不抢 ==（Word 批注、PDF 去掉批注两种）", () => {
    const md = "甲{==乙==}{>>@我 2026-01-01：一<<}丙丁==戊==己。";
    const d = html(md, "docx");
    expect(d).toContain('<mark class="pv-anno">乙</mark>丙丁<mark>戊</mark>己');
    expect(html(md, "pdf")).toContain("甲乙丙丁<mark>戊</mark>己");
    expect(html("甲{==乙==}{>>@我 2026-01-01：一<<}丙丁戊{==己==}{>>@我 2026-01-01：二<<}庚。", "docx")).not.toMatch(/<mark>/);
  });
});
