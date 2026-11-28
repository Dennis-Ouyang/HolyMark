/**
 * N16 导出预设的导入和导出（导出对话框的预设下拉里两项：「导出当前预设…」「导入预设…」）。
 * - 导出：一个 JSON 文件，参考文档（.docx）和引用样式（.csl）用 base64 内嵌，别人一个文件就能拿到整套样式；
 * - 导入：解出内嵌的文件放进这个文件夹的 .holymark/export/；重名时就地问「替换」还是「改名保存」；
 *   导入后加进「我的预设」并套用，提示条带「撤销」。
 * 浏览器预览里没有系统的文件窗口，用网页的下载和文件选择代替，方便试。
 * 文件格式（纯函数）在 lib/presetFile.ts。
 */
import { useRef, useState } from "react";
import type { Backend } from "../lib/backend";
import { cloneOpts, normalizeOpts, type ExportOptions } from "../lib/exporting";
import { freeName, freePresetName, packPreset, parsePreset, type EmbeddedFile, type PresetFile } from "../lib/presetFile";
import { baseName, join } from "../lib/paths";
import type { NoticeAction, NoticeKind } from "../editor/notice";

type Say = (m: string, kind?: NoticeKind, action?: NoticeAction) => void;
interface Preset { name: string; opts: ExportOptions }
interface Ctx {
  be: Backend;
  root: string;
  docDir: string;
  o: ExportOptions;
  setO: (o: ExportOptions) => void;
  presets: Preset[];
  setPresets: (p: Preset[]) => void;
  /** 最近套用的预设名（导出时当文件名） */
  lastName: string;
  /** 导入成功后通知外层同步当前预设选中态（索引、名称；撤销时传 null） */
  onImported?: (applied: { index: number; name: string } | null) => void;
  say: Say;
}

/** 重名时问一句：替换，还是改名保存 */
type Ask = { file: string; resolve: (how: "replace" | "rename" | null) => void };

export function usePresetIO(c: Ctx) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ctx = useRef(c);
  ctx.current = c;

  async function exportPreset() {
    const { be, o, root, docDir, lastName, say } = ctx.current;
    const name = lastName || "我的导出样式";
    const files: PresetFile["files"] = {};
    const embed = async (p: string): Promise<EmbeddedFile | undefined> => (p ? { name: baseName(p), data: await be.readBase64(p) } : undefined);
    try {
      if (o.fmt === "docx" && o.ref) files.ref = await embed(o.ref);
      if (o.csl) files.csl = await embed(o.csl);
    } catch { say("找不到预设用到的参考文档或引用样式，没有导出", "error"); return; }
    const text = packPreset(name, o, files);
    if (be.isDemo) { download(`${name}.json`, text); say(`已导出预设「${name}」`, "success"); return; }
    const to = await be.pickSave("导出当前预设", join(root || docDir, `${name}.json`), "json");
    if (!to) return;
    try { await be.writeText(to, text); say(`已导出预设「${name}」`, "success"); } catch (e) { say(String(e).replace(/^Error:\s*/, ""), "error"); }
  }

  async function importPreset() {
    const { be, say } = ctx.current;
    if (!ctx.current.root) { say("先打开一个文件夹，导入的样式文件要放进文件夹里", "warn"); return; }
    if (be.isDemo) { input.current?.click(); return; }
    const p = await be.pickFile("导入预设", ["json"]);
    if (!p) return;
    try { await importText(await be.readText(p)); } catch (e) { say(String(e).replace(/^Error:\s*/, ""), "error"); }
  }

  async function importText(text: string) {
    const { be, root, o, presets, setO, setPresets, onImported, say } = ctx.current;
    const pf = parsePreset(text);
    if (typeof pf === "string") { say(pf, "error"); return; }
    const dir = join(root, ".holymark/export");
    const exists = async (n: string) => be.readBase64(join(dir, n)).then(() => true, () => false);
    /** 解出一个内嵌文件，返回放到哪里；用户取消返回 null */
    const unpack = async (f: EmbeddedFile): Promise<string | null> => {
      let name = f.name;
      if (await exists(name)) {
        const how = await new Promise<"replace" | "rename" | null>((resolve) => setAsk({ file: name, resolve }));
        setAsk(null);
        if (!how) return null;
        if (how === "rename") {
          const taken = new Set<string>();
          for (let n = freeName(name, (x) => taken.has(x)); ; n = freeName(name, (x) => taken.has(x))) { if (!(await exists(n))) { name = n; break; } taken.add(n); }
        }
      }
      const to = join(dir, name);
      await be.writeBase64(to, f.data);
      return to;
    };
    const opts = normalizeOpts({ ...pf.opts });
    for (const k of ["ref", "csl"] as const) {
      const f = pf.files[k];
      if (!f) continue;
      const to = await unpack(f);
      if (to === null) { say("已取消导入", "info"); return; }
      opts[k] = to;
    }
    const before = cloneOpts(o), beforeList = presets;
    const name = freePresetName(pf.name, presets.map((x) => x.name));
    const nextList = [...presets, { name, opts: cloneOpts(opts) }];
    setPresets(nextList);
    setO(normalizeOpts({ ...opts, fmt: o.fmt }));
    onImported?.({ index: nextList.length - 1, name });
    say(`已导入预设「${name}」`, "success", { label: "撤销", run: () => { setPresets(beforeList); setO(before); onImported?.(null); } });
  }

  const node = <>
    <input ref={input} type="file" accept=".json,application/json" hidden aria-hidden="true" data-preset-input
      onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await importText(await f.text()); }} />
    {ask && <div className="preask" role="alert">
      <span>「{ask.file}」已经有了</span>
      <button type="button" className="btn sm" onClick={() => ask.resolve(null)}>取消</button>
      <button type="button" className="btn sm" onClick={() => ask.resolve("rename")}>改名保存</button>
      <button type="button" className="btn sm acc" onClick={() => ask.resolve("replace")}>替换</button>
    </div>}
  </>;
  return { exportPreset, importPreset, node };
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
