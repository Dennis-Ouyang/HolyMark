/**
 * N7 斜杠菜单的数据（纯函数）：菜单项来自命令注册表（段落类的标题、列表、引用，插入类的表格、图片……），
 * 按「段落与列表 / 插入 / 审阅」分组；中文、英文关键词、拼音首字母都能筛选（bg → 表格）。
 */
import { COMMANDS, CommandDef } from "./commandRegistry";

export type SlashGroup = "段落与列表" | "插入" | "审阅";
export const SLASH_GROUPS: SlashGroup[] = ["段落与列表", "插入", "审阅"];

export interface SlashItem { id: string; title: string; group: SlashGroup; icon: string; keywords: string }

/** 斜杠菜单里出现哪些命令、分在哪一组、用什么图标、英文关键词 */
const PICK: [string, SlashGroup, string, string][] = [
  ["block_h1", "段落与列表", "h1", "heading1 h1 title"],
  ["block_h2", "段落与列表", "h2", "heading2 h2"],
  ["block_h3", "段落与列表", "h3", "heading3 h3"],
  ["block_ul", "段落与列表", "ul", "bullet list ul"],
  ["block_ol", "段落与列表", "ol", "numbered list ol"],
  ["block_task", "段落与列表", "task", "todo task checkbox"],
  ["block_quote", "段落与列表", "quote", "quote blockquote"],
  ["insert_hr", "段落与列表", "hr", "hr divider line rule"],
  ["insert_table", "插入", "table", "table grid"],
  ["insert_image", "插入", "img", "image picture img photo"],
  ["insert_code", "插入", "codeb", "code codeblock"],
  ["insert_math", "插入", "mathb", "math formula latex equation"],
  ["insert_mermaid", "插入", "mermaid", "mermaid chart diagram flowchart"],
  ["cite", "插入", "cite", "link file cite reference bib"],
  ["note", "审阅", "note", "note comment annotate"],
];

/** 菜单里用的名字：注册表里「插入」下的叫法本来就不带动词（表格、图片…），去掉末尾的「…」 */
const title = (c: CommandDef) => c.title.replace(/…$/, "");

export function slashItems(commands: CommandDef[] = COMMANDS): SlashItem[] {
  const byId = new Map(commands.map((c) => [c.id, c]));
  return PICK.flatMap(([id, group, icon, en]) => {
    const c = byId.get(id);
    return c ? [{ id, title: title(c), group, icon, keywords: `${en} ${c.alias ?? ""}`.toLowerCase() }] : [];
  });
}

/* ---------- 拼音首字母：只需要菜单名字里出现的字 ---------- */
const PY: Record<string, string> = {
  标: "b", 题: "t", 无: "w", 序: "x", 列: "l", 表: "b", 有: "y", 任: "r", 务: "w", 引: "y", 用: "y", 分: "f", 隔: "g", 线: "x",
  格: "g", 图: "t", 片: "p", 代: "d", 码: "m", 块: "k", 公: "g", 式: "s", 文: "w", 件: "j", 链: "l", 接: "j", 或: "h", 献: "x",
  批: "p", 注: "z", 正: "z", 待: "d", 办: "b",
};
/** 「表格」→「bg」；不认识的字原样保留（字母、数字照常） */
export function initials(s: string): string {
  return [...s].map((c) => PY[c] ?? (/[A-Za-z0-9]/.test(c) ? c.toLowerCase() : "")).join("");
}

/** 筛选并排序：名字开头 > 名字里有 > 拼音首字母开头 > 关键词 */
export function filterSlash(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const score = (it: SlashItem) => {
    const t = it.title.toLowerCase();
    if (t.startsWith(q)) return 0;
    if (t.includes(q)) return 1;
    if (initials(it.title).startsWith(q)) return 2;
    if (it.keywords.split(/\s+/).some((k) => k.startsWith(q))) return 3;
    if (initials(it.title).includes(q)) return 4;
    return 9;
  };
  return items.map((it, i) => [score(it), i, it] as const).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , it]) => it);
}

/**
 * 光标前面是不是触发了斜杠菜单：行首（或者只有空格）是「/」或「、」，后面跟着已经输入的筛选词。
 * 返回斜杠的位置和筛选词；不是就返回 null。
 */
export function slashQuery(lineText: string, col: number): { at: number; query: string } | null {
  const m = lineText.slice(0, col).match(/^(\s*)([/、])([^\s/、]*)$/);
  return m ? { at: m[1].length, query: m[3] } : null;
}
