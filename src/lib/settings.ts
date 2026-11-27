/** 应用设置（所有文件的默认值）。单篇文件的版式写在它自己的属性区里，优先级更高。 */
import { isWindows } from "./platform";
import { TIDY_DEFAULTS, TidyRules } from "./tidy";

export interface Settings {
  theme: "system" | "light" | "dark";
  /** 主题色（按钮、选中、光标的颜色） */
  accent: AccentName;
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
  /** 行间公式右侧显示编号 (1) (2) … */
  eqNumbers: boolean;
  /** 启动时自动打开上次的文件夹；关掉就从开始页开始 */
  reopenLast: boolean;
  /** 最近打开的文件夹，最新的在前 */
  recentFolders: string[];
  ribbonCollapsed: boolean;
  /** 文件树里是否显示 Markdown 以外的文件 */
  showAllFiles: boolean;
  /** 正文区的纸张底色（只作用于正文区，界面外框不变） */
  paper: "default" | "cream" | "gray";
  /** 打字机滚动：打字时把光标所在行保持在屏幕高度的 45% 左右 */
  typewriter: boolean;
  /** 段落聚焦：光标所在的段落正常显示，其余段落变淡 */
  paraFocus: boolean;
  /** 从访达 / 资源管理器单独打开的文件默认用阅读模式 */
  externalReading: boolean;
  /** 中文排版整理的规则 */
  tidy: TidyRules;
  /** ⌘N 新建的文稿放在当前文稿旁边，还是文件夹最外层 */
  newDocPlace: "current" | "root";
  /** 粘贴、拖进来的图片存在文稿旁边的哪个文件夹 */
  imageDir: string;
  /** 左栏、右栏的宽度（可拖动调整，双击拖拽线恢复默认） */
  sideWidth: number;
  panelWidth: number;
  /** 批注署名：加批注时写在作者处，导出到 Word 后对方看到的名字。空着时第一次启动用系统用户名填上 */
  noteAuthor: string;
  /** 设置格式版本，用来迁移旧的默认值 */
  v: number;
}

/** 默认字体用系统自带的：macOS 苹方，Windows 微软雅黑 */
const UI_FONT = isWindows ? "Microsoft YaHei" : "PingFang SC";

export const DEFAULTS: Settings = {
  theme: "system",
  accent: "indigo",
  headingFont: UI_FONT,
  bodyFont: UI_FONT,
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
  recentFolders: [],
  reopenLast: true,
  eqNumbers: false,
  ribbonCollapsed: false,
  showAllFiles: false,
  tidy: TIDY_DEFAULTS,
  externalReading: true,
  paper: "default",
  typewriter: false,
  paraFocus: false,
  noteAuthor: "",
  newDocPlace: "current",
  imageDir: "assets",
  sideWidth: 248,
  panelWidth: 300,
  v: 2,
};

/** 主题色预设：[主色, 文字和图标用的深一点的色]，浅色和深色界面各一套 */
export const ACCENTS = {
  indigo: { name: "靛蓝", light: ["#5A62DE", "#4148C4"], dark: ["#7D84F4", "#B9BDFA"] },
  blue: { name: "海蓝", light: ["#2F6FEB", "#1F5AC8"], dark: ["#5B93F5", "#A9C8FB"] },
  teal: { name: "青碧", light: ["#0F858A", "#0B6C70"], dark: ["#38BDB6", "#9FE3DC"] },
  green: { name: "松绿", light: ["#2C8A56", "#216F45"], dark: ["#4CC38A", "#A6E5C4"] },
  amber: { name: "琥珀", light: ["#C46F09", "#9C5806"], dark: ["#E9A23B", "#F5D29A"] },
  red: { name: "朱砂", light: ["#D1453A", "#AE352B"], dark: ["#F0736A", "#F8B9B3"] },
  rose: { name: "胭脂", light: ["#C83E78", "#A82F62"], dark: ["#EE72A6", "#F8BBD5"] },
  purple: { name: "紫藤", light: ["#8653E6", "#6C3BCB"], dark: ["#A78BFA", "#D6C8FD"] },
  graphite: { name: "石墨", light: ["#4A4F5C", "#2F333D"], dark: ["#8D93A1", "#D5D8DF"] },
} as const;
export type AccentName = keyof typeof ACCENTS;

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
/** 把主题色写到根元素上，覆盖样式表里的默认靛蓝 */
export function applyAccent(name: AccentName, dark: boolean) {
  const a = ACCENTS[name] ?? ACCENTS.indigo;
  const [c, fg] = dark ? a.dark : a.light;
  const st = document.documentElement.style;
  st.setProperty("--accent", c);
  st.setProperty("--accent-fg", fg);
  st.setProperty("--accent-soft", rgba(c, dark ? 0.16 : 0.1));
  st.setProperty("--accent-line", rgba(c, dark ? 0.45 : 0.4));
}

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
  const out = { ...DEFAULTS, ...saved, v: 2 };
  // 嵌套的设置：新加的规则用默认值
  out.tidy = { ...TIDY_DEFAULTS, ...(saved.tidy || {}) };
  if (!(out.accent in ACCENTS)) out.accent = "indigo";
  return out;
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 隐私模式下忽略 */ }
}

/**
 * 字体组合预设：选了只是一次性填好标题字体和正文字体，之后还能单独改。
 * 名字用本平台的字体，另一个平台上打开同一份设置时，fontStack 按 EQUIV 换成对应的字体。
 */
export const FONT_PRESETS: { id: string; name: string; heading: string; body: string }[] = [
  { id: "song", name: "宋体阅读", heading: UI_FONT, body: isWindows ? "SimSun" : "Songti SC" },
  { id: "hei", name: "黑体写作", heading: UI_FONT, body: UI_FONT },
  { id: "kai", name: "楷体", heading: isWindows ? "KaiTi" : "Kaiti SC", body: isWindows ? "KaiTi" : "Kaiti SC" },
];

/** 第一版设置里用过的中文名 → 系统字体家族名 */
const ALIAS: Record<string, string> = {
  "思源宋体": "Noto Serif SC", "思源黑体": "Noto Sans SC", "宋体": isWindows ? "SimSun" : "Songti SC", "黑体": isWindows ? "SimHei" : "Heiti SC",
  "楷体": isWindows ? "KaiTi" : "Kaiti SC", "仿宋": isWindows ? "FangSong" : "STFangsong", "苹方": "PingFang SC", "微软雅黑": "Microsoft YaHei", "等线": "DengXian",
};

/**
 * 同一类字体在 macOS 和 Windows 上的对应。文件属性区里写的是哪个系统的字体名都行，
 * 在另一个系统上打开时自动用对应的字体，而不是退回到浏览器默认字体。
 */
const EQUIV: string[][] = [
  ["PingFang SC", "Microsoft YaHei", "Noto Sans SC"],
  ["Songti SC", "SimSun", "Noto Serif SC"],
  ["Heiti SC", "SimHei", "Microsoft YaHei"],
  ["Kaiti SC", "KaiTi", "STKaiti"],
  ["STFangsong", "FangSong", "STFangsong"],
  ["Hiragino Sans GB", "Microsoft YaHei"],
  ["Helvetica Neue", "Segoe UI", "Arial"],
  ["New York", "Georgia"],
  ["SF Pro Text", "Segoe UI"],
];
const SERIF = /song|serif|ming|kai|fangsong|times|georgia|palatino|garamond|new york|iowan|baskerville|simsun|宋|楷|仿宋|明/i;

/** 同类字体在另一个系统上的名字（不含自己），给导出 PDF 的字体列表用 */
export function fontFallbacks(name: string): string[] {
  const n = (ALIAS[name] || name).toLowerCase();
  const g = EQUIV.find((x) => x.some((f) => f.toLowerCase() === n));
  return g ? g.filter((f) => f.toLowerCase() !== n) : [];
}

const GENERIC = new Set(["-apple-system", "serif", "sans-serif", "monospace"]);
const q = (f: string) => (GENERIC.has(f) ? f : `"${f.replace(/"/g, "")}"`);

/** 字体家族名 → CSS font-family，带合适的回退：字体没装时用另一个系统上的对应字体，再退回到系统的宋体或黑体 */
export function fontStack(name: string): string {
  const n = ALIAS[name] || name;
  const sans = ["-apple-system", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "sans-serif"];
  if (!n) return sans.map(q).join(",");
  const fallback = SERIF.test(n) ? ["Songti SC", "SimSun", "Noto Serif SC", "serif"] : sans;
  const same = EQUIV.find((g) => g.some((f) => f.toLowerCase() === n.toLowerCase())) ?? [];
  const seen = new Set<string>();
  return [n, ...same, ...fallback].filter((f) => !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase())).map(q).join(",");
}
