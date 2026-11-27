/**
 * N15 设置 →「快捷键」：可以改。
 * - 点一行的按键，按下新的组合键就生效（Esc 取消，Backspace 去掉这条快捷键）；
 * - 和已有的冲突时，就地提示被哪个命令占用，可以「替换」（那条命令的快捷键去掉）或取消；
 * - 改过的行右边有「恢复默认」，页底有「全部恢复默认」（先做后撤销）；
 * - 按 H36 的分组展示（文件 / 编辑 / 段落 / 插入 / 格式 / 视图）。
 * 改动走命令注册表的 setShortcut / resetShortcuts：macOS 原生菜单跟着重建，Windows 和浏览器预览的按键分发马上生效，
 * App 把改过的映射存进设置。
 */
import { useEffect, useState } from "react";
import {
  CATEGORY_TITLE, CommandCategory, commandsIn, commandWithKeys, customShortcuts, isCustomShortcut, isReservedKeys, keysFromEvent,
  keyText, loadShortcuts, onShortcutsChange, resetShortcut, resetShortcuts, setKeyRecording, setShortcut, shortcutOf,
} from "../lib/commandRegistry";
import { isMac, kbd } from "../lib/platform";

/** 编辑器自己处理的几个键：只显示，不能改 */
const FIXED: Partial<Record<CommandCategory, [string, string][]>> = {
  edit: [["撤销 / 重做", "⌘ Z / ⌘ ⇧ Z"]],
  paragraph: [["子列表 / 回到上一级", "Tab / ⇧ Tab"]],
  view: [["表格里换格", "Tab / ⇧ Tab"], ["离开当前块或表格", "Esc"]],
};

export function KeyEditor() {
  const [, setRev] = useState(0);
  useEffect(() => onShortcutsChange(() => setRev((r) => r + 1)), []);
  const [rec, setRec] = useState<string | null>(null);
  const [clash, setClash] = useState<{ id: string; keys: string; other: string; otherTitle: string } | null>(null);
  const [warn, setWarn] = useState<{ id: string; msg: string } | null>(null);
  const [undo, setUndo] = useState<Record<string, string | null> | null>(null);

  // 录按键：捕获阶段拦下，免得按下去就执行了别的命令
  useEffect(() => {
    setKeyRecording(!!rec);
    if (!rec) return;
    const f = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { setRec(null); return; }
      if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey && !e.altKey) { setShortcut(rec, null); setRec(null); return; }
      const keys = keysFromEvent(e);
      if (!keys) { if (!["Meta", "Control", "Shift", "Alt"].includes(e.key)) setWarn({ id: rec, msg: isMac ? "要和 ⌘、⌥ 或 ⌃ 一起按（F1–F12 可以单独用）" : "要和 Ctrl 或 Alt 一起按（F1–F12 可以单独用）" }); return; }
      if (isReservedKeys(keys)) { setWarn({ id: rec, msg: `${keyText(keys)} 留给系统（拷贝、粘贴、撤销这类），换一个吧` }); return; }
      const other = commandWithKeys(keys, rec);
      setRec(null); setWarn(null);
      if (other) { setClash({ id: rec, keys, other: other.id, otherTitle: other.title.replace(/…$/, "") }); return; }
      setShortcut(rec, keys);
    };
    addEventListener("keydown", f, true);
    return () => { removeEventListener("keydown", f, true); setKeyRecording(false); };
  }, [rec]);

  const start = (id: string) => { setClash(null); setWarn(null); setUndo(null); setRec(rec === id ? null : id); };
  const replace = () => { if (!clash) return; setShortcut(clash.other, null); setShortcut(clash.id, clash.keys); setClash(null); };
  const resetAll = () => { setUndo(customShortcuts()); setRec(null); setClash(null); setWarn(null); resetShortcuts(); };
  const anyCustom = Object.keys(customShortcuts()).length > 0;

  const cats = (Object.keys(CATEGORY_TITLE) as CommandCategory[]).filter((c) => c !== "help");
  return <div className="ktg kedit">
    <p className="pnote">点一行右边的按键，再按下新的组合键。Esc 取消，Backspace 去掉这条快捷键。</p>
    {cats.map((cat) => {
      const cmds = commandsIn(cat).filter((c) => !["undo", "redo", "quit"].includes(c.id) && !c.paletteOnly);
      if (!cmds.length && !FIXED[cat]) return null;
      return <section key={cat}><h4>{CATEGORY_TITLE[cat]}</h4><table className="kt"><tbody>
        {cmds.map((c) => {
          const k = shortcutOf(c.id), on = rec === c.id, custom = isCustomShortcut(c.id);
          return [
            <tr key={c.id} className={on ? "rec" : ""}>
              <td>{c.title.replace(/…$/, "")}</td>
              <td>
                {custom && <button type="button" className="lnk kreset" onClick={() => resetShortcut(c.id)} title="恢复成默认的快捷键">恢复默认</button>}
                <button type="button" className={"kbtn" + (on ? " on" : "") + (k ? "" : " none")} aria-label={`${c.title} 的快捷键`} aria-pressed={on} onClick={() => start(c.id)}>
                  {on ? "按下新的快捷键…" : k ? <kbd>{keyText(k)}</kbd> : "无"}
                </button>
              </td>
            </tr>,
            clash?.id === c.id && <tr key={c.id + "-c"} className="kclash"><td colSpan={2}><div role="alert">
              <span><kbd>{keyText(clash.keys)}</kbd> 已被「{clash.otherTitle}」占用</span>
              <button type="button" className="btn sm" onClick={() => setClash(null)}>取消</button>
              <button type="button" className="btn sm acc" onClick={replace}>替换</button>
            </div></td></tr>,
            warn?.id === c.id && <tr key={c.id + "-w"} className="kwarn"><td colSpan={2}>{warn.msg}</td></tr>,
          ];
        })}
        {(FIXED[cat] ?? []).map(([a, b]) => <tr key={a} className="fixed"><td>{a}</td><td><kbd>{kbd(b)}</kbd></td></tr>)}
      </tbody></table></section>;
    })}
    <div className="kfoot">
      {undo && <span className="kundo">已全部恢复默认<button type="button" className="lnk" onClick={() => { loadShortcuts(undo); setUndo(null); }}>撤销</button></span>}
      <span className="sp" />
      <button type="button" className="btn" disabled={!anyCustom} onClick={resetAll}>全部恢复默认</button>
    </div>
  </div>;
}
