import { describe, expect, it } from "vitest";
import { blocksOf, merge3 } from "../src/lib/merge";

describe("切块", () => {
  it("拼回去和原文一样", () => {
    for (const t of ["", "一", "一\n", "一\n\n二", "一\n二\n\n\n三\n", "\n\n一\n\n", "# 标题\n\n- a\n- b\n\n段落"]) expect(blocksOf(t).join("")).toBe(t);
    expect(blocksOf("一\n\n二\n三\n\n四")).toEqual(["一\n\n", "二\n三\n\n", "四"]);
  });
});

describe("三方合并（B15）", () => {
  const base = "# 标题\n\n第一段。\n\n第二段。\n\n第三段。\n";
  it("只有一边改了", () => {
    expect(merge3(base, base, base + "\n第四段。\n").text).toBe(base + "\n第四段。\n");
    expect(merge3(base, base.replace("第一段", "第一段改"), base).text).toBe(base.replace("第一段", "第一段改"));
  });
  it("改的是不同块：直接合并", () => {
    const mine = base.replace("第一段。", "第一段，我刚写的字。");
    const theirs = base.replace("第三段。", "第三段，外部改的。");
    const r = merge3(base, mine, theirs);
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe("# 标题\n\n第一段，我刚写的字。\n\n第二段。\n\n第三段，外部改的。\n");
  });
  it("一边在末尾加字，一边改开头", () => {
    const r = merge3(base, base + "\n我在末尾写的。", base.replace("# 标题", "# 新标题"));
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe("# 新标题\n\n第一段。\n\n第二段。\n\n第三段。\n\n我在末尾写的。");
  });
  it("改了同一块：两边都保留，报告冲突", () => {
    const r = merge3(base, base.replace("第二段。", "第二段（我）。"), base.replace("第二段。", "第二段（外部）。"));
    expect(r.conflicts).toBe(1);
    expect(r.text).toBe("# 标题\n\n第一段。\n\n第二段（我）。\n\n第二段（外部）。\n\n第三段。\n");
  });
  it("两边改成一样", () => {
    const x = base.replace("第二段。", "同样的改动。");
    expect(merge3(base, x, x)).toEqual({ text: x, conflicts: 0 });
  });
  it("外部删了一段，我在别处写字", () => {
    const r = merge3(base, base.replace("第三段。", "第三段改。"), base.replace("第一段。\n\n", ""));
    expect(r).toEqual({ text: "# 标题\n\n第二段。\n\n第三段改。\n", conflicts: 0 });
  });
});

import { thinVersions } from "../src/lib/versionThin";
describe("版本稀疏规则（G7）", () => {
  it("一天内全留，两周内每小时一个，更早每天一个，你保存的全留", () => {
    const H = 3_600_000, D = 24 * H, now = 100 * D;
    const v = (at: number, source: "auto" | "saved" = "auto") => ({ id: String(at), at, source });
    const list = [v(now - H + 1), v(now - H), v(now - 5 * D + 120_000, "saved"), v(now - 5 * D + 60_000), v(now - 5 * D), v(now - 40 * D + 10), v(now - 40 * D)];
    expect(thinVersions(list, now).map((x) => x.at)).toEqual([now - H + 1, now - H, now - 5 * D + 120_000, now - 5 * D + 60_000, now - 40 * D + 10]);
  });
});
