import { describe, expect, it } from "vitest";
import { moveSpan, neighborSlot, nextBlockStart, sectionSpan, TopBlock, unitOf } from "../src/lib/blockMove";

/** 用空行分块（测试用的简单版本：没有代码块） */
function blocksOf(t: string): TopBlock[] {
  const out: TopBlock[] = [];
  const re = /(?:^|\n\n+)([^\n](?:[^\n]|\n(?=[^\n]))*)/g;
  for (let m: RegExpExecArray | null; (m = re.exec(t)); ) {
    const from = m.index + m[0].length - m[1].length;
    const h = m[1].match(/^(#{1,6}) /);
    out.push({ from, to: from + m[1].length, level: h ? h[1].length : 0 });
  }
  return out;
}
const apply = (t: string, r: { from: number; to: number; insert: string } | null) => (r ? t.slice(0, r.from) + r.insert + t.slice(r.to) : t);

describe("块的移动", () => {
  const t = "甲\n\n乙\n\n丙\n";
  const bs = blocksOf(t);
  it("找块", () => {
    expect(bs.map((b) => t.slice(b.from, b.to))).toEqual(["甲", "乙", "丙"]);
    expect(nextBlockStart(t, bs[0].to)).toBe(bs[1].from);
    expect(nextBlockStart(t, bs[2].to)).toBe(t.length);
  });
  it("往前、往后、挪到末尾", () => {
    expect(apply(t, moveSpan(t, bs[2], bs[0].from))).toBe("丙\n\n甲\n\n乙\n");
    expect(apply(t, moveSpan(t, bs[0], bs[2].from))).toBe("乙\n\n甲\n\n丙\n");
    expect(apply(t, moveSpan(t, bs[0], t.length))).toBe("乙\n\n丙\n\n甲\n");
    expect(apply(t, moveSpan(t, bs[1], t.length))).toBe("甲\n\n丙\n\n乙\n");
  });
  it("原地、放进自己里面：不动", () => {
    expect(moveSpan(t, bs[0], bs[0].from)).toBeNull();
    expect(moveSpan(t, bs[0], bs[1].from)).toBeNull();
  });
  it("挪过去以后的开头", () => {
    const r = moveSpan(t, bs[0], bs[2].from)!;
    expect(apply(t, r).slice(r.at, r.at + 1)).toBe("甲");
  });
});

describe("标题带着整节移动", () => {
  const t = "# 第三章\n\n## 3.1 问题\n\n正文一\n\n### 小节\n\n正文二\n\n## 3.2 样本\n\n正文三\n\n## 3.3 框架\n\n正文四\n";
  const bs = blocksOf(t);
  const h31 = bs.findIndex((b) => t.slice(b.from).startsWith("## 3.1")), h32 = h31 + 4, h33 = h32 + 2;
  it("整节范围到下一个同级标题之前", () => {
    expect(t.slice(sectionSpan(bs, h31).from, sectionSpan(bs, h31).to)).toBe("## 3.1 问题\n\n正文一\n\n### 小节\n\n正文二");
    expect(unitOf(bs, 2)).toEqual({ from: bs[2].from, to: bs[2].to });
  });
  it("下移：和后一节换位置", () => {
    const slot = neighborSlot(bs, h31, 1, t.length)!;
    expect(slot).toBe(bs[h33].from);
    expect(apply(t, moveSpan(t, sectionSpan(bs, h31), slot))).toBe("# 第三章\n\n## 3.2 样本\n\n正文三\n\n## 3.1 问题\n\n正文一\n\n### 小节\n\n正文二\n\n## 3.3 框架\n\n正文四\n");
  });
  it("上移：最前面一节不能再上移；最后一节下移不了", () => {
    expect(neighborSlot(bs, h31, -1, t.length)).toBeNull();
    expect(neighborSlot(bs, h33, 1, t.length)).toBeNull();
    expect(neighborSlot(bs, h33, -1, t.length)).toBe(bs[h32].from);
  });
  it("普通块下移越过后一块", () => {
    expect(neighborSlot(bs, h31 + 1, 1, t.length)).toBe(bs[h31 + 3].from);
  });
});
