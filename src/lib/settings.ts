/** 应用设置（所有文件的默认值）。单篇文件的版式写在它自己的属性区里，优先级更高。 */
export interface Settings {
  theme: "system" | "light" | "dark";
  headingFont: string;
  bodyFont: string;
  fontSize: number;
  lineHeight: number;
  measure: number;
  syntax: "active" | "always";
  countPunct: boolean;
  goalOn: boolean;
  goal: number;
  autoMinutes: number;
  mergeSeconds: number;
  lastFolder: string;
  ribbonCollapsed: boolean;
  /** 文件树里是否显示 Markdown 以外的文件 */
  showAllFiles: boolean;
  /** 设置格式版本，用来迁移旧的默认值 */
  v: number;
}

export const DEFAULTS: Settings = {
  theme: "system",
  headingFont: "PingFang SC",
  bodyFont: "PingFang SC",
  fontSize: 16,
  lineHeight: 1.75,
  measure: 40,
  syntax: "active",
  countPunct: false,
  goalOn: false,
  goal: 8000,
  autoMinutes: 10,
  mergeSeconds: 5,
  lastFolder: "",
  ribbonCollapsed: false,
  showAllFiles: false,
  v: 2,
};

const KEY = "holymark-settings";
export function loadSettings(): Settings {
  let saved: Partial<Settings> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { /* 读不到就用默认值 */ }
  if ((saved.v ?? 1) < 2) {
    // 第一版的默认排版（思源宋体 17px）换成新默认；用户自己改过的值保留
    if (saved.headingFont === "思源宋体") delete saved.headingFont;
    if (saved.bodyFont === "思源宋体") delete saved.bodyFont;
    if (saved.fontSize === 17) delete saved.fontSize;
    if (saved.lineHeight === 1.9) delete saved.lineHeight;
    if (saved.measure === 38) delete saved.measure;
  }
  return { ...DEFAULTS, ...saved, v: 2 };
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 隐私模式下忽略 */ }
}

/** 第一版设置里用过的中文名 → 系统字体家族名 */
const ALIAS: Record<string, string> = {
  "思源宋体": "Noto Serif SC", "思源黑体": "Noto Sans SC", "宋体": "Songti SC", "黑体": "Heiti SC",
  "楷体": "Kaiti SC", "仿宋": "STFangsong", "苹方": "PingFang SC", "微软雅黑": "Microsoft YaHei", "等线": "DengXian",
};
const SERIF = /song|serif|ming|kai|fangsong|times|georgia|palatino|garamond|new york|iowan|baskerville|宋|楷|仿宋|明/i;

/** 字体家族名 → CSS font-family，带合适的回退：字体没装时退回到系统的宋体或苹方 */
export function fontStack(name: string): string {
  const n = ALIAS[name] || name;
  if (!n) return '-apple-system,"PingFang SC",sans-serif';
  const fallback = SERIF.test(n) ? '"Songti SC","Noto Serif SC",serif' : '-apple-system,"PingFang SC","Noto Sans SC",sans-serif';
  return `"${n.replace(/"/g, "")}",${fallback}`;
}
