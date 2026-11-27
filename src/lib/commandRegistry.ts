/**
 * 命令注册表（G6）：所有命令的唯一出处。
 * 菜单（macOS 原生菜单由它生成）、快捷键（Windows 和浏览器预览里前端按它分发）、⌘K 命令面板、
 * 帮助里的快捷键表、工具栏的悬停提示，都从这里读，不再各写一份。
 *
 * - 每条命令有类别（category）：斜杠菜单读「insert」类；帮助按类别分组。
 * - 快捷键能在运行时修改（setShortcut）：改完会通知订阅者（onShortcutsChange），macOS 上据此重建原生菜单。
 * - 命令做什么由 App 的 onMenu(id) 执行（注册表只是数据，不依赖 React）。
 */
import { isMac } from "./platform";

export type CommandCategory = "file" | "edit" | "paragraph" | "format" | "insert" | "view" | "help";

export const CATEGORY_TITLE: Record<CommandCategory, string> = {
  file: "文件", edit: "编辑", paragraph: "段落", format: "格式", insert: "插入", view: "视图", help: "帮助",
};

export interface CommandDef {
  id: string;
  /** 命令面板、菜单里的名字 */
  title: string;
  category: CommandCategory;
  /** 默认快捷键，写法如 "Mod+Shift+E"（Mod 在 macOS 是 ⌘、其他是 Ctrl） */
  keys?: string;
  /** 不在 ⌘K 里出现（比如撤销，交给编辑器） */
  hidden?: boolean;
  /** 菜单里在它前面画一条分隔线 */
  sepBefore?: boolean;
  /** 命令面板里的搜索别名 */
  alias?: string;
}

export const COMMANDS: CommandDef[] = [
  // 文件
  { id: "new_file", title: "新建文稿", category: "file", keys: "Mod+N" },
  { id: "open_folder", title: "打开文件夹…", category: "file", keys: "Mod+O" },
  { id: "close_folder", title: "关闭文件夹", category: "file" },
  { id: "save_version", title: "存档", category: "file", keys: "Mod+S", sepBefore: true, alias: "保存版本" },
  { id: "save_version_named", title: "保存版本并起名字…", category: "file" },
  { id: "compare_file", title: "与其他文稿对比…", category: "file" },
  { id: "export", title: "导出…", category: "file", keys: "Mod+Shift+E", sepBefore: true, alias: "Word PDF Markdown" },
  { id: "settings", title: "设置…", category: "file", keys: "Mod+," },
  { id: "quit", title: "退出 HolyMark", category: "file", hidden: true },
  // 编辑
  { id: "undo", title: "撤销", category: "edit", keys: "Mod+Z", hidden: true },
  { id: "redo", title: "重做", category: "edit", keys: "Mod+Shift+Z", hidden: true },
  { id: "find", title: "查找…", category: "edit", keys: "Mod+F", sepBefore: true, alias: "替换" },
  { id: "search", title: "搜索与命令…", category: "edit", keys: "Mod+K" },
  // 段落
  { id: "block_p", title: "正文", category: "paragraph", keys: "Mod+0" },
  { id: "block_h1", title: "标题 1", category: "paragraph", keys: "Mod+1" },
  { id: "block_h2", title: "标题 2", category: "paragraph", keys: "Mod+2" },
  { id: "block_h3", title: "标题 3", category: "paragraph", keys: "Mod+3" },
  { id: "block_h4", title: "标题 4", category: "paragraph", keys: "Mod+4" },
  { id: "block_h5", title: "标题 5", category: "paragraph", keys: "Mod+5" },
  { id: "block_h6", title: "标题 6", category: "paragraph", keys: "Mod+6" },
  { id: "heading_up", title: "提升标题级别", category: "paragraph", keys: "Mod+=" },
  { id: "heading_down", title: "降低标题级别", category: "paragraph", keys: "Mod+-" },
  { id: "block_quote", title: "引用", category: "paragraph", keys: "Mod+Shift+.", sepBefore: true },
  { id: "block_ul", title: "无序列表", category: "paragraph", keys: "Mod+Shift+8" },
  { id: "block_ol", title: "有序列表", category: "paragraph", keys: "Mod+Shift+7" },
  { id: "block_task", title: "待办列表", category: "paragraph", keys: "Mod+Shift+9" },
  { id: "indent", title: "增加缩进", category: "paragraph", keys: "Mod+]" },
  { id: "outdent", title: "减少缩进", category: "paragraph", keys: "Mod+[" },
  // 插入（斜杠菜单读这一类）
  { id: "insert_table", title: "表格", category: "insert", alias: "插入表格" },
  { id: "insert_code", title: "代码块", category: "insert", keys: "Mod+Alt+C", alias: "插入代码块" },
  { id: "insert_math", title: "公式块", category: "insert", keys: "Mod+Alt+B", alias: "插入公式 LaTeX" },
  { id: "insert_mermaid", title: "图表（Mermaid）", category: "insert", alias: "插入流程图" },
  { id: "insert_image", title: "图片…", category: "insert", keys: "Mod+Shift+I", alias: "插入图片" },
  { id: "insert_hr", title: "分隔线", category: "insert", alias: "插入分隔线" },
  { id: "cite", title: "文件链接或文献…", category: "insert", keys: "Mod+Shift+C", alias: "插入文件链接 引用" },
  { id: "note", title: "批注", category: "insert", keys: "Mod+Alt+M", alias: "添加批注" },
  // 格式
  { id: "bold", title: "粗体", category: "format", keys: "Mod+B" },
  { id: "italic", title: "斜体", category: "format", keys: "Mod+I" },
  { id: "strike", title: "删除线", category: "format", keys: "Mod+Shift+X" },
  { id: "code", title: "行内代码", category: "format", keys: "Mod+E" },
  { id: "math", title: "行内公式", category: "format", keys: "Mod+Shift+M" },
  { id: "highlight", title: "高亮", category: "format", keys: "Mod+Shift+H" },
  { id: "sup", title: "上标", category: "format" },
  { id: "sub", title: "下标", category: "format" },
  { id: "link", title: "链接", category: "format", keys: "Mod+Shift+K", sepBefore: true },
  // 视图
  { id: "toggle_side", title: "显示 / 隐藏侧栏", category: "view", keys: "Mod+\\" },
  { id: "toggle_panel", title: "显示 / 隐藏右栏", category: "view", keys: "Mod+/" },
  { id: "toggle_ribbon", title: "折叠 / 展开功能区", category: "view", keys: "Mod+Alt+R" },
  { id: "focus", title: "专注模式", category: "view", keys: "Mod+Shift+F" },
  { id: "panel_outline", title: "目录", category: "view", keys: "Mod+Alt+1", sepBefore: true },
  { id: "panel_notes", title: "批注列表", category: "view", keys: "Mod+Alt+2" },
  { id: "panel_versions", title: "版本", category: "view", keys: "Mod+Alt+3" },
  { id: "toggle_syntax", title: "始终显示 Markdown 符号", category: "view", sepBefore: true },
  // 帮助
  { id: "help_syntax", title: "Markdown 语法速查", category: "help" },
  { id: "help_keys", title: "快捷键", category: "help" },
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));
export const command = (id: string) => byId.get(id);
export const commandsIn = (cat: CommandCategory) => COMMANDS.filter((c) => c.category === cat);

/* ---------------- 运行时可改的快捷键 ---------------- */

const overrides = new Map<string, string | null>();
const listeners = new Set<() => void>();
/** 改一条命令的快捷键（null 表示不要快捷键）；会通知订阅者（重建原生菜单、刷新提示） */
export function setShortcut(id: string, keys: string | null) { overrides.set(id, keys); listeners.forEach((f) => f()); }
export function resetShortcuts() { overrides.clear(); listeners.forEach((f) => f()); }
export function onShortcutsChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export function shortcutOf(id: string): string | undefined {
  if (overrides.has(id)) return overrides.get(id) ?? undefined;
  return byId.get(id)?.keys;
}

/* ---------------- 按键 → 命令 ---------------- */

const CODE: Record<string, string> = { ",": "Comma", ".": "Period", "/": "Slash", "\\": "Backslash", "[": "BracketLeft", "]": "BracketRight", "=": "Equal", "-": "Minus" };
/** 按物理键位比较（e.code），这样 Shift、Alt 改变了字符也不影响 */
function codeOf(k: string) {
  if (/^[A-Z]$/i.test(k)) return "Key" + k.toUpperCase();
  if (/^\d$/.test(k)) return "Digit" + k;
  return CODE[k] ?? k;
}
interface Combo { mod: boolean; shift: boolean; alt: boolean; code: string }
export function parseKeys(s: string): Combo {
  const parts = s.split("+");
  const key = s.endsWith("++") ? "+" : parts[parts.length - 1];
  return { mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), code: codeOf(key) };
}

/** 这个按键对应的命令 id；没有时返回 null。撤销、重做交给编辑器和系统，不在这里分发 */
export function commandForKey(e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac = isMac): string | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mac ? e.ctrlKey : e.metaKey) return null; // Windows 上 Ctrl 和 Mac 上 ⌘ 是一回事；另一个修饰键按着就不算
  for (const c of COMMANDS) {
    if (c.id === "undo" || c.id === "redo") continue;
    const k = shortcutOf(c.id);
    if (!k) continue;
    const p = parseKeys(k);
    if (p.code === e.code && p.mod === mod && p.shift === e.shiftKey && p.alt === e.altKey) return c.id;
  }
  return null;
}

/* ---------------- 显示 ---------------- */

const MAC_SYM: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" };
const WIN_NAME: Record<string, string> = { Mod: "Ctrl", Shift: "Shift", Alt: "Alt", Ctrl: "Ctrl" };
/** 键帽：macOS 是 ["⌘", "⇧", "E"]，其他是 ["Ctrl", "Shift", "E"] */
export function keyCaps(keys: string, mac = isMac): string[] {
  const parts = keys.endsWith("++") ? [...keys.slice(0, -2).split("+"), "+"] : keys.split("+");
  return parts.map((p) => (MAC_SYM[p] ? (mac ? MAC_SYM[p] : WIN_NAME[p]) : p.length === 1 ? p.toUpperCase() : p));
}
/** 一段文字形式：macOS「⌘⇧E」，其他「Ctrl+Shift+E」 */
export function keyText(keys: string | undefined, mac = isMac): string {
  if (!keys) return "";
  const caps = keyCaps(keys, mac);
  return mac ? caps.join("") : caps.join("+");
}
/** 悬停提示：「名字 ⌘⇧E」 */
export function tipOf(id: string, title?: string): string {
  const c = byId.get(id);
  const k = keyText(shortcutOf(id));
  return `${title ?? c?.title ?? id}${k ? " " + k : ""}`;
}

/** macOS 原生菜单的加速键写法（Tauri）："CmdOrCtrl+Shift+E" */
export const accelOf = (keys: string | undefined) => (keys ? keys.replace(/^Mod\+|\+Mod\+/g, (m) => m.replace("Mod", "CmdOrCtrl")) : null);

/** 给 Rust 重建原生菜单用的描述：按类别分组 */
export function menuSpec() {
  return (Object.keys(CATEGORY_TITLE) as CommandCategory[]).map((cat) => ({
    key: cat,
    title: CATEGORY_TITLE[cat],
    items: commandsIn(cat).filter((c) => c.id !== "quit" && c.id !== "settings").map((c) => ({ id: c.id, label: c.title, accel: accelOf(shortcutOf(c.id)), sepBefore: !!c.sepBefore })),
  }));
}
