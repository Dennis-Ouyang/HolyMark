import { useEffect, useMemo, useRef, useState } from "react";
import { fontStack, Settings } from "../lib/settings";
import type { FontFamily } from "../lib/backend";
import { FontSelect } from "./Select";
import { NumberField } from "./NumberField";
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
export function SettingsDialog({ s, fonts, onChange, onClose }: { s: Settings; fonts: FontFamily[]; onChange: (p: Partial<Settings>) => void; onClose: () => void }) {
  const [pane, setPane] = useState<Pane>("editor");
  const seg = <K extends keyof Settings>(k: K, opts: [Settings[K], string][]) => (
    <div className="seg">{opts.map(([v, l]) => <button key={String(v)} className={s[k] === v ? "on" : ""} onClick={() => onChange({ [k]: v } as Partial<Settings>)}>{l}</button>)}</div>
  );
  const num = (k: keyof Settings, attrs: { min: number; max?: number; step?: number; disabled?: boolean }, unit?: string) => (
    <NumberField value={String(s[k])} {...attrs} unit={unit} ariaLabel={String(k)} onCommit={(v) => { const n = parseFloat(v); if (!Number.isNaN(n)) onChange({ [k]: n } as Partial<Settings>); }} />
  );
  const font = (k: "headingFont" | "bodyFont", sample: string, bold?: boolean) => (
    <div><FontSelect value={s[k]} fonts={fonts} ariaLabel={k === "headingFont" ? "标题字体" : "正文字体"} onChange={(v) => onChange({ [k]: v } as Partial<Settings>)} />
      <div className="fontprev" style={{ fontFamily: fontStack(s[k]), fontWeight: bold ? 600 : 400 }}>{sample}</div></div>
  );
  return (
    <Scrim onClose={onClose} center>
      <div className="prefs" role="dialog" aria-label="设置">
        <nav>
          <div className="tl">设置</div>
          {([["general", "通用"], ["editor", "编辑器"], ["count", "字数统计"], ["versions", "版本"], ["keys", "快捷键"]] as [Pane, string][]).map(([k, l]) =>
            <button key={k} className={pane === k ? "on" : ""} onClick={() => setPane(k)}>{l}</button>)}
        </nav>
        <div className="pb">
          <button className="ib close-x" onClick={onClose} aria-label="关闭"><Icon name="close" /></button>
          {pane === "general" && <><h4>通用</h4>
            <div className="prow"><span>界面</span>{seg("theme", [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]])}</div>
            <div className="prow"><span>文件树<small>关闭时只显示 Markdown 文件</small></span>
              <div className="inline"><button className={"switch" + (s.showAllFiles ? " on" : "")} role="switch" aria-checked={s.showAllFiles} aria-label="显示所有文件" onClick={() => onChange({ showAllFiles: !s.showAllFiles })} /><span className="dnote">显示所有文件</span></div></div></>}
          {pane === "editor" && <><h4>编辑器默认值</h4>
            <p className="dnote">所有文件默认使用这里的设置；单个文件可以在功能区「本文版式」里覆盖。</p>
            <div className="prow"><span>标题字体<small>列出的是这台 Mac 上装的字体</small></span>{font("headingFont", "3.3　分析框架", true)}</div>
            <div className="prow"><span>正文字体</span>{font("bodyFont", "本研究借鉴认知负荷理论，将写作过程中的负荷分为三类。")}</div>
            <div className="prow"><span>字号</span>{num("fontSize", { min: 12, max: 28 }, "px")}</div>
            <div className="prow"><span>行距</span>{num("lineHeight", { min: 1.2, max: 2.6, step: 0.05 })}</div>
            <div className="prow"><span>版心宽度<small>每行大约多少个字</small></span>{num("measure", { min: 24, max: 60 }, "字")}</div>
            <div className="prow"><span>Markdown 语法</span>{seg("syntax", [["active", "光标所在块显示"], ["always", "始终显示"]])}</div></>}
          {pane === "count" && <><h4>字数统计</h4>
            <div className="prow"><span>状态栏口径</span>{seg("countPunct", [[false, "不含标点"], [true, "含标点"]])}</div>
            <div className="prow"><span>写作目标<small>开启后状态栏显示进度</small></span>
              <div className="inline"><button className={"switch" + (s.goalOn ? " on" : "")} role="switch" aria-checked={s.goalOn} aria-label="写作目标" onClick={() => onChange({ goalOn: !s.goalOn })} />{num("goal", { min: 100, step: 500, disabled: !s.goalOn }, "字")}</div></div></>}
          {pane === "versions" && <><h4>版本</h4>
            <div className="prow"><span>自动版本间隔</span><div className="inline">{num("autoMinutes", { min: 1, max: 240 }, "分钟")}</div></div>
            <div className="prow"><span>外部修改合并<small>这段时间内的连续写入记为一条</small></span><div className="inline">{num("mergeSeconds", { min: 1, max: 600 }, "秒")}</div></div></>}
          {pane === "keys" && <><h4>快捷键</h4><KeyTable /></>}
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

export const KEYS: [string, string][] = [
  ["搜索与命令", "⌘ K"], ["保存版本", "⌘ S"], ["新建文稿", "⌘ N"], ["打开文件夹", "⌘ O"], ["设置", "⌘ ,"], ["查找", "⌘ F"],
  ["粗体 / 斜体", "⌘ B / ⌘ I"], ["删除线", "⌘ ⇧ X"], ["行内代码", "⌘ E"], ["行内公式", "⌘ ⇧ M"], ["链接", "⌘ ⇧ K"],
  ["正文 / 标题 1–3", "⌘ 0 / ⌘ 1–3"], ["无序 / 有序 / 任务列表", "⌘ ⇧ 8 / 7 / 9"], ["引用", "⌘ ⇧ ."],
  ["插入引用", "⌘ ⇧ C"], ["添加批注", "⌘ ⌥ M"], ["插入图片", "⌘ ⇧ I"],
  ["专注模式", "⌘ ⇧ F"], ["侧栏 / 右栏", "⌘ \\ / ⌘ /"], ["折叠功能区", "⌘ ⌥ R"], ["大纲 / 批注 / 版本", "⌘ ⌥ 1 / 2 / 3"],
  ["表格里换格", "Tab / ⇧ Tab"], ["离开当前块或表格", "Esc"],
];
export function KeyTable() {
  return <table className="kt"><tbody>{KEYS.map(([a, b]) => <tr key={a}><td>{a}</td><td><kbd>{b}</kbd></td></tr>)}</tbody></table>;
}

const SYNTAX: [string, string][] = [
  ["# 标题", "一级到六级标题，# 越多级别越低"], ["**粗体**  *斜体*", "强调"], ["~~删除线~~", "删除线"], ["`代码`", "行内代码"],
  ["- 项目", "无序列表；1. 是有序列表"], ["- [ ] 待办", "任务列表，点方框可以勾选"], ["> 引用", "引用块"],
  ["[文字](地址)", "链接；地址可以是文件夹里的文件"], ["![说明](图片路径)", "图片"], ["$公式$  $$公式$$", "行内公式与独立公式（LaTeX）"],
  ["```python", "代码块，后面写语言名"], ["```mermaid", "流程图、时序图等图表"], ["| 列 | 列 |", "表格，第二行是 | --- | --- |"],
  ["[@key]", "引用 .bib 里的文献"], ["{==原文==}{>>批注<<}", "批注（CriticMarkup）"], ["---", "分隔线；写在文件开头时是属性区"],
];
export function HelpDialog({ kind, onClose }: { kind: "syntax" | "keys"; onClose: () => void }) {
  return (
    <Scrim onClose={onClose} center>
      <div className="sheetdlg help" role="dialog" aria-label={kind === "syntax" ? "Markdown 语法速查" : "快捷键"}>
        <div className="dh"><h3>{kind === "syntax" ? "Markdown 语法速查" : "快捷键"}</h3><button className="ib close-x" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></div>
        <div className="db">{kind === "syntax"
          ? <table className="kt syn"><tbody>{SYNTAX.map(([a, b]) => <tr key={a}><td><code>{a}</code></td><td>{b}</td></tr>)}</tbody></table>
          : <KeyTable />}</div>
        <div className="df"><button className="btn acc" onClick={onClose}>好</button></div>
      </div>
    </Scrim>
  );
}
