/**
 * 后端接口。在 Tauri 里调用 Rust 命令；在普通浏览器里（开发预览、测试）使用内置的演示文件夹，
 * 版本存在 localStorage 里，行为与 Rust 版本库一致。
 */
import { DEMO_FILES, DEMO_ROOT } from "./demo";
import { splitBlocks } from "./markdown";

export interface TreeNode { name: string; path: string; dir: boolean; children: TreeNode[] }
export type VersionSource = "saved" | "external" | "auto";
export interface VersionMeta { id: string; at: number; source: VersionSource; name?: string | null; note?: string | null }

export interface FontFamily { name: string; display: string; cjk: boolean }

/** 浏览器预览里拿不到系统字体，给一份 macOS 常见字体 */
const FALLBACK_FONTS: FontFamily[] = [
  ["PingFang SC", "苹方-简", true], ["Songti SC", "宋体-简", true], ["Heiti SC", "黑体-简", true], ["Kaiti SC", "楷体-简", true],
  ["STFangsong", "华文仿宋", true], ["Hiragino Sans GB", "冬青黑体简体中文", true], ["Noto Serif SC", "思源宋体", true], ["Noto Sans SC", "思源黑体", true],
  ["Georgia", "Georgia", false], ["Helvetica Neue", "Helvetica Neue", false], ["Iowan Old Style", "Iowan Old Style", false], ["New York", "New York", false],
  ["Palatino", "Palatino", false], ["SF Pro Text", "SF Pro Text", false], ["Times New Roman", "Times New Roman", false],
].map(([name, display, cjk]) => ({ name: name as string, display: display as string, cjk: cjk as boolean }));

export interface Backend {
  isDemo: boolean;
  pickFolder(): Promise<string | null>;
  openFolder(root: string): Promise<TreeNode[]>;
  listTree(root: string): Promise<TreeNode[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  saveVersion(path: string, content: string, source: VersionSource, name?: string, note?: string): Promise<VersionMeta | null>;
  listVersions(path: string): Promise<VersionMeta[]>;
  readVersion(path: string, id: string): Promise<string>;
  onExternalChange(cb: (path: string) => void): () => void;
  listFonts(): Promise<FontFamily[]>;
  createFile(dir: string, base: string): Promise<string>;
  takePendingOpen(): Promise<string[]>;
  onOpenFile(cb: () => void): () => void;
  onMenu(cb: (id: string) => void): () => void;
}

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { open } = await import("@tauri-apps/plugin-dialog");
  return {
    isDemo: false,
    async pickFolder() {
      const r = await open({ directory: true, multiple: false, title: "打开文件夹" });
      return typeof r === "string" ? r : null;
    },
    openFolder: (root) => invoke("open_folder", { root }),
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
    createFile: (dir, base) => invoke("create_file", { dir, base }),
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

function demoBackend(): Backend {
  const files = new Map<string, string>(Object.entries(DEMO_FILES));
  const listeners = new Set<(p: string) => void>();
  const key = (p: string) => "holymark-demo-versions:" + p;
  const objKey = "holymark-demo-objects";
  const load = (p: string): DemoRecord[] => { try { return JSON.parse(localStorage.getItem(key(p)) || "[]"); } catch { return []; } };
  const objs = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(objKey) || "{}"); } catch { return {}; } };
  const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16) + s.length.toString(16); };
  const content = (r: DemoRecord) => { const o = objs(); return r.blocks.map((h) => o[h] ?? "").join(""); };

  const tree = (): TreeNode[] => {
    const root: TreeNode = { name: "", path: DEMO_ROOT, dir: true, children: [] };
    for (const p of [...files.keys()].sort()) {
      const parts = p.slice(DEMO_ROOT.length + 1).split("/");
      let cur = root;
      parts.forEach((part, i) => {
        const path = DEMO_ROOT + "/" + parts.slice(0, i + 1).join("/");
        let n = cur.children.find((c) => c.name === part);
        if (!n) { n = { name: part, path, dir: i < parts.length - 1, children: [] }; cur.children.push(n); }
        cur = n;
      });
    }
    const sort = (ns: TreeNode[]) => { ns.sort((a, b) => (+b.dir - +a.dir) || a.name.localeCompare(b.name, "zh")); ns.forEach((n) => sort(n.children)); };
    sort(root.children);
    return root.children;
  };

  const b: Backend = {
    isDemo: true,
    async pickFolder() { return DEMO_ROOT; },
    async openFolder() { return tree(); },
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
    async listFonts() { return FALLBACK_FONTS; },
    async createFile(dir, base) {
      let p = `${dir}/${base}.md`, n = 2;
      while (files.has(p)) p = `${dir}/${base} ${n++}.md`;
      files.set(p, `# ${p.split("/").pop()!.replace(/\.md$/, "")}\n\n`);
      return p;
    },
    async takePendingOpen() { return []; },
    onOpenFile() { return () => {}; },
    onMenu() { return () => {}; },
  };
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

let cached: Promise<Backend> | null = null;
export function getBackend(): Promise<Backend> {
  if (!cached) cached = inTauri ? tauriBackend() : Promise.resolve(demoBackend());
  return cached;
}
export const isTauri = inTauri;
