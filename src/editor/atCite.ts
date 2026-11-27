/**
 * 正文里输入 @ 直接弹出文献（G11）：在空白、中文或标点后面打 @ 时调用 onAt(位置)，由应用打开插入浮层的文献模式。
 * 代码块、公式里不触发；邮箱地址（字母数字后面的 @）不触发。
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { inCodeBlock } from "./keys";

export function atCite(onAt: (pos: number) => boolean): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== "@" || from !== to || inCodeBlock(view.state, from)) return false;
    const before = view.state.sliceDoc(Math.max(0, from - 1), from);
    if (/[A-Za-z0-9_.@$`\\]/.test(before)) return false;
    // 先让 @ 正常输入，下一帧再弹浮层（浮层选中文献后会把这个 @ 换掉）
    queueMicrotask(() => onAt(from));
    return false;
  });
}
