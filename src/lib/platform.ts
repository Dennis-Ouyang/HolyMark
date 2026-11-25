/** 平台判断与快捷键的显示方式。界面文案里统一写 Mac 的符号（⌘ ⇧ ⌥），在 Windows 上换成 Ctrl / Shift / Alt。 */
const ua = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent;
export const isMac = /Mac/i.test(ua);
export const isWindows = /Win/i.test(ua);

const WORD: Record<string, string> = { "⌘": "Ctrl", "⇧": "Shift", "⌥": "Alt" };

/** "⌘⇧X"、"⌘ ⇧ 8 / 7 / 9" 这类写法：Mac 上原样，其他平台写成 "Ctrl+Shift+X" */
export function kbd(s: string, mac = isMac): string {
  if (mac) return s;
  return s.replace(/([⌘⇧⌥])\s?/g, (_m, k: string) => WORD[k] + "+");
}

/** 按键数组（如 ["⌘", "S"]）里的单个键名 */
export function keyName(k: string, mac = isMac): string {
  return mac ? k : WORD[k] ?? k;
}
