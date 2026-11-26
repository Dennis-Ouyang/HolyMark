/**
 * 新功能的编辑器扩展都从这里接进编辑器，Editor.tsx 里只多一个 extra 参数。
 * 需要和界面打交道的（打开链接、记住位置……）经由 hooks 对象回调，hooks 的内容可以随时换，扩展本身只建一次。
 */
import type { Extension } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import { tidyMarks } from "./tidyMarks";
import { mathCompletions, texPreviewOption } from "./mathComplete";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface FeatureHooks {}

export function features(_hooks: { current: FeatureHooks }): Extension {
  return [
    tidyMarks,
    // 补全只在特定位置出现（公式里的 \），各个来源自己判断，正文里打字不会弹出
    autocompletion({ override: [mathCompletions], icons: false, addToOptions: [texPreviewOption], tooltipClass: () => "hm-ac", maxRenderedOptions: 40 }),
  ];
}
