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
}

export const DEFAULTS: Settings = {
  theme: "system",
  headingFont: "思源宋体",
  bodyFont: "思源宋体",
  fontSize: 17,
  lineHeight: 1.9,
  measure: 38,
  syntax: "active",
  countPunct: false,
  goalOn: false,
  goal: 8000,
  autoMinutes: 10,
  mergeSeconds: 5,
  lastFolder: "",
};

const KEY = "holymark-settings";
export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 隐私模式下忽略 */ }
}

const ALIAS: Record<string, string> = {
  "思源宋体": '"Noto Serif SC","Source Han Serif SC"', "Source Han Serif SC": '"Source Han Serif SC","Noto Serif SC"',
  "思源黑体": '"Noto Sans SC","Source Han Sans SC"', "Source Han Sans SC": '"Source Han Sans SC","Noto Sans SC"',
  "宋体": 'SimSun,"Songti SC",STSong', "黑体": 'SimHei,"Heiti SC",STHeiti', "楷体": 'KaiTi,STKaiti,"Kaiti SC"',
  "仿宋": "FangSong,STFangsong", "苹方": '"PingFang SC"', "微软雅黑": '"Microsoft YaHei"', "等线": "DengXian",
};
export const FONT_SUGGESTIONS = ["思源宋体", "思源黑体", "宋体", "黑体", "楷体", "仿宋", "苹方", "微软雅黑", "等线", "华文中宋", "Times New Roman", "Georgia", "Inter", "Helvetica Neue"];
const SERIF_HINT = /宋|仿宋|楷|Serif|Times|Georgia|Song|Ming/i;

/** 用户填的字体名 → CSS font-family。字体没装时退回到思源宋体/黑体。 */
export function fontStack(name: string): string {
  const head = ALIAS[name] || `"${name.replace(/"/g, "")}"`;
  return `${head},${SERIF_HINT.test(name) ? '"Songti SC","Noto Serif SC",serif' : '"PingFang SC","Noto Sans SC",sans-serif'}`;
}
