import { describe, expect, it } from "vitest";
import { hasChildren, hiddenByCollapse, outlineKeys } from "../src/lib/outlineFold";

const hs = [1, 2, 3, 3, 2, 3, 1].map((level, i) => ({ level, text: "h" + (i === 3 ? 2 : i), pos: i }));

describe("目录折叠", () => {
  it("有没有子级", () => expect(hasChildren(hs)).toEqual([true, true, false, false, true, false, false]));
  it("同名标题的键不重复", () => { const k = outlineKeys([...hs, hs[2]]); expect(new Set(k).size).toBe(k.length); });
  it("收起二级标题，只藏它下面的三级", () => {
    const k = outlineKeys(hs);
    expect(hiddenByCollapse(hs, k, new Set([k[1]]))).toEqual([false, false, true, true, false, false, false]);
  });
  it("收起一级标题，下一个一级标题之前都藏起来", () => {
    const k = outlineKeys(hs);
    expect(hiddenByCollapse(hs, k, new Set([k[0], k[4]]))).toEqual([false, true, true, true, true, true, false]);
  });
});
