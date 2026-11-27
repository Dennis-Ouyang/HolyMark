/**
 * 版本与存档点领域 hook（G1、B14、N19）：
 * - 版本列表、外部修改新版本标记、版本对比状态；
 * - ⌘S 不打断的存档点（checkpoint / commitCheckpoint / saveVersion）；
 * - 还原到刚打开时（revertToOpened）；
 * - 整篇恢复（restore）与单段恢复/移除（restoreBlock）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { EditorHandle } from "../editor/Editor";
import type { Backend, VersionMeta } from "../lib/backend";
import { alignBlocks, changedLines } from "../lib/markdown";
import { alignWithRanges, removeRow, restoreRow } from "../lib/restoreBlock";
import { versionTitle } from "../components/SidePanel";
import type { DlgKind, LiveDoc, SayFn } from "./appUtils";

export interface VersionCmp {
  v: VersionMeta;
  against: "current" | "prev";
  /** 这个版本和现在的内容一样 */
  same?: boolean;
  oldText: string;
  newText: string;
}

export interface UseVersionsArgs {
  be: Backend | null;
  path: string;
  text: string;
  dlg: DlgKind;
  setDlg: React.Dispatch<React.SetStateAction<DlgKind>>;
  live: React.MutableRefObject<LiveDoc>;
  ed: React.RefObject<EditorHandle>;
  view: () => EditorView | null;
  setText: (t: string) => void;
  flush: () => Promise<void>;
  say: SayFn;
}

export function useVersions({ be, path, text, dlg, setDlg, live, ed, view, setText, flush, say }: UseVersionsArgs) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [cmp, setCmp] = useState<VersionCmp | null>(null);

  /**
   * ⌘S 是不打断的存档点（G1）：马上提示「已存档」，提示条上带「起个名字」，点了才弹出起名字的对话框。
   * 存档点的版本在提示条消失后记下（这期间点了「起个名字」就带着名字记一条，不会记两条）；
   * 换文件、关窗口、刷新前会先记下。文件本身一直在自动保存。
   */
  const pendingCk = useRef<{ timer: number; path: string; text: string } | null>(null);
  async function commitCheckpoint(name?: string, note?: string) {
    const ck = pendingCk.current;
    if (!ck || !be) return;
    window.clearTimeout(ck.timer);
    pendingCk.current = null;
    await be.saveVersion(ck.path, ck.text, "saved", name || undefined, note || undefined);
    if (ck.path === live.current.path) setVersions(await be.listVersions(ck.path));
  }
  async function checkpoint() {
    if (!be || !path) return;
    await flush();
    await commitCheckpoint();
    live.current.lastVersionAt = Date.now();
    live.current.base = live.current.text;
    pendingCk.current = { path, text: live.current.text, timer: window.setTimeout(() => { commitCheckpoint().catch(() => {}); }, 6500) };
    say("已存档", "success", { label: "起个名字", run: () => { if (pendingCk.current) window.clearTimeout(pendingCk.current.timer); setDlg("save"); } });
  }
  async function saveVersion(name: string, note: string) {
    if (!be || !path) return;
    await flush();
    if (pendingCk.current) await commitCheckpoint(name, note);
    else await be.saveVersion(path, live.current.text, "saved", name, note || undefined);
    live.current.lastVersionAt = Date.now();
    live.current.base = live.current.text;
    setVersions(await be.listVersions(path));
    setDlg(null);
    say(`已存档「${name}」`, "success");
  }

  /** 撤销这次打开以来的所有修改：现在的内容先存成版本，再回到打开时的样子（提示条带「撤销」） */
  async function revertToOpened() {
    const v = view(); if (!v || !be || !path) return;
    const l = live.current;
    if (l.text === l.opened) return;
    await flush();
    await be.saveVersion(path, l.text, "auto", undefined, "撤销这次打开以来的修改之前").catch(() => null);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: l.opened } });
    setVersions(await be.listVersions(path));
    say("已回到这次打开时的样子", "success", { label: "撤销", run: () => ed.current?.undo() });
  }

  /** against 不给时：默认对比现在；版本和现在一样就改成对比上一版。用户在分段控件里明确选了就照选的来 */
  async function openVersion(id: string, pick?: "current" | "prev") {
    let against = pick ?? "current";
    if (!be) return;
    const i = versions.findIndex((x) => x.id === id);
    const v = versions[i];
    const content = await be.readVersion(path, id);
    if (fresh === id) setFresh(null);
    // 所选版本和现在一模一样（比如最新的那个版本）：对比现在只会是「0 处不同」，自动改成和上一版比
    const same = content === live.current.text;
    if (same && !pick && versions[i + 1]) against = "prev";
    if (against === "prev" && versions[i + 1]) setCmp({ v, against, same, oldText: await be.readVersion(path, versions[i + 1].id), newText: content });
    else setCmp({ v, against: "current", same, oldText: content, newText: live.current.text });
  }

  /** 只恢复某一段（N19）：先存一个版本，再在编辑器里改（进撤销历史），对比视图跟着刷新，提示条带「撤销」 */
  async function restoreBlock(kind: "restore" | "remove", i: number) {
    const v = view();
    if (!be || !cmp || !v) return;
    await flush();
    const now = live.current.text;
    const rows = alignWithRanges(cmp.oldText, now);
    const fix = kind === "restore" ? restoreRow(now, rows, i) : removeRow(now, rows, i);
    if (!fix) return;
    await be.saveVersion(path, now, "auto", undefined, kind === "restore" ? "恢复这一段前自动保存" : "移除这一段前自动保存").catch(() => null);
    v.dispatch({ changes: fix, userEvent: kind === "restore" ? "input.restore" : "delete.restore" });
    ed.current?.flash(changedLines(now, live.current.text));
    setText(live.current.text);
    setCmp((c) => c && { ...c, newText: live.current.text, same: false });
    await flush();
    setVersions(await be.listVersions(path).catch(() => []));
    say(kind === "restore" ? "已恢复这一段" : "已移除这一段", "success", { label: "撤销", run: () => {
      ed.current?.undo();
      setText(live.current.text);
      setCmp((c) => c && { ...c, newText: live.current.text });
      void flush();
    } });
  }

  async function restore() {
    if (!be || !cmp) return;
    await flush();
    await be.saveVersion(path, live.current.text, "auto", undefined, "恢复前自动保存");
    const content = await be.readVersion(path, cmp.v.id);
    const before = live.current.text;
    ed.current?.replace(content);
    window.setTimeout(() => ed.current?.flash(changedLines(before, content)), 50);
    live.current.text = content;
    setText(content);
    await flush();
    setVersions(await be.listVersions(path));
    setCmp(null);
    // 直接恢复、不先问“确定吗”，但给几秒撤销：撤销就是把恢复前的内容放回来（它也已经存成了版本）
    const at = path;
    say(`已恢复到「${versionTitle(cmp.v)}」，恢复前的内容已存为版本`, "success", { label: "撤销", run: () => {
      if (live.current.path !== at) return;
      const now = live.current.text;
      ed.current?.replace(before);
      window.setTimeout(() => ed.current?.flash(changedLines(now, before)), 50);
      live.current.text = before;
      setText(before);
      void flush();
    } });
  }

  const [lastVersionText, setLastVersionText] = useState("");
  useEffect(() => {
    if (dlg === "save" && be && versions[0]) be.readVersion(path, versions[0].id).then(setLastVersionText);
  }, [dlg, be, versions, path]);
  const saveChanges = useMemo(() => (dlg === "save" ? alignBlocks(lastVersionText, text).filter((r) => r.ops).length : 0), [dlg, lastVersionText, text]);

  return {
    versions, setVersions, fresh, setFresh, cmp, setCmp,
    commitCheckpoint, checkpoint, saveVersion, revertToOpened, openVersion, restoreBlock, restore, saveChanges,
  };
}
