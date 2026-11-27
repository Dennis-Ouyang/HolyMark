import { describe, expect, it } from "vitest";
import { resolveHref } from "../src/lib/links";

const doc = "/稿/正文/03.md";
describe("链接指向哪里", () => {
  it("网页", () => {
    expect(resolveHref("https://a.com/x?y#z", doc)).toEqual({ kind: "url", url: "https://a.com/x?y#z" });
    expect(resolveHref("www.a.com", doc)).toEqual({ kind: "url", url: "https://www.a.com" });
    expect(resolveHref("mailto:a@b.c", doc)).toEqual({ kind: "url", url: "mailto:a@b.c" });
  });
  it("本文锚点", () => expect(resolveHref("#%E6%A0%B7%E6%9C%AC", doc)).toEqual({ kind: "anchor", anchor: "样本" }));
  it("另一篇 Markdown，带锚点", () => expect(resolveHref("../资料/导师意见.md#第三章", doc)).toEqual({ kind: "md", path: "/稿/资料/导师意见.md", anchor: "第三章" }));
  it("尖括号和编码过的路径", () => expect(resolveHref("<../资料/a b.md>", doc)).toEqual({ kind: "md", path: "/稿/资料/a b.md", anchor: "" }));
  it("其他文件、Windows 路径", () => {
    expect(resolveHref("../资料/表.xlsx", doc)).toEqual({ kind: "file", path: "/稿/资料/表.xlsx" });
    expect(resolveHref("C:\\a\\b.pdf", doc)).toEqual({ kind: "file", path: "C:/a/b.pdf" });
  });
  it("不认识的协议不打开", () => expect(resolveHref("javascript:alert(1)", doc)).toBeNull());
});
