import { describe, expect, it } from "vitest";
import {
  citedKeys, citesToText, cloneOpts, defaultsYaml, docxStyle, EMPTY, fmField, markdownOut, normalizeOpts, notesToComments,
  numberHeadings, prepareAssets, prepareForPandoc, splitArgs, splitFrontMatter, typstHF, typstTemplate,
} from "../src/lib/exporting";
import type { BibEntry } from "../src/lib/bib";

const opts = () => cloneOpts(EMPTY);

describe("front matter", () => {
  it("splits and reads fields", () => {
    const md = "---\ntitle: 研究设计\nbibliography: ../资料/a.bib\ntags:\n  - x\n  - 'y'\n---\n# 正文\n";
    const { fm, body } = splitFrontMatter(md);
    expect(body).toBe("# 正文\n");
    expect(fmField(fm, "title")).toEqual(["研究设计"]);
    expect(fmField(fm, "bibliography")).toEqual(["../资料/a.bib"]);
    expect(fmField(fm, "tags")).toEqual(["x", "y"]);
    expect(splitFrontMatter("# 没有属性区").fm).toBe("");
  });
});

describe("numberHeadings", () => {
  it("renumbers with Chinese and arabic formats, replacing old numbers", () => {
    const o = opts();
    o.H[1].num = "第{一}章";
    o.H[2].num = "{1}.{2}";
    const out = numberHeadings("# 第三章　研究设计\n\n## 3.1　研究问题\n\n```\n# 代码里的井号\n```\n\n## 样本\n\n# 结论\n\n## 小结", o.H);
    expect(out).toBe("# 第一章　研究设计\n\n## 1.1　研究问题\n\n```\n# 代码里的井号\n```\n\n## 1.2　样本\n\n# 第二章　结论\n\n## 2.1　小结");
  });
  it("leaves headings alone when no format is set", () => {
    expect(numberHeadings("# 第三章 研究", opts().H)).toBe("# 第三章 研究");
  });
});

describe("notes", () => {
  it("become Word comments", () => {
    const s = notesToComments("有 {==24 名==}{>>@王老师 2026-11-18：说清楚[来源]。<<}受访者");
    expect(s).toBe('有 [说清楚\\[来源\\]。]{.comment-start id="0" author="王老师" date="2026-11-18T00:00:00Z"}24 名[]{.comment-end id="0"}受访者');
  });
  it("are dropped for PDF", () => {
    const o = opts(); o.fmt = "pdf";
    expect(prepareForPandoc("a {==b==}{>>@x 1：c<<} d", o, "/doc").markdown).toBe("a b d");
  });
});

describe("assets", () => {
  it("makes image paths absolute and turns mermaid into images", () => {
    const r = prepareAssets("![图 1](assets/%E5%9B%BE.png)\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n![x](https://a/b.png)", "/文稿/正文");
    expect(r.body).toBe("![图 1](</文稿/正文/assets/图.png>)\n\n![](hm-asset:mermaid-1.png)\n\n![x](<https://a/b.png>)");
    expect(r.mermaid).toEqual(["flowchart LR\n  A --> B"]);
  });
  it("Windows 路径：盘符保留，反斜杠统一成正斜杠", () => {
    expect(prepareAssets("![a](../图/a.png)", "C:/稿子/正文").body).toBe("![a](<C:/稿子/图/a.png>)");
    expect(prepareAssets("![a](D:\\图\\a.png)", "C:/稿子").body).toBe("![a](<D:/图/a.png>)");
  });
  it("交给 Pandoc 时本地图片加 hm-file: 标记，网络图片和图表不加", () => {
    const r = prepareAssets("![a](a.png)\n\n![x](https://a/b.png)\n\n```mermaid\nA\n```", "/文稿", true);
    expect(r.body).toBe("![a](<hm-file:/文稿/a.png>)\n\n![x](<https://a/b.png>)\n\n![](hm-asset:mermaid-1.png)");
  });
  it("resolves front matter bibliography against the document", () => {
    const p = prepareForPandoc("---\ntitle: T\nbibliography: ../资料/r.bib\n---\n正文", opts(), "/x/正文");
    expect(p.bibliography).toEqual(["/x/资料/r.bib"]);
    expect(p.title).toBe("T");
  });
});

describe("citations", () => {
  const bib = new Map<string, BibEntry>([["zhang2021", { key: "zhang2021", author: "张伟 and 王敏", year: "2021", title: "t" }], ["s", { key: "s", author: "Sweller, John", year: "1988", title: "" }]]);
  it("converts to text for Markdown export", () => {
    expect(citesToText("如[@zhang2021; @s]所述，[@nope]", bib)).toBe("如（张伟，2021；Sweller，1988）所述，[@nope]");
    expect(citedKeys("[@a] [@b; @a]")).toEqual(["a", "b"]);
  });
  it("markdown export options", () => {
    const o = opts(); o.mdFm = "drop"; o.mdNotes = "drop"; o.mdCite = "text";
    expect(markdownOut("---\na: 1\n---\n{==x==}{>>@m 1：n<<}[@s]\n```\n[@s]\n```", o, bib)).toBe("x（Sweller，1988）\n```\n[@s]\n```");
  });
});

describe("docx style", () => {
  it("converts UI units to Word units and leaves empty fields alone", () => {
    const o = opts();
    o.paper = "A4"; o.mt = "2.5"; o.cjk = "宋体"; o.size = "10.5"; o.ls = "1.5"; o.indent = "2"; o.align = "justify";
    o.H[1].font = "黑体"; o.H[1].size = "16"; o.H[1].bold = "1"; o.H[1].align = "center"; o.H[1].color = "black";
    o.footer = "{页码}";
    const s = docxStyle(o, "标题");
    expect(s.page).toEqual([11906, 16838]);
    expect(s.margins).toEqual([1417, null, null, null]);
    expect(s.size).toBe(21);
    expect(s.line).toEqual([360, "auto"]);
    expect(s.indentChars).toBe(200);
    expect(s.align).toBe("both");
    expect(s.latin).toBeNull();
    expect(s.headings[0]).toEqual({ level: 1, latin: "黑体", cjk: "黑体", size: 32, bold: true, align: "center", before: null, after: null, black: true });
    expect(s.headings[1]).toMatchObject({ latin: null, cjk: "宋体", size: null, bold: null });
    expect(s.footer).toEqual({ text: "{页码}", align: "center" });
    expect(s.header).toBeNull();
  });
});

describe("typst", () => {
  it("escapes header text and inserts page counters", () => {
    expect(typstHF("第 {页码} 页 #1 [a]", "研究")).toBe("第 #counter(page).display() 页 \\#1 \\[a\\]");
  });
  it("builds a template from options", () => {
    const o = opts(); o.fmt = "pdf"; o.cjk = "Kaiti SC"; o.footer = "{页码} / {总页数}"; o.H[1].align = "center";
    const t = typstTemplate(o, "T");
    // 楷体-简后面带上 Windows 的楷体，同一份模板在两个系统上都能排出楷体
    expect(t).toContain('#set text(font: ("Times New Roman", "Kaiti SC", "KaiTi", "STKaiti"), size: 12pt');
    expect(t).toContain("footer: context [#set text(size: 9pt); #align(center)[#counter(page).display() \\/ #counter(page).final().first()]]");
    expect(t).toContain("#show heading.where(level: 1): set align(center)");
    expect(t).toContain("$body$");
  });
});

describe("defaults file", () => {
  it("is a usable pandoc defaults file", () => {
    const o = opts(); o.csl = "/x/gb.csl";
    const y = defaultsYaml(o, { bibliography: ["/x/a.bib", "/x/a.bib"], docDir: "/x/正文" });
    expect(y).toContain("reference-doc: ${.}/word-reference.docx");
    expect(y).toContain('bibliography:\n  - "/x/a.bib"\ncsl: "/x/gb.csl"');
    expect(y.match(/a\.bib/g)).toHaveLength(1);
    o.fmt = "pdf";
    expect(defaultsYaml(o, { bibliography: [], docDir: "/x" })).toContain("pdf-engine: typst");
  });
  it("splits extra args and normalizes old options", () => {
    expect(splitArgs('--toc --metadata "title=a b"')).toEqual(["--toc", "--metadata", "title=a b"]);
    expect(normalizeOpts({ fmt: "pdf", H: { 1: { size: "16" } } } as never).H[2].num).toBe("");
  });
});
