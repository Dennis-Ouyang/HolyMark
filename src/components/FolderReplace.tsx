/**
 * N9 在整个文件夹里查找替换：输入替换内容后，每一处都显示替换前后（删的字划掉标红，加的字浅绿底），
 * 每一处都可以取消勾选。选项：区分大小写、全词、正则（默认都关）；只改 Markdown；默认跳过代码块。
 * 执行交给 App：先给每个要改的文件存版本再写入，当前打开的文件在编辑器里改（进撤销历史），提示条带「撤销」。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { applyMatches, buildRegex, context, FIND_DEFAULTS, findMatches, FindOptions, Match } from "../lib/replace";
import { middleTruncate } from "../lib/fileInfo";
import { baseName, dirOf, relative } from "../lib/paths";
import { Icon } from "./Icons";

export interface ReplaceItem { path: string; before: string; after: string; matches: Match[] }

interface Props {
  files: string[];
  root: string;
  read: (path: string) => Promise<string>;
  initial: string;
  onApply: (items: ReplaceItem[]) => Promise<void>;
  onClose: () => void;
}

export function FolderReplace({ files, root, read, initial, onApply, onClose }: Props) {
  const [q, setQ] = useState(initial);
  const [r, setR] = useState("");
  const [o, setO] = useState<FindOptions>(FIND_DEFAULTS);
  const [texts, setTexts] = useState<Map<string, string> | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const replIn = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let dead = false;
    Promise.all(files.map(async (p) => [p, await read(p).catch(() => "")] as const)).then((es) => { if (!dead) setTexts(new Map(es)); });
    return () => { dead = true; };
  }, [files, read]);
  useEffect(() => { if (initial) replIn.current?.focus(); }, [initial]);
  useEffect(() => setOff(new Set()), [q, o]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); } };
    addEventListener("keydown", f, true);
    return () => removeEventListener("keydown", f, true);
  }, [onClose]);

  const err = q ? buildRegex(q, o) : null;
  const results = useMemo(() => {
    if (!texts || !q || typeof err === "string") return [];
    return files.map((p) => ({ path: p, text: texts.get(p) ?? "", matches: findMatches(texts.get(p) ?? "", q, r, o, 2000) })).filter((x) => x.matches.length);
  }, [texts, files, q, r, o, err]);
  const key = (p: string, m: Match) => `${p}\u0000${m.from}`;
  const chosen = results.map((x) => ({ ...x, matches: x.matches.filter((m) => !off.has(key(x.path, m))) })).filter((x) => x.matches.length);
  const total = chosen.reduce((n, x) => n + x.matches.length, 0);
  const toggle = (ks: string[], on: boolean) => setOff((s) => { const n = new Set(s); ks.forEach((k) => (on ? n.delete(k) : n.add(k))); return n; });

  const run = async () => {
    if (!total || busy) return;
    setBusy(true);
    try { await onApply(chosen.map((x) => ({ path: x.path, before: x.text, after: applyMatches(x.text, x.matches), matches: x.matches }))); }
    finally { setBusy(false); }
  };
  const opt = (k: "caseSensitive" | "wholeWord" | "regex", label: string, title: string) => (
    <button type="button" className={"fr-opt" + (o[k] ? " on" : "")} aria-pressed={o[k]} title={title} onClick={() => setO({ ...o, [k]: !o[k] })}>{label}</button>
  );
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="frep" role="dialog" aria-label="在文件夹里替换">
        <div className="fr-row">
          <Icon name="search" size={16} />
          <input autoFocus={!initial} value={q} onChange={(e) => setQ(e.target.value)} placeholder="在文件夹里查找" aria-label="查找" spellCheck={false} />
          {opt("caseSensitive", "Aa", "区分大小写")}{opt("wholeWord", "全词", "全词匹配（英文、数字）")}{opt("regex", ".*", "正则表达式")}
        </div>
        <div className="fr-row">
          <Icon name="replace" size={16} />
          <input ref={replIn} value={r} onChange={(e) => setR(e.target.value)} placeholder={o.regex ? "替换为（可以用 $1 引用分组）" : "替换为"} aria-label="替换为" spellCheck={false}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void run(); } }} />
          <label className="fr-skip"><input type="checkbox" checked={o.skipCode} onChange={(e) => setO({ ...o, skipCode: e.target.checked })} />跳过代码和链接地址</label>
        </div>
        <div className="fr-body">
          {typeof err === "string" && err && <div className="fr-err" role="alert">正则表达式有误：{err}</div>}
          {!texts && <div className="empty">正在读取文件夹里的文稿…</div>}
          {texts && q && typeof err !== "string" && !results.length && <div className="empty">文件夹里的 Markdown 文稿中没有找到「{q}」</div>}
          {texts && !q && <div className="empty">输入要查找的文字，只在 Markdown 文稿里找</div>}
          {results.map((x) => {
            const ks = x.matches.map((m) => key(x.path, m));
            const n = ks.filter((k) => !off.has(k)).length;
            return (
              <div key={x.path} className="fr-file">
                <label className="fr-fh">
                  <input type="checkbox" checked={n === ks.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < ks.length; }} onChange={(e) => toggle(ks, e.target.checked)} />
                  <Icon name="doc" size={14} /><b title={x.path}>{middleTruncate(baseName(x.path).replace(/\.(md|markdown)$/i, ""), 32)}</b>
                  <small>{root ? relative(root, dirOf(x.path)).replace(/^\.$/, "") : dirOf(x.path)}</small><span className="num">{n} / {ks.length}</span>
                </label>
                {x.matches.slice(0, 200).map((m) => {
                  const k = key(x.path, m), c = context(x.text, m);
                  return (
                    <label key={k} className={"fr-hit" + (off.has(k) ? " off" : "")}>
                      <input type="checkbox" checked={!off.has(k)} onChange={(e) => toggle([k], e.target.checked)} />
                      <span className="fr-line">{c.pre}<del>{m.text}</del>{m.replacement && <ins>{m.replacement}</ins>}{c.post}</span>
                    </label>
                  );
                })}
                {x.matches.length > 200 && <div className="fr-more">这篇还有 {x.matches.length - 200} 处没列出来，执行时一起替换</div>}
              </div>
            );
          })}
        </div>
        <div className="fr-foot">
          <span className="num">{total ? `将在 ${chosen.length} 个文件里替换 ${total} 处` : ""}</span>
          <span className="sp" />
          <button className="btn" onClick={onClose}>取消</button>
          <button className={"btn acc" + (busy ? " loading" : "")} disabled={!total || busy} onClick={() => void run()}><span className="lbl">替换</span></button>
        </div>
      </div>
    </div>
  );
}
