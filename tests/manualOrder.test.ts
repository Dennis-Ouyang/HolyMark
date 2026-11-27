import { describe, expect, it } from "vitest";
import type { TreeNode } from "../src/lib/backend";
import { namesIn, NO_ORDER, orderTree, parseOrder, removeEntry, renameEntry, reorder } from "../src/lib/manualOrder";

const f = (path: string): TreeNode => ({ name: path.split("/").pop()!, path, dir: false, children: [] });
const d = (path: string, children: TreeNode[]): TreeNode => ({ name: path.split("/").pop()!, path, dir: true, children });
const tree = [f("/w/第10章.md"), f("/w/第2章.md"), d("/w/资料", [f("/w/资料/b.md"), f("/w/资料/a.md")]), f("/w/前言.md")];
const names = (ns: TreeNode[]) => ns.map((n) => n.name);

describe("文件树手动排序（N18）", () => {
  it("按名称：自然排序，文件夹在前", () => {
    expect(names(orderTree(tree, NO_ORDER, "/w"))).toEqual(["资料", "前言.md", "第2章.md", "第10章.md"]);
  });
  it("手动：记过的按记的顺序，没记的（新文件）按名称排在最后", () => {
    const o = { mode: "manual" as const, dirs: { "": ["第10章.md", "前言.md"], 资料: ["b.md"] } };
    const t = orderTree(tree, o, "/w");
    expect(names(t)).toEqual(["第10章.md", "前言.md", "资料", "第2章.md"]);
    expect(names(t[2].children)).toEqual(["b.md", "a.md"]);
  });
  it("拖动：把一项挪到另一项前面，整串名字记下来", () => {
    const cur = namesIn(orderTree(tree, NO_ORDER, "/w"), "/w", "/w");
    const o = reorder(NO_ORDER, "", cur, "第10章.md", "前言.md");
    expect(o.mode).toBe("manual");
    expect(o.dirs[""]).toEqual(["资料", "第10章.md", "前言.md", "第2章.md"]);
    expect(reorder(o, "", o.dirs[""], "资料", null).dirs[""]).toEqual(["第10章.md", "前言.md", "第2章.md", "资料"]);
  });
  it("改名、移动、删除时同步", () => {
    const o = { mode: "manual" as const, dirs: { "": ["b.md", "资料", "a.md"], 资料: ["x.md", "y.md"], "资料/图": ["1.png"] } };
    expect(renameEntry(o, "b.md", "b2.md").dirs[""]).toEqual(["b2.md", "资料", "a.md"]);
    const moved = renameEntry(o, "b.md", "资料/b.md");
    expect(moved.dirs[""]).toEqual(["资料", "a.md"]);
    expect(moved.dirs["资料"]).toEqual(["x.md", "y.md"]); // 到新文件夹排在最后（没记）
    const ren = renameEntry(o, "资料", "参考");
    expect(ren.dirs[""]).toEqual(["b.md", "参考", "a.md"]);
    expect(ren.dirs["参考/图"]).toEqual(["1.png"]);
    expect(ren.dirs["资料"]).toBeUndefined();
    const del = removeEntry(o, "资料");
    expect(del.dirs[""]).toEqual(["b.md", "a.md"]);
    expect(Object.keys(del.dirs)).toEqual([""]);
  });
  it("读坏了的文件当按名称", () => {
    expect(parseOrder("{")).toEqual(NO_ORDER);
    expect(parseOrder('{"mode":"manual","dirs":{"":["a",1]}}')).toEqual({ mode: "manual", dirs: { "": ["a"] } });
  });
});
