import { useEffect, useMemo, useRef, useState } from "react";
import { ACCENTS, AccentName, fontStack, Settings } from "../lib/settings";
import type { FontFamily } from "../lib/backend";
import { FontSelect } from "./Select";
import { NumberField } from "./NumberField";
import { Icon } from "./Icons";
import { isWindows, kbd } from "../lib/platform";
import { Segmented } from "./Segmented";

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
const PANES: [Pane, string][] = [["general", "通用"], ["editor", "编辑器"], ["count", "字数统计"], ["versions", "版本"], ["keys", "快捷键"]];

/** 设置里的一行：左边名称（可带说明），右边控件 */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="prow"><div className="pl">{label}{hint && <small>{hint}</small>}</div><div className="pc">{children}</div></div>;
}

export function SettingsDialog({ s, fonts, onChange, onClose }: { s: Settings; fonts: FontFamily[]; onChange: (p: Partial<Settings>) => void; onClose: () => void }) {
  const [pane, setPane] = useState<Pane>("editor");
  const num = (k: keyof Settings, attrs: { min: number; max?: number; step?: number; disabled?: boolean }, unit?: string) => (
    <NumberField value={String(s[k])} {...attrs} unit={unit} ariaLabel={String(k)} onCommit={(v) => { const n = parseFloat(v); if (!Number.isNaN(n)) onChange({ [k]: n } as Partial<Settings>); }} />
  );
  const sw = (k: "showAllFiles" | "goalOn" | "askOnClose", label: string) => (
    <button className={"switch" + (s[k] ? " on" : "")} role="switch" aria-checked={s[k]} aria-label={label} onClick={() => onChange({ [k]: !s[k] } as Partial<Settings>)} />
  );
  return (
    <Scrim onClose={onClose} center>
      <div className="prefs" role="dialog" aria-label="设置">
        <nav>
          <div className="tl">设置</div>
          {PANES.map(([k, l]) => <button key={k} className={pane === k ? "on" : ""} onClick={() => setPane(k)}>{l}</button>)}
        </nav>
        <div className="pb">
          <div className="pbh"><h4>{PANES.find(([k]) => k === pane)![1]}</h4><button className="ib" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></div>
          {pane === "general" && <>
            <Row label="外观"><Segmented label="外观" value={s.theme} options={[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} onChange={(v) => onChange({ theme: v })} /></Row>
            <Row label="主题色" hint="按钮、选中和光标的颜色">
              <div className="swatches" role="radiogroup" aria-label="主题色">
                {(Object.keys(ACCENTS) as AccentName[]).map((k) => (
                  <button key={k} role="radio" aria-checked={s.accent === k} aria-label={ACCENTS[k].name} title={ACCENTS[k].name} className={"sw" + (s.accent === k ? " on" : "")}
                    style={{ "--c": ACCENTS[k].light[0], "--cd": ACCENTS[k].dark[0] } as React.CSSProperties} onClick={() => onChange({ accent: k })}>
                    <Icon name="check" size={12} />
                  </button>
                ))}
                <span className="swname">{ACCENTS[s.accent].name}</span>
              </div>
            </Row>
            <Row label="文件树" hint="关闭时只显示 Markdown 文件"><label className="inline">{sw("showAllFiles", "显示所有文件")}<span>显示所有文件</span></label></Row>
            <Row label="关闭应用时" hint="不保存的修改会留在「版本」里，随时能找回"><label className="inline">{sw("askOnClose", "询问是否保存修改")}<span>有修改时询问是否保存</span></label></Row>
          </>}
          {pane === "editor" && <>
            <EditorPreview s={s} />
            <Row label="标题字体" hint={isWindows ? "列出的是这台电脑上装的字体" : "列出的是这台 Mac 上装的字体"}><FontSelect value={s.headingFont} fonts={fonts} ariaLabel="标题字体" onChange={(v) => onChange({ headingFont: v })} /></Row>
            <Row label="正文字体"><FontSelect value={s.bodyFont} fonts={fonts} ariaLabel="正文字体" onChange={(v) => onChange({ bodyFont: v })} /></Row>
            <Row label="字号">{num("fontSize", { min: 12, max: 28 }, "px")}</Row>
            <Row label="行距">{num("lineHeight", { min: 1.2, max: 2.6, step: 0.05 }, "倍")}</Row>
            <Row label="版心宽度" hint="每行大约多少个字">{num("measure", { min: 24, max: 60 }, "字")}</Row>
            <Row label="Markdown 符号"><Segmented label="Markdown 符号" value={s.syntax} options={[["active", "光标所在处显示"], ["always", "始终显示"]]} onChange={(v) => onChange({ syntax: v })} /></Row>
          </>}
          {pane === "count" && <>
            <Row label="状态栏字数"><Segmented label="状态栏字数" value={s.countPunct} options={[[false, "不含标点"], [true, "含标点"]]} onChange={(v) => onChange({ countPunct: v })} /></Row>
            <Row label="写作目标" hint="开启后状态栏显示进度"><div className="inline">{sw("goalOn", "写作目标")}{num("goal", { min: 100, step: 500, disabled: !s.goalOn }, "字")}</div></Row>
          </>}
          {pane === "versions" && <>
            <Row label="自动版本间隔">{num("autoMinutes", { min: 1, max: 240 }, "分钟")}</Row>
            <Row label="外部修改合并" hint="这段时间内的连续写入记为一条">{num("mergeSeconds", { min: 1, max: 600 }, "秒")}</Row>
          </>}
          {pane === "keys" && <KeyTable />}
        </div>
      </div>
    </Scrim>
  );
}

/** 编辑器默认值的实时预览：标题和正文放在一起，按设置的字号、行距、版心宽度排出来 */
function EditorPreview({ s }: { s: Settings }) {
  const width = s.measure * s.fontSize;
  return (
    <div className="edprev" aria-label="预览">
      <div className="epv-scroll">
        <div className="epv-col" style={{ width, fontSize: s.fontSize, lineHeight: s.lineHeight }}>
          <div className="epv-h" style={{ fontFamily: fontStack(s.headingFont) }}>这是标题的预览。</div>
          <p className="epv-b" style={{ fontFamily: fontStack(s.bodyFont) }}>这是正文部分的预览。你在此设置的是 HolyMark 打开所有文件时的默认值，如果你只想设置单个文件的显示方式，请在功能区“版式”中单独设置。</p>
        </div>
      </div>
      <div className="epv-meta"><span>字号 {s.fontSize} px</span><span>行距 {s.lineHeight}</span><span>版心 {s.measure} 字 · {width} px</span></div>
    </div>
  );
}

/* ---------------- 关闭前：要不要保存修改 ---------------- */
export function UnsavedDialog({ fileName, onSave, onDiscard, onCancel }: { fileName: string; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  return (
    <Scrim onClose={onCancel} center>
      <div className="sheetdlg ask" role="alertdialog" aria-labelledby="ask-t" aria-describedby="ask-d">
        <h3 id="ask-t">关闭前要保存修改吗？</h3>
        <div className="ask-file" title={fileName}><Icon name="doc" size={14} /><span>{fileName}</span></div>
        <p id="ask-d">不保存，文件会回到这次打开时的样子；刚才写的内容会留在「版本」里，随时能找回。</p>
        <div className="df split">
          <button className="btn" onClick={onDiscard}>不保存</button>
          <span className="sp" />
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn acc" autoFocus onClick={onSave}>保存</button>
        </div>
      </div>
    </Scrim>
  );
}

/* ---------------- ⌘K：搜索与命令 ---------------- */
export interface PaletteItem { group: string; icon: string; title: string; sub?: string; keys?: string[]; run: () => void }
export function Palette({ items, search, onClose, placeholder, pinned }: { items: PaletteItem[]; search: (q: string) => PaletteItem[]; onClose: () => void; placeholder: string; pinned?: PaletteItem }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const cmds = items.filter((c) => c !== pinned && (!ql || (c.title + " " + (c.sub || "")).toLowerCase().includes(ql)));
    const out = ql ? [...search(q.trim()), ...cmds.slice(0, 12)] : cmds;
    // 固定项（比如“选择其他文件…”）搜索时也一直在最后
    return pinned ? [...out, pinned] : out;
  }, [q, items, search, pinned]);
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
    // 点状态栏上打开它的那个按钮由按钮自己处理（再点一次是关闭），这里不抢
    const f = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-countpop]")) onClose(); };
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
  ["正文 / 标题 1–6", "⌘ 0 / ⌘ 1–6"], ["提升 / 降低标题级别", "⌘ = / ⌘ -"], ["高亮", "⌘ ⇧ H"], ["无序 / 有序 / 待办列表", "⌘ ⇧ 8 / 7 / 9"], ["子列表 / 回到上一级", "Tab / ⇧ Tab（或 ⌘ ] / ⌘ [）"], ["引用", "⌘ ⇧ ."],
  ["引用文献或文件", "⌘ ⇧ C"], ["导出", "⌘ ⇧ E"], ["添加批注", "⌘ ⌥ M"], ["插入图片", "⌘ ⇧ I"],
  ["专注模式", "⌘ ⇧ F"], ["侧栏 / 右栏", "⌘ \\ / ⌘ /"], ["折叠功能区", "⌘ ⌥ R"], ["大纲 / 批注 / 版本", "⌘ ⌥ 1 / 2 / 3"],
  ["表格里换格", "Tab / ⇧ Tab"], ["离开当前块或表格", "Esc"],
];
export function KeyTable() {
  return <table className="kt"><tbody>{KEYS.map(([a, b]) => <tr key={a}><td>{a}</td><td><kbd>{kbd(b)}</kbd></td></tr>)}</tbody></table>;
}

const SYNTAX: [string, string][] = [
  ["# 标题", "一级到六级标题，# 越多级别越低"], ["**粗体**  *斜体*", "强调"], ["~~删除线~~", "删除线"], ["==高亮==", "高亮（导出 Word 是黄色底）"], ["x^2^  H~2~O", "上标、下标"], ["![说明](图.png){width=60%}", "图片宽度（点图片可以直接拖）"], ["`代码`", "行内代码"],
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
