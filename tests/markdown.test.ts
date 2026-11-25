import { describe, expect, it } from "vitest";
import { alignBlocks, countWords, docLayout, headings, parseNotes, plainText, setDocLayout, splitBlocks } from "../src/lib/markdown";
import { parseBib, shortAuthor } from "../src/lib/bib";

describe("splitBlocks", () => {
  it("is lossless and keeps fenced blocks together", () => {
    const t = "# 标题\n\n第一段\n续\n\n\n```py\na\n\nb\n```\n\n$$\nx\n\ny\n$$\n\n最后";
    const b = splitBlocks(t);
    expect(b.join("")).toBe(t);
    expect(b).toHaveLength(5);
  });
});

describe("countWords", () => {
  it("counts CJK characters and latin words, optionally punctuation", () => {
    expect(countWords("认知负荷 theory of mind，0.82", false)).toBe(4 + 3 + 1);
    expect(countWords("认知负荷，好。", true)).toBe(7);
  });
});

describe("plainText", () => {
  it("drops syntax, code, math and front matter", () => {
    const md = "---\ntitle: x\n---\n# 标题\n\n**粗**和[@k]与$x$\n\n```js\ncode\n```\n\n$$\ny\n$$\n\n{==原文==}{>>@我 2026-11-25：批注<<}";
    const p = plainText(md);
    expect(p).toContain("标题");
    expect(p).toContain("粗和与");
    expect(p).toContain("原文");
    expect(p).not.toMatch(/code|批注|title/);
  });
});

describe("notes", () => {
  it("parses CriticMarkup with author and date", () => {
    const n = parseNotes("甲{==乙==}{>>@王老师 2026-11-18：要改<<}丙");
    expect(n[0]).toMatchObject({ quote: "乙", who: "王老师", date: "2026-11-18", text: "要改", at: 1 });
  });
});

describe("headings", () => {
  it("skips front matter and code fences", () => {
    const h = headings("---\na: b\n---\n# 一\n```\n# 不是\n```\n## 二");
    expect(h.map((x) => x.text)).toEqual(["一", "二"]);
    expect(h[0].pos).toBe(13);
  });
});

describe("doc layout in front matter", () => {
  it("round-trips holymark section", () => {
    const md = "---\ntitle: 研究设计\n---\n# 正文";
    const w = setDocLayout(md, { "heading-font": "思源黑体" });
    expect(docLayout(w)).toEqual({ "heading-font": "思源黑体" });
    expect(w).toContain("title: 研究设计");
    expect(setDocLayout(w, {})).toBe(md);
    expect(setDocLayout("# 无属性", { "font-size": "18" })).toBe("---\nholymark:\n  font-size: 18\n---\n# 无属性");
  });
});

describe("alignBlocks", () => {
  it("pairs modified blocks between unchanged anchors", () => {
    const rows = alignBlocks("甲\n\n乙\n\n丙", "甲\n\n乙改\n\n丙\n\n丁");
    expect(rows.map((r) => [r.left, r.right, r.ops === null])).toEqual([
      ["甲", "甲", true], ["乙", "乙改", false], ["丙", "丙", true], [null, "丁", false],
    ]);
  });
});

describe("bib", () => {
  it("parses keys and short authors", () => {
    const b = parseBib("@article{zhang2021,\n  author = {张伟 and 王敏},\n  year = {2021}\n}\n");
    expect(b[0].key).toBe("zhang2021");
    expect(shortAuthor(b[0].author)).toBe("张伟");
    expect(shortAuthor("Sweller, John")).toBe("Sweller");
  });
});
