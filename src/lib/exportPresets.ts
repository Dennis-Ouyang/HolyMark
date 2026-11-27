/**
 * 导出的场景预设和按项目保存（G2）。
 * - 场景预设：学位论文、课程论文、投稿、打印稿，套用后照常可以再改；
 * - 导出设置（上次用的选项、自己存的预设）存在文件夹的 .holymark/export/options.json，
 *   不同文件夹互不覆盖；第一次打开时从以前存在浏览器里的全局设置迁移过来。
 */
import type { Backend } from "./backend";
import { cloneOpts, DEFAULT_OPTS, ExportOptions, loadSaved, normalizeOpts, Saved } from "./exporting";
import { join } from "./paths";

const H = (size: string, bold: "1" | "0" | "", align: "" | "left" | "center", num = "") => ({ font: "", size, bold, align, before: "", after: "", num, color: "black" as const });

/** 场景预设：在默认值（A4、黑色标题）上改这些项 */
export const SCENES: { id: string; name: string; hint: string; opts: Partial<ExportOptions> }[] = [
  {
    id: "thesis", name: "学位论文", hint: "A4，装订边 3 厘米，小四号、1.5 倍行距，章节自动编号，带目录和页码",
    opts: {
      paper: "A4", mt: "2.5", mb: "2.5", ml: "3", mr: "2.5", size: "12", lsMode: "multi", ls: "1.5", indent: "2", align: "justify",
      H: { 1: H("16", "1", "center", "第{一}章"), 2: H("14", "1", "left", "{1}.{2}"), 3: H("12", "1", "left", "{1}.{2}.{3}") },
      toc: true, footer: "{页码}", footerAlign: "center",
    },
  },
  {
    id: "course", name: "课程论文", hint: "A4 常规页边距，小四号、1.5 倍行距，首行缩进两字，页脚页码",
    opts: {
      paper: "A4", mt: "2.54", mb: "2.54", ml: "3.18", mr: "3.18", size: "12", lsMode: "multi", ls: "1.5", indent: "2", align: "justify",
      H: { 1: H("16", "1", "center"), 2: H("14", "1", "left"), 3: H("12", "1", "left") }, footer: "{页码}", footerAlign: "center",
    },
  },
  {
    id: "submit", name: "投稿", hint: "A4，五号、1.25 倍行距，紧凑的标题，批注不导出",
    opts: {
      paper: "A4", mt: "2.54", mb: "2.54", ml: "2.54", mr: "2.54", size: "10.5", lsMode: "multi", ls: "1.25", indent: "2", align: "justify",
      H: { 1: H("14", "1", "left"), 2: H("12", "1", "left"), 3: H("10.5", "1", "left") }, notes: "drop", footer: "{页码}", footerAlign: "center",
    },
  },
  {
    id: "print", name: "打印稿", hint: "A4 宽页边距，小四号、2 倍行距，方便纸上批改；页脚「第 x 页 / 共 y 页」",
    opts: {
      paper: "A4", mt: "2.54", mb: "2.54", ml: "3.5", mr: "3.5", size: "12", lsMode: "multi", ls: "2", indent: "2",
      H: { 1: H("16", "1", "center"), 2: H("14", "1", "left"), 3: H("12", "1", "left") },
      footer: "第 {页码} 页 / 共 {总页数} 页", footerAlign: "center", notes: "drop",
    },
  },
];

/** 套用场景：在默认值上改，格式不变 */
export function applyScene(id: string, fmt: ExportOptions["fmt"]): ExportOptions {
  const sc = SCENES.find((x) => x.id === id);
  return normalizeOpts({ ...cloneOpts(DEFAULT_OPTS), ...(sc ? sc.opts : {}), fmt });
}

const fileOf = (root: string) => join(root, ".holymark/export/options.json");

/** 读这个文件夹的导出设置；还没有时从以前的全局设置迁移 */
export async function loadProject(be: Backend, root: string): Promise<Saved> {
  if (root) {
    try {
      const s = JSON.parse(await be.readText(fileOf(root)));
      return { last: s.last && "fmt" in s.last ? normalizeOpts(s.last) : null, presets: Array.isArray(s.presets) ? s.presets : [] };
    } catch { /* 还没有，用全局的 */ }
  }
  return loadSaved();
}

let timer = 0;
/** 写进文件夹（防抖 600ms） */
export function saveProject(be: Backend, root: string, s: Saved) {
  if (!root) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => { be.writeText(fileOf(root), JSON.stringify(s, null, 2)).catch(() => {}); }, 600);
}
