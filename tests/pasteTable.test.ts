// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { gridFromHtml, gridFromTsv, gridToMarkdown, isNumericColumn, pasteTable } from "../src/lib/pasteTable";

describe("从表格软件粘贴（N11）", () => {
  it("制表符分隔：第一行作表头，数字列右对齐", () => {
    const md = pasteTable("", "数据来源\t规模\t占比\n访谈\t48\t12.5%\n日志\t1,036\t60%\n");
    expect(md).toBe("| 数据来源 | 规模 | 占比 |\n| --- | ---: | ---: |\n| 访谈 | 48 | 12.5% |\n| 日志 | 1,036 | 60% |");
  });
  it("| 转义，格子里的换行写成 <br>（Excel 用引号包起来）", () => {
    const g = gridFromTsv('甲\t乙\n"一行\n两行"\ta|b\n')!;
    expect(g).toEqual([["甲", "乙"], ["一行\n两行", "a|b"]]);
    expect(gridToMarkdown(g)).toBe("| 甲 | 乙 |\n| --- | --- |\n| 一行<br>两行 | a\\|b |");
  });
  it("不是表格的文字不动", () => {
    expect(gridFromTsv("只有一行\t一个 Tab")).toBeNull();
    expect(gridFromTsv("普通文字\n没有制表符")).toBeNull();
    expect(pasteTable("", "第一段\n\n第二段")).toBeNull();
  });
  it("HTML 表格：合并单元格展开，末尾空行空列去掉", () => {
    const html = `<html><body><table>
      <tr><td rowspan="2">组别</td><td colspan="2">2025 年</td><td></td></tr>
      <tr><td>上半年</td><td>下半年</td><td></td></tr>
      <tr><td>甲组</td><td>3</td><td>4</td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td></tr>
    </table></body></html>`;
    expect(gridFromHtml(html)).toEqual([["组别", "2025 年", ""], ["", "上半年", "下半年"], ["甲组", "3", "4"]]);
  });
  it("网页里夹着表格：交给普通的带格式粘贴", () => {
    expect(gridFromHtml("<p>前面的话</p><table><tr><td>a</td><td>b</td></tr></table>")).toBeNull();
    expect(gridFromHtml("<table><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table>")).toBeNull();
  });
  it("Excel 的 HTML 带 <br>、&nbsp;", () => {
    expect(gridFromHtml("<table><tr><td>a<br>b</td><td>x&nbsp;&amp;&nbsp;y</td></tr><tr><td>1</td><td>2</td></tr></table>")).toEqual([["a\nb", "x & y"], ["1", "2"]]);
  });
  it("数字列判断", () => {
    expect(isNumericColumn([["h"], ["¥30"], ["-3.5"], [""]], 0)).toBe(true);
    expect(isNumericColumn([["h"], ["3 次"]], 0)).toBe(false);
    expect(isNumericColumn([["h"], [""]], 0)).toBe(false);
  });
});
