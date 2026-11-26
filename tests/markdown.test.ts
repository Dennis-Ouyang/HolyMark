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

import { changedLines } from "../src/lib/markdown";
import { parseTable, serializeTable } from "../src/editor/tableWidget";

describe("changedLines", () => {
  it("reports added and modified lines in the new text", () => {
    expect(changedLines("甲\n乙\n丙", "甲\n乙改\n丙\n丁")).toEqual([2, 4]);
    expect(changedLines("一样", "一样")).toEqual([]);
  });
});

describe("table model", () => {
  it("round-trips alignment, escaped pipes and ragged rows", () => {
    const m = parseTable("| 名 | 值 |\n| :--- | ---: |\n| a\\|b | 1 |\n| c |");
    expect(m.head).toEqual(["名", "值"]);
    expect(m.align).toEqual([":---", "---:"]);
    expect(m.rows).toEqual([["a\\|b", "1"], ["c", ""]]);
    expect(serializeTable(m)).toBe("| 名 | 值 |\n| :--- | ---: |\n| a\\|b | 1 |\n| c |   |");
  });
});

describe("wordCounter", () => {
  it("按块增量计数，结果与整篇计数一致", async () => {
    const { wordCounter } = await import("../src/lib/markdown");
    const { longManuscript } = await import("../src/lib/stress");
    const count = wordCounter();
    let t = longManuscript(30_000, 5);
    for (const p of [false, true]) expect(count(t, p)).toBe(countWords(plainText(t), p));
    t = t.slice(0, 15_000) + "新增的一段话，共十个字。\n\n" + t.slice(15_000);
    expect(count(t, false)).toBe(countWords(plainText(t), false));
    expect(count("---\ntitle: 不算\n---\n正文四字", false)).toBe(4);
  });
});

describe("表格列宽", async () => {
  const { columnWidths, setColumnWidths } = await import("../src/editor/tableWidget");
  it("短横线一样长是自动列宽；写进比例后能读回来，保留对齐冒号", () => {
    const m = parseTable("| 名 | 值 |\n| :--- | ---: |\n| a | 1 |");
    expect(columnWidths(m)).toBeNull();
    setColumnWidths(m, [70, 30]);
    expect(m.align).toEqual([":" + "-".repeat(70), "-".repeat(30) + ":"]);
    expect(columnWidths(m)!.map(Math.round)).toEqual([70, 30]);
    expect(serializeTable(m).split("\n")[1].length).toBeGreaterThan(72); // 超过 72 个字符，Pandoc 才按比例排
    setColumnWidths(m, null);
    expect(m.align).toEqual([":---", "---:"]);
  });
});

describe("图片宽度", async () => {
  const { setImageWidth, imageWidth } = await import("../src/editor/livePreview");
  it("写进、改掉、去掉 {width=…}，保留别的属性", () => {
    expect(setImageWidth("![图 1](a.png)", "60%")).toBe("![图 1](a.png){width=60%}");
    expect(setImageWidth("![图 1](a.png){width=60%}", "25%")).toBe("![图 1](a.png){width=25%}");
    expect(setImageWidth("![图 1](a.png){#fig:a width=60%}", "")).toBe("![图 1](a.png){#fig:a}");
    expect(setImageWidth("![图 1](a.png){width=60%}", "")).toBe("![图 1](a.png)");
    expect(imageWidth("#fig:a width=40%")).toBe("40%");
  });
});

describe("插入文件链接的写法", async () => {
  const { linkFor } = await import("../src/components/InsertFile");
  it("中文直接写，有空格时用尖括号，图片是块级的 ![]()", () => {
    expect(linkFor("/稿/资料/访谈提纲.md", "/稿/正文/03.md")).toEqual({ text: "[访谈提纲](../资料/访谈提纲.md)", block: false });
    expect(linkFor("/稿/正文/02 文献综述.md", "/稿/正文/03.md")).toEqual({ text: "[02 文献综述](<02 文献综述.md>)", block: false });
    expect(linkFor("/稿/正文/assets/框架图.png", "/稿/正文/03.md")).toEqual({ text: "![框架图](assets/框架图.png)", block: true });
  });
});
