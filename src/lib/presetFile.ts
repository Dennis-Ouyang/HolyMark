/**
 * N16 导出预设文件（纯函数）：一个 JSON 文件带走整套导出样式。
 * 参考文档（.docx）和引用样式（.csl）用 base64 内嵌进去，别人导入时解出来放进自己文件夹的 .holymark/export/。
 * 文件扩展名、叫法先用 .json / 「导出预设」，交给产品负责人定。
 */
import type { ExportOptions } from "./exporting";

export interface EmbeddedFile { name: string; data: string }
export interface PresetFile {
  name: string;
  opts: ExportOptions;
  files: { ref?: EmbeddedFile; csl?: EmbeddedFile };
}

const MAGIC = "holymark-export-preset";

/** 写成文件：opts 里参考文档、引用样式的路径换成内嵌文件 */
export function packPreset(name: string, opts: ExportOptions, files: PresetFile["files"]): string {
  const o = { ...opts, ref: files.ref ? "" : opts.ref, csl: files.csl ? "" : opts.csl };
  return JSON.stringify({ format: MAGIC, version: 1, name, opts: o, files }, null, 2) + "\n";
}

/** 读预设文件；不是预设文件时返回给人看的原因 */
export function parsePreset(text: string): PresetFile | string {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return "这不是 HolyMark 的导出预设文件"; }
  const x = j as { format?: string; version?: number; name?: unknown; opts?: unknown; files?: Record<string, unknown> };
  if (!x || x.format !== MAGIC || typeof x.opts !== "object" || !x.opts) return "这不是 HolyMark 的导出预设文件";
  if ((x.version ?? 1) > 1) return "这个预设文件来自更新的 HolyMark，请先更新";
  const okFile = (f: unknown): f is EmbeddedFile => !!f && typeof (f as EmbeddedFile).name === "string" && typeof (f as EmbeddedFile).data === "string" && /^[A-Za-z0-9+/=\s]*$/.test((f as EmbeddedFile).data);
  const files: PresetFile["files"] = {};
  if (okFile(x.files?.ref) && /\.docx$/i.test(x.files!.ref.name)) files.ref = { name: safeName(x.files!.ref.name), data: x.files!.ref.data };
  if (okFile(x.files?.csl) && /\.csl$/i.test(x.files!.csl.name)) files.csl = { name: safeName(x.files!.csl.name), data: x.files!.csl.data };
  const name = typeof x.name === "string" && x.name.trim() ? x.name.trim().slice(0, 40) : "导入的预设";
  return { name, opts: x.opts as ExportOptions, files };
}

/** 内嵌文件名只留文件名本身，去掉路径和不能用的字符 */
export function safeName(n: string): string {
  const base = n.split(/[\\/]/).pop()!.replace(/[<>:"|?*\u0000-\u001f]/g, "").replace(/^\.+/, "").trim();
  return base || "file";
}

/** 重名时的新名字：「样式.docx」→「样式 2.docx」「样式 3.docx」… */
export function freeName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; i < 1000; i++) { const n = `${stem} ${i}${ext}`; if (!taken(n)) return n; }
  return `${stem} ${Date.now()}${ext}`;
}

/** 预设名重名：「论文样式」→「论文样式 2」 */
export function freePresetName(name: string, names: string[]): string {
  return freeName(name, (n) => names.includes(n)).replace(/\.$/, "");
}
