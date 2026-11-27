/**
 * 新功能的编辑器扩展都从这里接进编辑器，Editor.tsx 里只多一个 extra 参数。
 * 需要和界面打交道的（打开链接、记住位置……）经由 hooks 对象回调，hooks 的内容可以随时换，扩展本身只建一次。
 */
import type { Extension } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { tidyMarks } from "./tidyMarks";
import { mathCompletions, texPreviewOption } from "./mathComplete";
import { sectionFolding } from "./sectionFold";
import { readingMode, ReadingHooks } from "./readingMode";
import { anchorCompletions } from "./anchorComplete";

export interface FeatureHooks {
  /** 字数口径：含不含标点（跟设置走） */
  withPunct?: () => boolean;
  /** 阅读模式里点链接、点图片、双击、悬停文献 */
  reading?: ReadingHooks;
}

export function features(hooks: { current: FeatureHooks }): Extension {
  return [
    tidyMarks,
    // 补全只在特定位置出现（公式里的 \），各个来源自己判断，正文里打字不会弹出
    autocompletion({ override: [mathCompletions, anchorCompletions], icons: false, addToOptions: [texPreviewOption], tooltipClass: () => "hm-ac", maxRenderedOptions: 40 }),
    sectionFolding(() => hooks.current.withPunct?.() ?? false),
    readingMode(() => hooks.current.reading),
  ];
}
