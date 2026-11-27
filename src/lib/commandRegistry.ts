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
  /** 开关类命令打开时，⌘K 里显示的名字（如「退出阅读模式」） */
  onTitle?: string;
  /** 只在 ⌘K 里显示的名字（菜单里在「插入」下面不必带动词，⌘K 里写全） */
  paletteTitle?: string;
  /** 快捷键由功能自己处理（返回 / 前进要看有没有历史）：不挂原生菜单加速键，也不经前端统一分发，只在快捷键表和提示里显示 */
  ownKeys?: boolean;
  /** ⌘K 里的说明 */
  sub?: string;
  /** 只在 ⌘K 里出现（有条件才用得上，不放进菜单） */
  paletteOnly?: boolean;
}

export const COMMANDS: CommandDef[] = [
  // 文件
  { id: "new_file", title: "新建文稿", category: "file", keys: "Mod+N" },
  { id: "open_folder", title: "打开文件夹…", category: "file", keys: "Mod+O" },
  { id: "close_folder", title: "关闭文件夹", category: "file" },
  { id: "save_version", title: "存档", category: "file", keys: "Mod+S", sepBefore: true, alias: "保存版本" },
  { id: "save_version_named", title: "保存版本并起名字…", category: "file" },
  { id: "compare_file", title: "与其他文稿对比…", category: "file" },
  { id: "import_docx", title: "从 Word 导入…", category: "file", alias: "docx 转换", sepBefore: true },
  { id: "export", title: "导出…", category: "file", keys: "Mod+Shift+E", sepBefore: true, alias: "Word PDF Markdown" },
  { id: "settings", title: "设置…", category: "file", keys: "Mod+," },
  { id: "quit", title: "退出 HolyMark", category: "file", hidden: true },
  // 编辑
  { id: "undo", title: "撤销", category: "edit", keys: "Mod+Z", hidden: true },
  { id: "redo", title: "重做", category: "edit", keys: "Mod+Shift+Z", hidden: true },
  { id: "find", title: "查找…", category: "edit", keys: "Mod+F", sepBefore: true, alias: "替换" },
  { id: "search", title: "搜索与命令…", category: "edit", keys: "Mod+K" },
  { id: "folder_replace", title: "在文件夹里替换…", category: "edit", keys: "Mod+Alt+F", alias: "查找替换 批量" },
  { id: "tidy", title: "中文排版整理", category: "edit", sepBefore: true, sub: "选中的文字或全文", alias: "标点 空格 引号" },
  { id: "copy_rich", title: "复制为带格式的文字（Word、邮件）", category: "edit", sub: "选中的文字或全文；公式用 MathML", alias: "富文本" },
  { id: "copy_wechat", title: "复制为带格式的文字（公众号）", category: "edit", sub: "选中的文字或全文；公式转成图片", alias: "富文本 微信" },
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
  { id: "math_symbols", title: "打开公式符号面板…", category: "insert", alias: "LaTeX 希腊字母 运算符" },
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
  { id: "reading", title: "阅读模式", onTitle: "退出阅读模式", category: "view", keys: "Mod+Shift+R" },
  { id: "nav_back", title: "返回", category: "view", keys: isMac ? "Ctrl+Mod+Left" : "Alt+Left", ownKeys: true, sepBefore: true },
  { id: "nav_forward", title: "前进", category: "view", keys: isMac ? "Ctrl+Mod+Right" : "Alt+Right", ownKeys: true },
  { id: "fold_all", title: "折叠全部章节", category: "view", sepBefore: true },
  { id: "unfold_all", title: "展开全部章节", category: "view" },
  { id: "fold_h2", title: "折叠到二级标题", category: "view", sub: "只显示一、二级标题" },
  { id: "typewriter", title: "打字机滚动", onTitle: "关闭打字机滚动", category: "view", sepBefore: true },
  { id: "para_focus", title: "段落聚焦", onTitle: "关闭段落聚焦", category: "view" },
  { id: "paper_default", title: "纸张底色：默认", category: "view" },
  { id: "paper_cream", title: "纸张底色：米白", category: "view" },
  { id: "paper_gray", title: "纸张底色：护眼灰", category: "view" },
  { id: "close_preview", title: "关闭预览，回到正文", category: "view", keys: "Escape", ownKeys: true, paletteOnly: true },
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
/** 用户改过的快捷键（存进设置用）：{ 命令 id: 按键或 null（不要快捷键） } */
export function customShortcuts(): Record<string, string | null> { return Object.fromEntries(overrides); }
/** 启动时从设置里恢复（不和默认值一样的才记）；会通知订阅者 */
export function loadShortcuts(map: Record<string, string | null> | undefined) {
  overrides.clear();
  for (const [id, k] of Object.entries(map ?? {})) if (byId.has(id) && (k ?? undefined) !== byId.get(id)!.keys) overrides.set(id, k);
  listeners.forEach((f) => f());
}
export const isCustomShortcut = (id: string) => overrides.has(id);
/** 恢复一条命令的默认快捷键 */
export function resetShortcut(id: string) { overrides.delete(id); listeners.forEach((f) => f()); }
export function shortcutOf(id: string): string | undefined {
  if (overrides.has(id)) return overrides.get(id) ?? undefined;
  return byId.get(id)?.keys;
}

/* ---------------- 按键 → 命令 ---------------- */

const CODE: Record<string, string> = { ",": "Comma", ".": "Period", "/": "Slash", "\\": "Backslash", "[": "BracketLeft", "]": "BracketRight", "=": "Equal", "-": "Minus", Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown" };
/** 按物理键位比较（e.code），这样 Shift、Alt 改变了字符也不影响 */
function codeOf(k: string) {
  if (/^[A-Z]$/i.test(k)) return "Key" + k.toUpperCase();
  if (/^\d$/.test(k)) return "Digit" + k;
  return CODE[k] ?? k;
}
interface Combo { mod: boolean; shift: boolean; alt: boolean; ctrl: boolean; code: string }
export function parseKeys(s: string): Combo {
  const parts = s.split("+");
  const key = s.endsWith("++") ? "+" : parts[parts.length - 1];
  return { mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), ctrl: parts.includes("Ctrl"), code: codeOf(key) };
}

const sameKeys = (a: string, b: string) => { const x = parseKeys(a), y = parseKeys(b); return x.code === y.code && x.mod === y.mod && x.shift === y.shift && x.alt === y.alt && x.ctrl === y.ctrl; };
/** 这组按键已经给了哪条命令（不算 except 自己） */
export function commandWithKeys(keys: string, except?: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.id !== except && !c.paletteOnly && shortcutOf(c.id) && sameKeys(shortcutOf(c.id)!, keys));
}

/** 留给系统和编辑器的组合：拷贝、粘贴、剪切、全选、撤销、重做、退出、关窗口、隐藏、最小化 */
const RESERVED = ["Mod+C", "Mod+V", "Mod+X", "Mod+A", "Mod+Z", "Mod+Shift+Z", "Mod+Y", "Mod+Q", "Mod+W", "Mod+H", "Mod+M"];
export const isReservedKeys = (keys: string) => RESERVED.some((r) => sameKeys(r, keys));

const CODE_KEY: Record<string, string> = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));
/**
 * 按下的组合键 → 注册表的写法（"Mod+Shift+E"）。只按了修饰键、或者没有修饰键（F1–F12 除外）时返回 null。
 * Windows 上按着 Win 键的不算。
 */
export function keysFromEvent(e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac = isMac): string | null {
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else key = CODE_KEY[e.code];
  if (!key) return null;
  if (!mac && e.metaKey) return null;
  const mod = mac ? e.metaKey : e.ctrlKey, ctrl = mac && e.ctrlKey;
  if (!mod && !ctrl && !e.altKey && !/^F\d/.test(key)) return null;
  return [ctrl && "Ctrl", mod && "Mod", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

/** 按键是不是这一组快捷键（按物理键位；Mod 在 macOS 是 ⌘、其他是 Ctrl） */
export function matchKeys(e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, keys: string, mac = isMac): boolean {
  const p = parseKeys(keys);
  const mod = mac ? e.metaKey : e.ctrlKey;
  const ctrl = mac ? e.ctrlKey : false;
  if (!mac && e.metaKey) return false;
  return p.code === e.code && p.mod === mod && p.shift === e.shiftKey && p.alt === e.altKey && p.ctrl === (mac ? ctrl : p.ctrl && e.ctrlKey);
}

/** 这个按键对应的命令 id；没有时返回 null。撤销、重做交给编辑器和系统，不在这里分发 */
export function commandForKey(e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac = isMac): string | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mac ? e.ctrlKey : e.metaKey) return null; // Windows 上 Ctrl 和 Mac 上 ⌘ 是一回事；另一个修饰键按着就不算
  for (const c of COMMANDS) {
    if (c.id === "undo" || c.id === "redo" || c.ownKeys) continue;
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
const ARROW: Record<string, string> = { Left: "←", Right: "→", Up: "↑", Down: "↓", Escape: "Esc" };
/** 键帽：macOS 是 ["⌘", "⇧", "E"]，其他是 ["Ctrl", "Shift", "E"] */
export function keyCaps(keys: string, mac = isMac): string[] {
  const parts = keys.endsWith("++") ? [...keys.slice(0, -2).split("+"), "+"] : keys.split("+");
  const caps = parts.map((p) => (MAC_SYM[p] ? (mac ? MAC_SYM[p] : WIN_NAME[p]) : ARROW[p] ?? (p.length === 1 ? p.toUpperCase() : p)));
  // macOS 习惯把 ⌃ 写在最前面（⌃⌘←）
  return mac && caps.includes("⌃") ? ["⌃", ...caps.filter((c) => c !== "⌃")] : caps;
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

/**
 * 正在设置页里录新的快捷键：macOS 的原生菜单会先接住按键（按下 ⌘⇧E 就导出了），
 * 所以录的时候把菜单的加速键都先摘掉，录完再挂回去（订阅者会重建菜单）
 */
let recording = false;
export function setKeyRecording(on: boolean) { if (recording !== on) { recording = on; listeners.forEach((f) => f()); } }

/** 给 Rust 重建原生菜单用的描述：按类别分组 */
export function menuSpec() {
  return (Object.keys(CATEGORY_TITLE) as CommandCategory[]).map((cat) => ({
    key: cat,
    title: CATEGORY_TITLE[cat],
    items: commandsIn(cat).filter((c) => c.id !== "quit" && c.id !== "settings" && !c.paletteOnly).map((c) => ({ id: c.id, label: c.title, accel: c.ownKeys || recording ? null : accelOf(shortcutOf(c.id)), sepBefore: !!c.sepBefore })),
  }));
}
