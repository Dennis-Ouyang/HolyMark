import { describe, expect, it } from "vitest";
import { findAnchor, headingAnchors, pandocId } from "../src/lib/anchors";
import { emptyNav, goBack, goForward, leave, renameNav } from "../src/lib/navHistory";

// 以下例子已用 Pandoc 3.9 验证（见交接说明）
describe("锚点和 Pandoc auto_identifiers 一致", () => {
  it("开头的编号和全角空格去掉", () => expect(pandocId("3.2　样本与数据")).toBe("样本与数据"));
  it("中间的空格变成 -", () => expect(pandocId("第三章 研究设计")).toBe("第三章-研究设计"));
  it("撇号去掉、转小写、希腊字母保留", () => expect(pandocId("Cohen’s κ 检验")).toBe("cohens-κ-检验"));
  it("显式 {#id}", () => {
    const h = headingAnchors("## 自定义 {#my-id}\n");
    expect(h[0].id).toBe("my-id");
    expect(h[0].text).toBe("自定义");
  });
  it("同名标题依次加 -1", () => {
    expect(headingAnchors("## 3.2　样本与数据\n\n## 样本与数据\n\n## 样本与数据\n").map((h) => h.id)).toEqual(["样本与数据", "样本与数据-1", "样本与数据-2"]);
  });
  it("smart 标点", () => expect(pandocId("A--b_c. (x) 「引号」")).toBe("ab_c.-x-引号"));
  it("什么都不剩时用 section", () => expect(headingAnchors("# 123\n")[0].id).toBe("section"));
  it("找锚点：精确、按文字", () => {
    const md = "# 第三章 研究设计\n\n## 3.2　样本与数据\n";
    expect(findAnchor(md, "样本与数据")?.pos).toBe(md.indexOf("## 3.2"));
    expect(findAnchor(md, "第三章 研究设计")?.level).toBe(1);
    expect(findAnchor(md, "不存在")).toBeNull();
  });
});

describe("跳转历史", () => {
  const a = { path: "/a.md", pos: 1 }, b = { path: "/a.md", pos: 50 }, c = { path: "/b.md", pos: 0 };
  it("返回、前进", () => {
    let n = leave(emptyNav(), a); // 从 a 跳到 b
    n = leave(n, b); // 从 b 跳到 c
    const r1 = goBack(n, c)!;
    expect(r1.to).toEqual(b);
    const r2 = goBack(r1.nav, b)!;
    expect(r2.to).toEqual(a);
    expect(goBack(r2.nav, a)).toBeNull();
    const f = goForward(r2.nav, a)!;
    expect(f.to).toEqual(b);
  });
  it("新的跳转让前进作废，重复的位置不记两次", () => {
    let n = leave(leave(emptyNav(), a), b);
    n = goBack(n, c)!.nav;
    n = leave(n, b);
    expect(n.fwd).toEqual([]);
    expect(n.back).toEqual([a, b]);
  });
  it("改名、删除", () => {
    const n = { back: [a, c], fwd: [] };
    expect(renameNav(n, "/a.md", "/x.md").back[0].path).toBe("/x.md");
    expect(renameNav(n, "/b.md", null).back).toEqual([a]);
  });
});
