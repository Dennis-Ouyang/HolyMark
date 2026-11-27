import { describe, expect, it } from "vitest";
import { applyMatches, buildRegex, context, expandReplacement, FIND_DEFAULTS, findMatches } from "../src/lib/replace";

const o = (p: Partial<typeof FIND_DEFAULTS> = {}) => ({ ...FIND_DEFAULTS, ...p });

describe("文件夹里查找替换", () => {
  it("默认不分大小写、不是全词、不是正则", () => {
    const m = findMatches("Word word WORD (a.b)", "word", "文档", o());
    expect(m.map((x) => x.text)).toEqual(["Word", "word", "WORD"]);
    expect(findMatches("a.b axb", "a.b", "", o()).length).toBe(1); // 点不是通配符
  });
  it("区分大小写、全词", () => {
    expect(findMatches("Word word", "word", "", o({ caseSensitive: true })).length).toBe(1);
    expect(findMatches("cat catalog cat_x 猫cat", "cat", "", o({ wholeWord: true })).map((x) => x.from)).toEqual([0, 19]);
  });
  it("正则和分组", () => {
    const m = findMatches("2025年3月 2026年11月", "(\\d{4})年(\\d{1,2})月", "$1-$2", o({ regex: true }));
    expect(m.map((x) => x.replacement)).toEqual(["2025-3", "2026-11"]);
    expect(typeof buildRegex("(", o({ regex: true }))).toBe("string"); // 写错了返回错误信息
  });
  it("$ 的各种写法", () => {
    const m = /(?<y>\d+)-(\d+)/u.exec("12-34")!;
    expect(expandReplacement("$<y>/$2/$&/$$/$9", m)).toBe("12/34/12-34/$/$9");
  });
  it("默认跳过代码块和行内代码", () => {
    const t = "受访者\n\n```\n受访者\n```\n\n用 `受访者` 表示受访者";
    expect(findMatches(t, "受访者", "", o()).length).toBe(2);
    expect(findMatches(t, "受访者", "", o({ skipCode: false })).length).toBe(4);
  });
  it("默认也跳过链接和图片的地址", () => {
    const t = "见[受访者编码表](../资料/受访者编码表.xlsx)和![受访者](受访者.png)";
    expect(findMatches(t, "受访者", "", o()).map((m) => m.from)).toEqual([2, 31]);
  });
  it("只应用勾选的", () => {
    const t = "甲乙甲乙甲";
    const m = findMatches(t, "甲", "丙", o());
    expect(applyMatches(t, [m[0], m[2]])).toBe("丙乙甲乙丙");
  });
  it("前后文", () => {
    const t = "第一行\n这是很长很长的一行里面有受访者这个词还有后面的文字\n第三行";
    const m = findMatches(t, "受访者", "", o())[0];
    const c = context(t, m, 4);
    expect(c.pre).toBe("…行里面有");
    expect(c.post).toBe("这个词还…");
  });
});
