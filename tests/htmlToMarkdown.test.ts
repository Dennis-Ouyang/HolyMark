// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/lib/htmlToMarkdown";

describe("粘贴带格式的内容（G9）", () => {
  it("网页：标题、段落、强调、链接、列表、表格", () => {
    const md = htmlToMarkdown(`<h2>研究问题</h2><p>这是<strong>重点</strong>和<em>斜体</em>，见<a href="https://x.org">链接</a>。</p>
      <ul><li>一<ul><li>子项</li></ul></li><li>二</li></ul><ol start="3"><li>三</li><li>四</li></ol>
      <table><tr><th>项目</th><th>规模</th></tr><tr><td>访谈</td><td>48</td></tr></table><script>alert(1)</script>`);
    expect(md).toBe("## 研究问题\n\n这是**重点**和*斜体*，见[链接](https://x.org)。\n\n- 一\n  - 子项\n- 二\n\n3. 三\n4. 四\n\n| 项目 | 规模 |\n| --- | --- |\n| 访谈 | 48 |");
  });
  it("Word：带样式的 span、条件注释、o:p", () => {
    const md = htmlToMarkdown(`<!--[if gte mso 9]><xml>x</xml><![endif]--><p class=MsoNormal><span style="font-weight:bold">加粗</span>普通<o:p></o:p></p>`);
    expect(md).toBe("**加粗**普通");
  });
  it("引用和代码块", () => {
    expect(htmlToMarkdown("<blockquote><p>引用一句</p></blockquote><pre>a = 1\nb = 2</pre>")).toBe("> 引用一句\n\n```\na = 1\nb = 2\n```");
  });
});
