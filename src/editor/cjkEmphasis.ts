/**
 * 中文友好的强调与删除线识别。
 *
 * CommonMark 判断 * 和 ~~ 能不能开始、结束强调时，要求“紧挨着标点的一侧，另一侧必须是空白或标点”。
 * 英文词之间有空格，这条规则没问题；中文没有空格，于是 `这是~~**测试**~~文字` 里的 ~~ 一边是汉字、
 * 一边是 *，被判成既不能开始也不能结束，删除线显示成原样的符号。Pandoc 导出时不受影响，只有编辑器会乱。
 *
 * 这里按 markdown-it-cjk-friendly 的思路放宽：定界符一侧是中日韩文字时，把它当成标点那样看待。
 * 对英文和其他文字的识别结果与 CommonMark 完全相同。
 */
import { InlineContext, MarkdownConfig } from "@lezer/markdown";

const Punct = /[\p{S}\p{P}]/u;
const Space = /\s|^$/;
// 汉字（含扩展 A、兼容汉字）、假名、谚文；扩展 B 以后在代理对里，取不到一个完整字符，按低位代理判断
const CJK = /[⺀-⿟぀-ヿ㄀-ㄯㆠ-ㇿ㐀-䶿一-鿿가-힯豈-﫿\uDC00-\uDFFF]/;

function flank(before: string, after: string) {
  const pB = Punct.test(before), pA = Punct.test(after);
  const sB = Space.test(before), sA = Space.test(after);
  const cB = CJK.test(before), cA = CJK.test(after);
  return {
    left: !sA && (!pA || sB || pB || cB),
    right: !sB && (!pB || sA || pA || cA),
    pB, pA,
  };
}

const StrikeDelim = { resolve: "Strikethrough", mark: "StrikethroughMark" };

export const cjkEmphasis: MarkdownConfig = {
  parseInline: [
    {
      name: "Emphasis",
      parse(cx: InlineContext, next: number, start: number) {
        if (next != 95 && next != 42) return -1;
        let pos = start + 1;
        while (cx.char(pos) == next) pos++;
        const f = flank(cx.slice(start - 1, start), cx.slice(pos, pos + 1));
        // _ 在词中间不算强调（snake_case），沿用 CommonMark 的规则
        const open = f.left && (next == 42 || !f.right || f.pB);
        const close = f.right && (next == 42 || !f.left || f.pA);
        return cx.addDelimiter(next == 95 ? InlineContext.emphasisUnderscore : InlineContext.emphasisAsterisk, start, pos, open, close);
      },
    },
    {
      // 和 GFM 的 Strikethrough 同名，配置时替换掉它
      name: "Strikethrough",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next != 126 || cx.char(pos + 1) != 126 || cx.char(pos + 2) == 126) return -1;
        const f = flank(cx.slice(pos - 1, pos), cx.slice(pos + 2, pos + 3));
        return cx.addDelimiter(StrikeDelim, pos, pos + 2, f.left, f.right);
      },
      after: "Emphasis",
    },
  ],
};
