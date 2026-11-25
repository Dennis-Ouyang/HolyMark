/**
 * 菜单快捷键。macOS 上由原生菜单（src-tauri/src/menu.rs）处理；Windows 和浏览器预览里没有原生菜单，
 * 由前端按这张表把按键翻译成同样的菜单 id。两边的按键要保持一致。
 * 撤销、重做、剪切、复制、粘贴、全选交给编辑器和系统，不在这里。
 */
import { isMac } from "./platform";

export const SHORTCUTS: [string, string][] = [
  ["Mod+,", "settings"],
  ["Mod+N", "new_file"],
  ["Mod+O", "open_folder"],
  ["Mod+S", "save_version"],
  ["Mod+Shift+E", "export"],
  ["Mod+F", "find"],
  ["Mod+K", "search"],
  ["Mod+0", "block_p"],
  ["Mod+1", "block_h1"],
  ["Mod+2", "block_h2"],
  ["Mod+3", "block_h3"],
  ["Mod+Shift+.", "block_quote"],
  ["Mod+Shift+8", "block_ul"],
  ["Mod+Shift+7", "block_ol"],
  ["Mod+Shift+9", "block_task"],
  ["Mod+Alt+C", "insert_code"],
  ["Mod+Alt+B", "insert_math"],
  ["Mod+Shift+I", "insert_image"],
  ["Mod+B", "bold"],
  ["Mod+I", "italic"],
  ["Mod+Shift+X", "strike"],
  ["Mod+E", "code"],
  ["Mod+Shift+M", "math"],
  ["Mod+Shift+K", "link"],
  ["Mod+Shift+C", "cite"],
  ["Mod+Alt+M", "note"],
  ["Mod+\\", "toggle_side"],
  ["Mod+/", "toggle_panel"],
  ["Mod+Alt+R", "toggle_ribbon"],
  ["Mod+Shift+F", "focus"],
  ["Mod+Alt+1", "panel_outline"],
  ["Mod+Alt+2", "panel_notes"],
  ["Mod+Alt+3", "panel_versions"],
];

const CODE: Record<string, string> = { ",": "Comma", ".": "Period", "/": "Slash", "\\": "Backslash" };
/** 按物理键位比较（e.code），这样 Shift、Alt 改变了字符也不影响 */
function codeOf(k: string) {
  if (/^[A-Z]$/.test(k)) return "Key" + k;
  if (/^\d$/.test(k)) return "Digit" + k;
  return CODE[k] ?? k;
}

interface Combo { mod: boolean; shift: boolean; alt: boolean; code: string; id: string }
const COMBOS: Combo[] = SHORTCUTS.map(([s, id]) => {
  const parts = s.split("+");
  const key = s.endsWith("++") ? "+" : parts[parts.length - 1];
  return { mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), code: codeOf(key), id };
});

/** 这个按键对应的菜单 id；没有对应时返回 null */
export function menuIdFor(e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac = isMac): string | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  // Windows 上 Ctrl 和 Mac 上 ⌘ 是一回事；另一个修饰键按着就不算
  if (mac ? e.ctrlKey : e.metaKey) return null;
  const c = COMBOS.find((x) => x.code === e.code && x.mod === mod && x.shift === e.shiftKey && x.alt === e.altKey);
  return c ? c.id : null;
}
