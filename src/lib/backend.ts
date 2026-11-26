/**
 * 后端接口。在 Tauri 里调用 Rust 命令；在普通浏览器里（开发预览、测试）使用内置的演示文件夹，
 * 版本存在 localStorage 里，行为与 Rust 版本库一致。
 */
import { DEMO_FILES, DEMO_ROOT, DEMO_START } from "./demo";
import { longManuscript } from "./stress";
import { toPosix } from "./paths";
import { isWindows } from "./platform";
import { splitBlocks } from "./markdown";
import type { FilePreview } from "./filePreview";

export interface TreeNode { name: string; path: string; dir: boolean; children: TreeNode[] }
export type VersionSource = "saved" | "external" | "auto";
export interface VersionMeta { id: string; at: number; source: VersionSource; name?: string | null; note?: string | null }

export interface FontFamily { name: string; display: string; cjk: boolean }
export interface ToolInfo { path: string; version: string; bundled: boolean }
export interface ExportTools { pandoc: ToolInfo | null; typst: ToolInfo | null }
/** 参考文档里读出来的样式，单位和导出选项一致 */
export interface RefHeading { font?: string | null; size?: string | null; bold?: boolean | null; align?: string | null; before?: string | null; after?: string | null }
export interface RefStyles {
  pageMm: [string, string] | null; marginsCm: (string | null)[]; cjk: string | null; latin: string | null; size: string | null;
  line: [string, string] | null; indent: string | null; before: string | null; after: string | null; align: string | null; headings: RefHeading[];
}
export interface ExportJob {
  format: "docx" | "pdf"; markdown: string; output: string; defaultsDir: string; defaultsName: string; defaultsYaml: string;
  referenceDoc: string | null; docxStyle: unknown; typstTemplate: string | null; assets: { name: string; data: string }[]; extraArgs: string[];
}

/** 浏览器预览里拿不到系统字体，给一份常见字体 */
const WINDOWS_FONTS: FontFamily[] = [
  ["Microsoft YaHei", "微软雅黑", true], ["DengXian", "等线", true], ["SimSun", "宋体", true], ["SimHei", "黑体", true],
  ["KaiTi", "楷体", true], ["FangSong", "仿宋", true], ["Noto Serif SC", "思源宋体", true], ["Noto Sans SC", "思源黑体", true],
  ["Cambria", "Cambria", false], ["Georgia", "Georgia", false], ["Segoe UI", "Segoe UI", false], ["Times New Roman", "Times New Roman", false],
].map(([name, display, cjk]) => ({ name: name as string, display: display as string, cjk: cjk as boolean }));
const MAC_FONTS: FontFamily[] = [
  ["PingFang SC", "苹方-简", true], ["Songti SC", "宋体-简", true], ["Heiti SC", "黑体-简", true], ["Kaiti SC", "楷体-简", true],
  ["STFangsong", "华文仿宋", true], ["Hiragino Sans GB", "冬青黑体简体中文", true], ["Noto Serif SC", "思源宋体", true], ["Noto Sans SC", "思源黑体", true],
  ["Georgia", "Georgia", false], ["Helvetica Neue", "Helvetica Neue", false], ["Iowan Old Style", "Iowan Old Style", false], ["New York", "New York", false],
  ["Palatino", "Palatino", false], ["SF Pro Text", "SF Pro Text", false], ["Times New Roman", "Times New Roman", false],
].map(([name, display, cjk]) => ({ name: name as string, display: display as string, cjk: cjk as boolean }));

export interface Backend {
  isDemo: boolean;
  pickFolder(): Promise<string | null>;
  /** 选一个文件（可以在文件夹以外）；extensions 为空表示任何文件 */
  pickFile(title: string, extensions?: string[]): Promise<string | null>;
  /** 选保存位置 */
  pickSave(title: string, defaultPath: string, extension: string): Promise<string | null>;
  exportTools(): Promise<ExportTools>;
  exportRun(job: ExportJob): Promise<{ output: string; warnings: string }>;
  readReference(path: string): Promise<RefStyles>;
  /** 在 Finder 里显示 */
  reveal(path: string): Promise<void>;
  /** 用系统默认的程序打开 */
  openPath(path: string): Promise<void>;
  /** 导出进行到哪一步：style → pandoc → typst → write */
  onExportProgress(cb: (stage: string) => void): () => void;
  openFolder(root: string): Promise<TreeNode[]>;
  /** 关闭文件夹：停止监听外部修改 */
  closeFolder(): Promise<void>;
  listTree(root: string): Promise<TreeNode[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  saveVersion(path: string, content: string, source: VersionSource, name?: string, note?: string): Promise<VersionMeta | null>;
  listVersions(path: string): Promise<VersionMeta[]>;
  readVersion(path: string, id: string): Promise<string>;
  onExternalChange(cb: (path: string) => void): () => void;
  listFonts(): Promise<FontFamily[]>;
  /** 保存粘贴或拖进来的图片，data 是 base64，返回保存后的路径 */
  saveImage(dir: string, name: string, data: string): Promise<string>;
  createFile(dir: string, base: string): Promise<string>;
  /** 新建文件夹（重名时加编号），返回路径 */
  createDir(dir: string, base: string): Promise<string>;
  /** 改名（只改最后一段），返回新路径；版本历史跟着走 */
  renamePath(path: string, name: string): Promise<string>;
  duplicatePath(path: string): Promise<string>;
  /** 移到另一个文件夹里，返回新路径 */
  movePath(path: string, dir: string): Promise<string>;
  /** 移到废纸篓 / 回收站 */
  trashPath(path: string): Promise<void>;
  /** 文件预览卡片的内容 */
  filePreview(path: string): Promise<FilePreview>;
  /** 把文件复制进某个文件夹（重名时加编号），返回新路径 */
  copyIntoFolder(src: string, dir: string): Promise<string>;
  /** 从访达 / 资源管理器拖文件进窗口：over（拖着移动）、drop（松手，带路径）、leave（拖出去或取消）。坐标是窗口里的 CSS 像素 */
  onFileDrop(cb: (e: { type: "over" | "drop" | "leave"; paths: string[]; x: number; y: number }) => void): () => void;
  /** 可撤销的删除：先挪到 .holymark/trash/ 暂存，返回暂存路径；restore 挪回原处，commit 真正移到废纸篓 */
  stageDelete(path: string): Promise<string>;
  restoreStaged(staged: string, original: string): Promise<void>;
  commitStaged(staged: string): Promise<void>;
  takePendingOpen(): Promise<string[]>;
  onOpenFile(cb: () => void): () => void;
  onMenu(cb: (id: string) => void): () => void;
}

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { open, save } = await import("@tauri-apps/plugin-dialog");
  return {
    isDemo: false,
    async pickFolder() {
      const r = await open({ directory: true, multiple: false, title: "打开文件夹" });
      return typeof r === "string" ? toPosix(r) : null;
    },
    async pickFile(title, extensions) {
      const r = await open({ multiple: false, directory: false, title, filters: extensions?.length ? [{ name: title, extensions }] : undefined });
      return typeof r === "string" ? toPosix(r) : null;
    },
    async pickSave(title, defaultPath, extension) {
      const r = await save({ title, defaultPath, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
      return r ? toPosix(r) : null;
    },
    exportTools: () => invoke("export_tools"),
    exportRun: (job) => invoke("export_run", { job }),
    readReference: (path) => invoke("read_reference", { path }),
    reveal: (path) => invoke("reveal", { path }),
    openPath: (path) => invoke("open_path", { path }),
    onExportProgress(cb) {
      let un: (() => void) | null = null, alive = true;
      listen<string>("export-progress", (e) => cb(e.payload)).then((u) => { if (alive) un = u; else u(); });
      return () => { alive = false; un?.(); };
    },
    openFolder: (root) => invoke("open_folder", { root }),
    closeFolder: () => invoke("close_folder"),
    listTree: (root) => invoke("list_tree", { root }),
    readText: (path) => invoke("read_text", { path }),
    writeText: (path, content) => invoke("write_text", { path, content }),
    saveVersion: (path, content, source, name, note) => invoke("save_version", { path, content, source, name: name ?? null, note: note ?? null }),
    listVersions: (path) => invoke("list_versions", { path }),
    readVersion: (path, id) => invoke("read_version", { path, id }),
    onExternalChange(cb) {
      let un: (() => void) | null = null;
      listen<{ path: string }>("external-change", (e) => cb(e.payload.path)).then((u) => (un = u));
      return () => un?.();
    },
    listFonts: () => invoke("list_fonts"),
    saveImage: (dir, name, data) => invoke("save_image", { dir, name, data }),
    createFile: (dir, base) => invoke("create_file", { dir, base }),
    createDir: (dir, base) => invoke("create_dir", { dir, base }),
    renamePath: (path, name) => invoke("rename_path", { path, name }),
    duplicatePath: (path) => invoke("duplicate_path", { path }),
    movePath: (path, dir) => invoke("move_path", { path, dir }),
    trashPath: (path) => invoke("trash_path", { path }),
    copyIntoFolder: (src, dir) => invoke("copy_into_folder", { src, dir }),
    filePreview: (path) => invoke("file_preview", { path }),
    onFileDrop(cb) {
      let un: (() => void) | null = null, alive = true;
      import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
        const u = await getCurrentWebview().onDragDropEvent((e) => {
          const p = e.payload as { type: string; paths?: string[]; position?: { x: number; y: number } };
          // 位置是物理像素，换成 CSS 像素
          const k = window.devicePixelRatio || 1;
          const x = (p.position?.x ?? 0) / k, y = (p.position?.y ?? 0) / k;
          if (p.type === "over" || p.type === "enter") cb({ type: "over", paths: (p.paths ?? []).map(toPosix), x, y });
          else if (p.type === "drop") cb({ type: "drop", paths: (p.paths ?? []).map(toPosix), x, y });
          else cb({ type: "leave", paths: [], x: 0, y: 0 });
        });
        if (alive) un = u; else u();
      });
      return () => { alive = false; un?.(); };
    },
    stageDelete: (path) => invoke("stage_delete", { path }),
    restoreStaged: (staged, original) => invoke("restore_staged", { staged, original }),
    commitStaged: (staged) => invoke("commit_staged", { staged }),
    takePendingOpen: () => invoke("take_pending_open"),
    onOpenFile(cb) {
      let un: (() => void) | null = null;
      listen("open-file", () => cb()).then((u) => (un = u));
      return () => un?.();
    },
    onMenu(cb) {
      let un: (() => void) | null = null;
      listen<string>("menu", (e) => cb(e.payload)).then((u) => (un = u));
      return () => un?.();
    },
  };
}

/* ---------------- 浏览器里的演示后端 ---------------- */
interface DemoRecord extends VersionMeta { blocks: string[] }

/** 浏览器预览加上 ?stress（或 ?stress=字数）时，演示文件夹里多一篇长稿，并直接打开它 */
const stressChars = (() => {
  if (typeof location === "undefined") return 0;
  const v = new URLSearchParams(location.search).get("stress");
  return v === null ? 0 : +v || 200_000;
})();
const STRESS_PATH = DEMO_ROOT + "/正文/长稿压力测试.md";
export const demoStartFile = stressChars ? STRESS_PATH : DEMO_START;

function demoBackend(): Backend {
  const files = new Map<string, string>(Object.entries(DEMO_FILES));
  const dirs = new Set<string>(); // 空文件夹
  if (stressChars) files.set(STRESS_PATH, longManuscript(stressChars));
  const listeners = new Set<(p: string) => void>();
  const key = (p: string) => "holymark-demo-versions:" + p;
  const objKey = "holymark-demo-objects";
  const load = (p: string): DemoRecord[] => { try { return JSON.parse(localStorage.getItem(key(p)) || "[]"); } catch { return []; } };
  const objs = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(objKey) || "{}"); } catch { return {}; } };
  const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16) + s.length.toString(16); };
  const content = (r: DemoRecord) => { const o = objs(); return r.blocks.map((h) => o[h] ?? "").join(""); };

  const tree = (): TreeNode[] => {
    const root: TreeNode = { name: "", path: DEMO_ROOT, dir: true, children: [] };
    const add = (p: string, isDir: boolean) => {
      const parts = p.slice(DEMO_ROOT.length + 1).split("/");
      let cur = root;
      parts.forEach((part, i) => {
        const path = DEMO_ROOT + "/" + parts.slice(0, i + 1).join("/");
        let n = cur.children.find((c) => c.name === part);
        if (!n) { n = { name: part, path, dir: isDir || i < parts.length - 1, children: [] }; cur.children.push(n); }
        cur = n;
      });
    };
    const hidden = (p: string) => p.slice(DEMO_ROOT.length + 1).split("/").some((x) => x.startsWith("."));
    for (const p of [...files.keys()].sort()) if (!hidden(p)) add(p, false);
    for (const d of dirs) if (!hidden(d)) add(d, true);
    const sort = (ns: TreeNode[]) => { ns.sort((a, b) => (+b.dir - +a.dir) || a.name.localeCompare(b.name, "zh")); ns.forEach((n) => sort(n.children)); };
    sort(root.children);
    return root.children;
  };

  const b: Backend = {
    isDemo: true,
    async pickFolder() { return DEMO_ROOT; },
    async pickFile() { return null; },
    async pickSave() { return null; },
    async exportTools() { return { pandoc: null, typst: null }; },
    async exportRun() { throw new Error("浏览器预览里不能导出 Word 和 PDF"); },
    async readReference() { throw new Error("浏览器预览里不能读取参考文档"); },
    async reveal() { /* 浏览器里没有 Finder */ },
    async openPath() { /* 浏览器里打不开本机文件 */ },
    onExportProgress() { return () => {}; },
    async openFolder() { return tree(); },
    async closeFolder() { /* 演示文件夹没有监听 */ },
    async listTree() { return tree(); },
    async readText(path) { return files.get(path) ?? ""; },
    async writeText(path, c) { files.set(path, c); },
    async saveVersion(path, c, source, name, note) {
      const recs = load(path);
      const last = recs[recs.length - 1];
      if (source !== "saved" && last && content(last) === c) return null;
      const o = objs();
      const blocks = splitBlocks(c).map((blk) => { const h = hash(blk); o[h] = blk; return h; });
      try { localStorage.setItem(objKey, JSON.stringify(o)); } catch { /* 存储满了就只保留内存里的 */ }
      const rec: DemoRecord = { id: "v" + Date.now() + Math.random().toString(36).slice(2, 5), at: Date.now(), source, name: name ?? null, note: note ?? null, blocks };
      recs.push(rec);
      try { localStorage.setItem(key(path), JSON.stringify(recs)); } catch { /* ignore */ }
      return { id: rec.id, at: rec.at, source, name: rec.name, note: rec.note };
    },
    async listVersions(path) { return load(path).slice().reverse().map(({ blocks: _b, ...m }) => m); },
    async readVersion(path, id) { const r = load(path).find((x) => x.id === id); return r ? content(r) : ""; },
    onExternalChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async listFonts() { return isWindows ? WINDOWS_FONTS : MAC_FONTS; },
    async saveImage(dir, name, data) {
      let p = `${dir}/${name}`, n = 1;
      const [stem, ext] = name.includes(".") ? [name.replace(/\.[^.]+$/, ""), name.slice(name.lastIndexOf("."))] : [name, ".png"];
      while (demoImages.has(p)) p = `${dir}/${stem}-${n++}${ext}`;
      demoImages.set(p, `data:image/${ext.slice(1) === "jpg" ? "jpeg" : ext.slice(1)};base64,${data}`);
      files.set(p, "");
      return p;
    },
    async createFile(dir, base) {
      let p = `${dir}/${base}.md`, n = 2;
      while (files.has(p)) p = `${dir}/${base} ${n++}.md`;
      files.set(p, `# ${p.split("/").pop()!.replace(/\.md$/, "")}\n\n`);
      return p;
    },
    async createDir(dir, base) {
      let p = `${dir}/${base}`, n = 2;
      const taken = (x: string) => dirs.has(x) || [...files.keys()].some((f) => f === x || f.startsWith(x + "/"));
      while (taken(p)) p = `${dir}/${base} ${n++}`;
      dirs.add(p);
      return p;
    },
    async renamePath(path, name) {
      if (!name.trim() || /[\\/:*?"<>|]/.test(name)) throw new Error("名字里有不能用的字符");
      const to = path.slice(0, path.lastIndexOf("/") + 1) + name.trim();
      return moveTo(path, to);
    },
    async duplicatePath(path) {
      const dot = path.lastIndexOf(".");
      const [stem, ext] = dot > path.lastIndexOf("/") ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
      let p = `${stem} 副本${ext}`, n = 2;
      while (files.has(p)) p = `${stem} 副本 ${n++}${ext}`;
      files.set(p, files.get(path) ?? "");
      return p;
    },
    async movePath(path, dir) {
      if ((dir + "/").startsWith(path + "/")) throw new Error("不能把文件夹移到它自己里面");
      return moveTo(path, `${dir}/${path.slice(path.lastIndexOf("/") + 1)}`);
    },
    async trashPath(path) {
      for (const k of [...files.keys()]) if (k === path || k.startsWith(path + "/")) files.delete(k);
      for (const d of [...dirs]) if (d === path || d.startsWith(path + "/")) dirs.delete(d);
    },
    async filePreview(path) {
      const t = files.get(path);
      if (t === undefined) throw new Error("找不到文件");
      return { kind: "md", title: "", lines: t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).slice(0, 10), size: t.length, modified: Date.now() };
    },
    async copyIntoFolder(src, dir) { const p = `${dir}/${src.slice(src.lastIndexOf("/") + 1)}`; files.set(p, files.get(src) ?? ""); return p; },
    onFileDrop() { return () => {}; },
    async stageDelete(path) {
      const staged = `${DEMO_ROOT}/.holymark/trash/${Date.now()}/${path.slice(path.lastIndexOf("/") + 1)}`;
      return moveTo(path, staged);
    },
    async restoreStaged(staged, original) { moveTo(staged, original); },
    async commitStaged(staged) { for (const k of [...files.keys()]) if (k === staged || k.startsWith(staged + "/")) files.delete(k); for (const d of [...dirs]) if (d === staged || d.startsWith(staged + "/")) dirs.delete(d); },
    async takePendingOpen() { return []; },
    onOpenFile() { return () => {}; },
    onMenu() { return () => {}; },
  };
  function moveTo(from: string, to: string) {
    if (to === from) return from;
    if (files.has(to) || dirs.has(to)) throw new Error("已经有同名的文件了");
    for (const k of [...files.keys()]) if (k === from || k.startsWith(from + "/")) { files.set(to + k.slice(from.length), files.get(k)!); files.delete(k); }
    for (const d of [...dirs]) if (d === from || d.startsWith(from + "/")) { dirs.add(to + d.slice(from.length)); dirs.delete(d); }
    return to;
  }
  // 演示用：模拟 AI 在编辑器外改写文件
  (window as unknown as { holymarkSimulateExternal: (p: string, c: string) => Promise<void> }).holymarkSimulateExternal = async (p, c) => {
    const prev = files.get(p) ?? "";
    await b.saveVersion(p, prev, "auto");
    files.set(p, c);
    await b.saveVersion(p, c, "external");
    listeners.forEach((l) => l(p));
  };
  return b;
}

/** 浏览器预览里粘贴的图片只存在内存里 */
export const demoImages = new Map<string, string>();

let cached: Promise<Backend> | null = null;
export function getBackend(): Promise<Backend> {
  if (!cached) cached = inTauri ? tauriBackend() : Promise.resolve(demoBackend());
  return cached;
}
export const isTauri = inTauri;
