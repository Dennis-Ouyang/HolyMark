/** CodeMirror 自带界面（⌘F 查找替换栏、跳转到行等）的中文文字 */
import { EditorState } from "@codemirror/state";

export const zhPhrases = EditorState.phrases.of({
  // @codemirror/search
  "Find": "查找",
  "Replace": "替换为",
  "next": "下一个",
  "previous": "上一个",
  "all": "全选",
  "match case": "区分大小写",
  "regexp": "正则表达式",
  "by word": "整词",
  "replace": "替换",
  "replace all": "全部替换",
  "close": "关闭",
  "current match": "当前匹配",
  "replaced $ matches": "已替换 $ 处",
  "replaced match on line $": "已替换第 $ 行的匹配",
  "on line": "在第几行",
  "Go to line": "跳到第几行",
  "go": "跳转",
  // @codemirror/view
  "Control character": "控制字符",
  "Selection deleted": "已删除选中的内容",
});
