/**
 * 菜单快捷键：macOS 上由原生菜单处理；Windows 和浏览器预览里没有原生菜单，由前端把按键翻译成同样的命令 id。
 * 按键表在命令注册表（commandRegistry.ts）里，这里只保留原来的入口。
 */
import { isMac } from "./platform";
import { commandForKey, COMMANDS, shortcutOf } from "./commandRegistry";

/** [按键, 命令 id]，由注册表生成（含运行时改过的快捷键）；功能自己处理按键的（返回、前进）不算 */
export const SHORTCUTS = (): [string, string][] => COMMANDS.flatMap((c) => { const k = shortcutOf(c.id); return k && !c.ownKeys && c.id !== "undo" && c.id !== "redo" ? [[k, c.id] as [string, string]] : []; });

/** 这个按键对应的菜单 id；没有对应时返回 null */
export function menuIdFor(e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac = isMac): string | null {
  return commandForKey(e, mac);
}
