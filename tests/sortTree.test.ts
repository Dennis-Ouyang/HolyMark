import { describe, expect, it } from "vitest";
import { naturalCompare, sortTree } from "../src/lib/sortTree";

describe("文件树自然排序（H1）", () => {
  it("和 Rust 端同一个顺序", () => {
    const v = ["未命名 10.md", "未命名.md", "未命名 2.md", "第10章.md", "第2章.md", "第1章.md", "a.md", "B.md"];
    expect([...v].sort(naturalCompare)).toEqual(["a.md", "B.md", "未命名.md", "未命名 2.md", "未命名 10.md", "第1章.md", "第2章.md", "第10章.md"]);
  });
  it("文件夹在前，递归排", () => {
    const t = sortTree([
      { name: "z.md", path: "/z.md", dir: false, children: [] },
      { name: "资料", path: "/资料", dir: true, children: [{ name: "10.md", path: "", dir: false, children: [] }, { name: "9.md", path: "", dir: false, children: [] }] },
    ]);
    expect(t.map((n) => n.name)).toEqual(["资料", "z.md"]);
    expect(t[0].children.map((n) => n.name)).toEqual(["9.md", "10.md"]);
  });
});
