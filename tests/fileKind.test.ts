import { describe, expect, it } from "vitest";
import { fileKind, splitMid } from "../src/lib/fileKind";

describe("文件类型", () => {
  it("按扩展名分类，不分大小写", () => {
    expect(fileKind("a.PDF")).toBe("pdf");
    expect(fileKind("报告.docx")).toBe("word");
    expect(fileKind("数据.xlsx")).toBe("excel");
    expect(fileKind("答辩.key")).toBe("ppt");
    expect(fileKind("图.JPG")).toBe("image");
    expect(fileKind("references.bib")).toBe("bib");
    expect(fileKind("README")).toBe("other");
  });
});

describe("中间截断（F4）", () => {
  it("保住结尾和扩展名", () => {
    expect(splitMid("2027这就是一页纸_知识点手册_第三次修订_终版.docx")).toEqual(["2027这就是一页纸_知识点手册_", "第三次修订_终版.docx"]);
    expect(splitMid("短名字.md")).toEqual(["短名字", ".md"]);
    expect(splitMid("一二三四五六七八九十甲乙丙丁")).toEqual(["一二三四五六", "七八九十甲乙丙丁"]);
  });
});
