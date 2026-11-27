import { describe, expect, it } from "vitest";
import { clampSpot, rememberSpot, renameSpots, Spot } from "../src/lib/positions";

const spot = (at: number, extra: Partial<Spot> = {}): Spot => ({ anchor: 10, head: 12, top: 5, folds: [3], reading: false, at, ...extra });

describe("记住位置", () => {
  it("最多留最近的 N 篇，淘汰最旧的", () => {
    let s = {};
    for (let i = 0; i < 6; i++) s = rememberSpot(s, "/f" + i, spot(i), 4);
    expect(Object.keys(s).sort()).toEqual(["/f2", "/f3", "/f4", "/f5"]);
  });
  it("同一篇再记一次只是更新", () => {
    let s = rememberSpot({}, "/a", spot(1));
    s = rememberSpot(s, "/a", spot(2, { head: 99 }));
    expect(Object.keys(s)).toEqual(["/a"]);
    expect(s["/a"].head).toBe(99);
  });
  it("文件被外部改短：夹在有效范围内", () => {
    expect(clampSpot(spot(1, { anchor: 500, head: 800, top: 900, folds: [2, 40] }), 300, 20)).toEqual(spot(1, { anchor: 300, head: 300, top: 300, folds: [2] }));
  });
  it("改名、移动后跟着换路径", () => {
    const s = renameSpots({ "/稿/a.md": spot(1), "/其他.md": spot(2) }, "/稿", "/正文");
    expect(Object.keys(s).sort()).toEqual(["/其他.md", "/正文/a.md"]);
  });
});
