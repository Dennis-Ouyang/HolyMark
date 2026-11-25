import { useEffect, useMemo, useRef, useState } from "react";
import { FONT_SUGGESTIONS, fontStack, Settings } from "../lib/settings";
import { Icon } from "./Icons";

function Scrim({ onClose, center, children }: { onClose: () => void; center?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    addEventListener("keydown", f, true);
    return () => removeEventListener("keydown", f, true);
  }, [onClose]);
  return <div className={"scrim" + (center ? " center" : "")} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>{children}</div>;
}

/* ---------------- 保存版本 ---------------- */
export function SaveVersionDialog({ changes, fileName, onSave, onClose }: { changes: number; fileName: string; onSave: (name: string, note: string) => void; onClose: () => void }) {
  const d = new Date();
  const ph = `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  return (
    <Scrim onClose={onClose} center>
      <form className="sheetdlg" role="dialog" aria-label="保存版本" onSubmit={(e) => { e.preventDefault(); onSave(name.trim() || ph, note.trim()); }}>
        <div className="dh"><h3>保存版本</h3></div>
        <div className="db">
          <div className="fld"><label htmlFor="vname">名称</label><input id="vname" autoFocus placeholder={ph} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
          <div className="fld"><label htmlFor="vnote">备注</label><textarea id="vnote" placeholder="可以不填" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="dnote">{fileName} · 与上一个版本相比 <b>{changes} 处改动</b></div>
        </div>
        <div className="df"><button type="button" className="btn" onClick={onClose}>取消</button><button type="submit" className="btn acc">保存</button></div>
      </form>
    </Scrim>
  );
}

/* ---------------- 设置 ---------------- */
type Pane = "general" | "editor" | "count" | "versions" | "keys";
export function SettingsDialog({ s, onChange, onClose }: { s: Settings; onChange: (p: Partial<Settings>) => void; onClose: () => void }) {
  const [pane, setPane] = useState<Pane>("editor");
  const seg = <K extends keyof Settings>(k: K, opts: [Settings[K], string][]) => (
    <div className="seg">{opts.map(([v, l]) => <button key={String(v)} className={s[k] === v ? "on" : ""} onClick={() => onChange({ [k]: v } as Partial<Settings>)}>{l}</button>)}</div>
  );
  const num = (k: keyof Settings, attrs: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input type="number" defaultValue={String(s[k])} {...attrs} onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange({ [k]: v } as Partial<Settings>); }} />
  );
  const font = (k: "headingFont" | "bodyFont", sample: string, bold?: boolean) => (
    <div><input type="text" list="hm-fonts-s" value={s[k]} onChange={(e) => onChange({ [k]: e.target.value } as Partial<Settings>)} />
      <div className="fontprev" style={{ fontFamily: fontStack(s[k]), fontWeight: bold ? 600 : 400 }}>{sample}</div></div>
  );
  return (
    <Scrim onClose={onClose} center>
      <div className="prefs" role="dialog" aria-label="设置">
        <datalist id="hm-fonts-s">{FONT_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>
        <nav>
          <div className="tl">设置</div>
          {([["general", "通用"], ["editor", "编辑器"], ["count", "字数统计"], ["versions", "版本"], ["keys", "快捷键"]] as [Pane, string][]).map(([k, l]) =>
            <button key={k} className={pane === k ? "on" : ""} onClick={() => setPane(k)}>{l}</button>)}
        </nav>
        <div className="pb">
          <button className="ib close-x" onClick={onClose} aria-label="关闭"><Icon name="close" /></button>
          {pane === "general" && <><h4>通用</h4>
            <div className="prow"><span>界面</span>{seg("theme", [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]])}</div></>}
          {pane === "editor" && <><h4>编辑器默认值</h4>
            <p className="dnote">所有文件默认使用这里的设置；单个文件可以在功能区「本文版式」里覆盖。</p>
            <div className="prow"><span>标题字体<small>可填任何已安装的字体</small></span>{font("headingFont", "3.3　分析框架", true)}</div>
            <div className="prow"><span>正文字体</span>{font("bodyFont", "本研究借鉴认知负荷理论，将写作过程中的负荷分为三类。")}</div>
            <div className="prow"><span>字号</span>{num("fontSize", { min: 12, max: 28 })}</div>
            <div className="prow"><span>行距</span>{num("lineHeight", { min: 1.2, max: 2.6, step: 0.05 })}</div>
            <div className="prow"><span>版心宽度<small>每行大约多少个字</small></span>{num("measure", { min: 24, max: 60 })}</div>
            <div className="prow"><span>Markdown 语法</span>{seg("syntax", [["active", "光标所在块显示"], ["always", "始终显示"]])}</div></>}
          {pane === "count" && <><h4>字数统计</h4>
            <div className="prow"><span>状态栏口径</span>{seg("countPunct", [[false, "不含标点"], [true, "含标点"]])}</div>
            <div className="prow"><span>写作目标<small>开启后状态栏显示进度</small></span>
              <div className="inline"><button className={"switch" + (s.goalOn ? " on" : "")} role="switch" aria-checked={s.goalOn} aria-label="写作目标" onClick={() => onChange({ goalOn: !s.goalOn })} />{num("goal", { min: 100, step: 500, disabled: !s.goalOn })}<span className="dnote">字</span></div></div></>}
          {pane === "versions" && <><h4>版本</h4>
            <div className="prow"><span>自动版本间隔</span><div className="inline">{num("autoMinutes", { min: 1 })}<span className="dnote">分钟</span></div></div>
            <div className="prow"><span>外部修改合并<small>这段时间内的连续写入记为一条</small></span><div className="inline">{num("mergeSeconds", { min: 1 })}<span className="dnote">秒</span></div></div></>}
          {pane === "keys" && <><h4>快捷键</h4>
            <table className="kt"><tbody>{[["搜索与命令", "⌘ K"], ["保存版本", "⌘ S"], ["设置", "⌘ ,"], ["粗体 / 斜体 / 行内代码", "⌘ B / ⌘ I / ⌘ E"], ["专注模式", "⌘ ⇧ F"], ["切换侧栏 / 右栏", "⌘ \\ / ⌘ /"], ["查找", "⌘ F"]].map(([a, b]) => <tr key={a}><td>{a}</td><td><kbd>{b}</kbd></td></tr>)}</tbody></table></>}
        </div>
      </div>
    </Scrim>
  );
}

/* ---------------- ⌘K：搜索与命令 ---------------- */
export interface PaletteItem { group: string; icon: string; title: string; sub?: string; keys?: string[]; run: () => void }
export function Palette({ items, search, onClose, placeholder }: { items: PaletteItem[]; search: (q: string) => PaletteItem[]; onClose: () => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const cmds = items.filter((c) => !ql || c.title.toLowerCase().includes(ql));
    return ql ? [...search(q.trim()), ...cmds.slice(0, 6)] : cmds;
  }, [q, items, search]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector(".sel")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const run = (i: number) => { const it = list[i]; onClose(); it?.run(); };
  let group = "";
  return (
    <Scrim onClose={onClose}>
      <div className="palette" role="dialog" aria-label="搜索">
        <div className="q"><Icon name="search" /><input autoFocus placeholder={placeholder} value={q} aria-label="搜索"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (list.length) setSel((sel + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length); }
            if (e.key === "Enter") { e.preventDefault(); run(sel); }
          }} /><kbd>Esc</kbd></div>
        <div className="plist" ref={box}>
          {list.length ? list.map((c, i) => {
            const head = c.group !== group ? <div className="pg">{(group = c.group)}</div> : null;
            return <div key={i}>{head}<button className={"pi" + (i === sel ? " sel" : "")} onMouseMove={() => setSel(i)} onClick={() => run(i)}>
              <Icon name={c.icon} /><span className="tx"><div>{c.title}</div>{c.sub && <small dangerouslySetInnerHTML={{ __html: c.sub }} />}</span>
              {c.keys && <span className="sc">{c.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>}</button></div>;
          }) : <div className="empty">没有找到相关内容</div>}
        </div>
        <div className="pfoot"><span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span></div>
      </div>
    </Scrim>
  );
}

/* ---------------- 字数浮窗 ---------------- */
export function CountPop({ title, text, count, anchor, onClose }: { title: string; text: string; count: (t: string, p: boolean) => number; anchor: DOMRect; onClose: () => void }) {
  useEffect(() => {
    const f = () => onClose();
    setTimeout(() => addEventListener("mousedown", f), 0);
    return () => removeEventListener("mousedown", f);
  }, [onClose]);
  return (
    <div className="pop countpop" style={{ left: anchor.left, bottom: innerHeight - anchor.top + 6 }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="lbl">{title}</div>
      <div className="cnt">
        <span>字数（不含标点）</span><b>{count(text, false).toLocaleString()}</b>
        <span>字数（含标点）</span><b>{count(text, true).toLocaleString()}</b>
        <span>字符数（含空格）</span><b>{text.length.toLocaleString()}</b>
        <span>字符数（不含空格）</span><b>{text.replace(/\s/g, "").length.toLocaleString()}</b>
      </div>
    </div>
  );
}
