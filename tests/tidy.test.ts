import { describe, expect, it } from "vitest";
import { lineChanges, tidy, TIDY_DEFAULTS, TidyRules } from "../src/lib/tidy";

const only = (p: Partial<TidyRules>): TidyRules => ({ space: "off", punct: false, quotes: "off", dash: false, fullwidth: false, spaces: false, repeats: false, ...p });
const run = (t: string, p: Partial<TidyRules>) => tidy(t, only(p)).text;

describe("中英文之间的空格", () => {
  it("加空格", () => {
    expect(run("使用Markdown写作3年", { space: "add" })).toBe("使用 Markdown 写作 3 年");
    expect(run("增长50%以上", { space: "add" })).toBe("增长 50% 以上");
  });
  it("去掉空格", () => expect(run("使用 Markdown 写作 3 年", { space: "remove" })).toBe("使用Markdown写作3年"));
  it("不处理是默认值", () => expect(tidy("使用Markdown", TIDY_DEFAULTS).text).toBe("使用Markdown"));
});

describe("半角标点转全角", () => {
  const p = { punct: true };
  it("紧挨着中文时转", () => {
    expect(run("你好,世界.真的吗?是的!注意:一;二", p)).toBe("你好，世界。真的吗？是的！注意：一；二");
    expect(run("你好, 世界", p)).toBe("你好，世界");
    expect(run("这是**重点**.", p)).toBe("这是**重点**。");
  });
  it("括号成对转换", () => {
    expect(run("参见 (张三) 的研究", p)).toBe("参见（张三）的研究");
    expect(run("我们(we)", p)).toBe("我们（we）");
  });
  it("英文句子、数字、文件名不动", () => {
    const keep = ["Hello, world. Is it ok?", "圆周率 3.14，共 1,000 人", "保存为报告.docx", "时间 10:30", "Smith (2020) shows"];
    for (const k of keep) expect(run(k, p)).toBe(k);
  });
  it("网址、路径不动", () => {
    expect(run("访问https://example.com/a?b=1,2.看看", p)).toBe("访问https://example.com/a?b=1,2。看看");
    expect(run("文件在./资料/a.md里", p)).toBe("文件在./资料/a.md里");
  });
});

describe("引号", () => {
  it("统一成直角引号", () => {
    expect(run("他说“你好”。", { quotes: "corner" })).toBe("他说「你好」。");
    expect(run('他说"你好"。', { quotes: "corner" })).toBe("他说「你好」。");
    expect(run("‘内层’", { quotes: "corner" })).toBe("『内层』");
  });
  it("统一成弯引号", () => expect(run("他说「你好『嗯』」。", { quotes: "curly" })).toBe("他说“你好‘嗯’”。"));
  it("英文里的撇号和引号不动", () => {
    expect(run("Cohen’s κ 检验", { quotes: "corner" })).toBe("Cohen’s κ 检验");
    expect(run('He said "hi".', { quotes: "corner" })).toBe('He said "hi".');
  });
});

describe("省略号和破折号", () => {
  const p = { dash: true };
  it("转换", () => {
    expect(run("等等...", p)).toBe("等等……");
    expect(run("等等。。。", p)).toBe("等等……");
    expect(run("他说 -- 好吧", p)).toBe("他说——好吧");
  });
  it("英文、分隔线、表格、命令行参数不动", () => {
    for (const k of ["wait...", "---", "| --- | --- |", "运行 `ls --all`", "use --force here"]) expect(run(k, p)).toBe(k);
  });
});

describe("全角字母数字转半角", () => {
  it("转换", () => expect(run("第１２３页ＡＢＣ", { fullwidth: true })).toBe("第123页ABC"));
});

describe("连续空格、行末空格", () => {
  const p = { spaces: true };
  it("清理", () => {
    expect(run("中间  有   空格  \n下一行", { spaces: true })).toBe("中间 有 空格  \n下一行"); // 两个空格接下一行是硬换行，保留
    expect(run("行末有空格 \n\n下一段", p)).toBe("行末有空格\n\n下一段");
    expect(run("最后一行   ", p)).toBe("最后一行");
  });
  it("行首缩进不动", () => expect(run("- 一\n    - 二", p)).toBe("- 一\n    - 二"));
});

describe("重复字词：只标出来", () => {
  it("找出，不改", () => {
    const r = tidy("这是是我的的书，事情不了了之，的的确确。", only({ repeats: true }));
    expect(r.text).toBe("这是是我的的书，事情不了了之，的的确确。");
    expect(r.repeats.map((x) => x.word)).toEqual(["是是", "的的"]);
    expect(r.repeats[0].from).toBe(1);
  });
});

describe("永远跳过", () => {
  const all: TidyRules = { space: "add", punct: true, quotes: "corner", dash: true, fullwidth: true, spaces: true, repeats: false };
  const same = (t: string) => expect(tidy(t, all).text).toBe(t);
  it("代码块和行内代码", () => {
    same("```\n中文,english  ...\n```");
    same("~~~\n是的.\n~~~");
    same("用`a,b`表示");
  });
  it("公式", () => {
    same("$$\nf(x),中文\n$$");
    expect(tidy("当$x,y$时", all).text).toBe("当$x,y$时");
  });
  it("属性区", () => same("---\ntitle: 研究设计,第三章\n---\n"));
  it("链接和图片地址", () => {
    expect(tidy("见[文件](../资料/a,b.md)", all).text).toBe("见[文件](../资料/a,b.md)");
    expect(tidy("如图![图一](a.png)", all).text).toBe("如图![图一](a.png)");
  });
  it("文献引用", () => expect(tidy("已有研究[@zhang2021; @li2020].", all).text).toBe("已有研究[@zhang2021; @li2020]。"));
  it("批注的标记符号", () => {
    expect(tidy("{==原文==}{>>@王老师 2026-11-18：要改<<}", all).text).toBe("{==原文==}{>>@王老师 2026-11-18：要改<<}");
    expect(tidy("{--删掉--}", all).text).toBe("{--删掉--}");
  });
  it("HTML", () => {
    same("<div class=\"a,b\">\n");
    expect(tidy("中文<span title=\"a.b\">字</span>", all).text).toBe("中文<span title=\"a.b\">字</span>");
  });
  it("标题编号、列表标记、属性", () => {
    expect(tidy("## 3.2　样本与数据 {#sample}", all).text).toBe("## 3.2　样本与数据 {#sample}");
    expect(tidy("1. 第一项", all).text).toBe("1. 第一项");
  });
  it("选区以外不改", () => {
    const t = "甲,乙\n丙,丁";
    const r = tidy(t, all, { from: 4, to: 7 });
    expect(r.text).toBe("甲,乙\n丙，丁");
    expect(r.total).toBe(1);
  });
});

describe("改动列表", () => {
  it("逐行最小改动，可以还原", () => {
    const a = "第一行,好\n不变\n第三行...";
    const r = tidy(a, TIDY_DEFAULTS);
    expect(r.text).toBe("第一行，好\n不变\n第三行……");
    expect(r.changes).toEqual([{ from: 3, to: 4, insert: "，" }, { from: 12, to: 15, insert: "……" }]);
    expect(r.counts.punct).toBe(1);
    expect(r.counts.dash).toBe(1);
    expect(r.total).toBe(2);
  });
  it("lineChanges", () => expect(lineChanges("ab\ncd", "ab\ncxd")).toEqual([{ from: 4, to: 4, insert: "x" }]));
});
