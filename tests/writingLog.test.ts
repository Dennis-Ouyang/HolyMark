import { describe, expect, it } from "vitest";
import { dayKey, emptyLog, lastDays, netOn, record, renameFile } from "../src/lib/writingLog";

describe("写作统计", () => {
  it("打开时定起点，保存时更新终点，净增按天合计", () => {
    let l = emptyLog();
    l = record(l, "2026-11-26", "/a.md", 1000, 1100, true);
    l = record(l, "2026-11-26", "/a.md", 1200, 1320);
    l = record(l, "2026-11-26", "/a.md", 1150, 1260); // 删了一些
    l = record(l, "2026-11-26", "/b.md", 50, 60, true);
    l = record(l, "2026-11-26", "/b.md", 80, 95);
    expect(netOn(l, "2026-11-26", false)).toBe(150 + 30);
    expect(netOn(l, "2026-11-26", true)).toBe(160 + 35);
  });
  it("再次打开不改起点", () => {
    let l = record(emptyLog(), "2026-11-26", "/a.md", 10, 10, true);
    l = record(l, "2026-11-26", "/a.md", 20, 20);
    l = record(l, "2026-11-26", "/a.md", 20, 20, true);
    expect(netOn(l, "2026-11-26", false)).toBe(10);
  });
  it("最近 7 天，没写的天是 0", () => {
    let l = record(emptyLog(), "2026-11-24", "/a.md", 0, 0, true);
    l = record(l, "2026-11-24", "/a.md", 300, 330);
    const d = lastDays(l, new Date(2026, 10, 26), 7, false);
    expect(d.map((x) => x.net)).toEqual([0, 0, 0, 0, 300, 0, 0]);
    expect(d[6].day).toBe("2026-11-26");
  });
  it("只留最近 60 天", () => {
    let l = emptyLog();
    for (let i = 0; i < 70; i++) l = record(l, dayKey(new Date(2026, 0, 1 + i)), "/a.md", i, i);
    expect(Object.keys(l.days).length).toBe(60);
  });
  it("改名后跟着换路径", () => {
    let l = record(emptyLog(), "2026-11-26", "/稿/a.md", 1, 1);
    l = renameFile(l, "/稿", "/正文");
    expect(Object.keys(l.days["2026-11-26"])).toEqual(["/正文/a.md"]);
  });
});
