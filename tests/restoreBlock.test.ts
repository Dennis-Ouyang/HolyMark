import { describe, expect, it } from "vitest";
import { alignWithRanges, applyFix, blockRanges, removeRow, restoreRow } from "../src/lib/restoreBlock";

describe("只恢复某一段（N19）", () => {
  const old = "# 标题\n\n甲段原文\n\n乙段\n\n丙段\n";
  it("块的区间", () => {
    const t = "甲\n\n乙\n";
    expect(blockRanges(t)).toEqual([{ from: 0, to: 1, next: 3 }, { from: 3, to: 4, next: 5 }]);
  });
  it("改过的段落：换回旧的", () => {
    const now = "# 标题\n\n甲段改过了\n\n乙段\n\n丙段\n";
    const rows = alignWithRanges(old, now);
    const i = rows.findIndex((r) => r.ops && r.left === "甲段原文");
    expect(applyFix(now, restoreRow(now, rows, i)!)).toBe(old);
  });
  it("被删掉的段落：插回原来的位置", () => {
    const now = "# 标题\n\n甲段原文\n\n丙段\n";
    const rows = alignWithRanges(old, now);
    const i = rows.findIndex((r) => r.left === "乙段" && r.right === null);
    expect(applyFix(now, restoreRow(now, rows, i)!)).toBe(old);
  });
  it("删掉的是第一段：放回最前面", () => {
    const now = "甲段原文\n\n乙段\n\n丙段\n";
    const rows = alignWithRanges(old, now);
    const i = rows.findIndex((r) => r.left === "# 标题");
    expect(applyFix(now, restoreRow(now, rows, i)!)).toBe(old);
  });
  it("新增的段落：删掉（中间的、最后的）", () => {
    const mid = "# 标题\n\n甲段原文\n\n新写的\n\n乙段\n\n丙段\n";
    let rows = alignWithRanges(old, mid);
    expect(applyFix(mid, removeRow(mid, rows, rows.findIndex((r) => r.right === "新写的"))!)).toBe(old);
    const end = old + "\n最后加的一段\n";
    rows = alignWithRanges(old, end);
    expect(applyFix(end, removeRow(end, rows, rows.findIndex((r) => r.right === "最后加的一段"))!)).toBe(old);
  });
  it("没改的行不能恢复，旧版有的行不能移除", () => {
    const rows = alignWithRanges(old, old);
    expect(restoreRow(old, rows, 0)).toBeNull();
    expect(removeRow(old, rows, 0)).toBeNull();
  });
});
