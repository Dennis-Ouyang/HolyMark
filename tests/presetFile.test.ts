import { describe, expect, it } from "vitest";
import { freeName, freePresetName, packPreset, parsePreset, safeName } from "../src/lib/presetFile";
import { DEFAULT_OPTS, type ExportOptions } from "../src/lib/exporting";

describe("导出预设文件（N16）", () => {
  const opts = { ...DEFAULT_OPTS, size: "12", ref: "/稿/.holymark/export/学校模板.docx", csl: "/稿/gb-t-7714.csl" } as ExportOptions;
  it("写出去再读回来：内嵌文件、路径清掉", () => {
    const text = packPreset("学位论文（学院版）", opts, { ref: { name: "学校模板.docx", data: "UEsDBA==" }, csl: { name: "gb-t-7714.csl", data: "PHN0eWxlLz4=" } });
    const p = parsePreset(text);
    if (typeof p === "string") throw new Error(p);
    expect(p.name).toBe("学位论文（学院版）");
    expect(p.opts.size).toBe("12");
    expect(p.opts.ref).toBe("");
    expect(p.files.ref).toEqual({ name: "学校模板.docx", data: "UEsDBA==" });
    expect(p.files.csl?.name).toBe("gb-t-7714.csl");
  });
  it("没内嵌的路径照原样留着", () => {
    const p = parsePreset(packPreset("x", opts, {}));
    expect(typeof p !== "string" && p.opts.csl).toBe("/稿/gb-t-7714.csl");
  });
  it("不是预设文件、版本太新、内嵌文件类型不对", () => {
    expect(parsePreset("{")).toBe("这不是 HolyMark 的导出预设文件");
    expect(parsePreset('{"a":1}')).toBe("这不是 HolyMark 的导出预设文件");
    expect(parsePreset('{"format":"holymark-export-preset","version":9,"opts":{}}')).toMatch(/更新/);
    const p = parsePreset('{"format":"holymark-export-preset","opts":{},"files":{"ref":{"name":"a.exe","data":"AA=="}}}');
    expect(typeof p !== "string" && p.files.ref).toBeUndefined();
  });
  it("文件名去掉路径；重名改名", () => {
    expect(safeName("../../etc/passwd.csl")).toBe("passwd.csl");
    expect(safeName("C:\\x\\模板.docx")).toBe("模板.docx");
    expect(freeName("模板.docx", (n) => n === "模板.docx" || n === "模板 2.docx")).toBe("模板 3.docx");
    expect(freePresetName("论文", ["论文"])).toBe("论文 2");
  });
});
