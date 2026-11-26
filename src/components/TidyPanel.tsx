/**
 * 中文排版整理：先算出会改哪些地方，列出每条规则改几处；点「整理」才动正文，之后提示条上可以撤销。
 * 重复字词只在正文里标出来，这里列出位置，点一下跳过去。
 */
import { useEffect, useMemo, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { tidy, TIDY_LABELS, TidyResult, TidyRule, TidyRules } from "../lib/tidy";
import { setTidyMarks } from "../editor/tidyMarks";
import { Icon } from "./Icons";

interface Props {
  view: EditorView;
  rules: TidyRules;
  /** 正文（节流过的），变了就重算 */
  text: string;
  /** 打开时的位置：从功能区按钮打开时贴着按钮，否则贴着正文区右上角 */
  at: { left: number; top: number; origin: string };
  onApply: (r: TidyResult, scope: string) => void;
  onSettings: () => void;
  onClose: () => void;
}

const ORDER: TidyRule[] = ["fullwidth", "spaces", "punct", "dash", "quotes", "space"];

export function planTidy(view: EditorView, rules: TidyRules) {
  const r = view.state.selection.main;
  const doc = view.state.doc.toString();
  const range = r.empty ? undefined : { from: r.from, to: r.to };
  return { result: tidy(doc, rules, range), scope: range ? "选中的文字" : "全文" };
}

export function TidyPanel({ view, rules, text, at, onApply, onSettings, onClose }: Props) {
  // text 只用来触发重算：打开着的时候改了正文，数目跟着变
  const plan = useMemo(() => planTidy(view, rules), [view, rules, text]);
  const { result, scope } = plan;
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => { go.current?.focus(); }, []);
  useEffect(() => {
    view.dispatch({ effects: setTidyMarks.of(result.repeats) });
  }, [view, result.repeats]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); } };
    addEventListener("keydown", f, true);
    return () => removeEventListener("keydown", f, true);
  }, [onClose]);
  const jump = (from: number, to: number) => {
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  };
  const snippet = (from: number, to: number) => {
    const doc = view.state.doc;
    const a = Math.max(0, from - 6), b = Math.min(doc.length, to + 6);
    const pre = doc.sliceString(a, from).replace(/\s+/g, " "), post = doc.sliceString(to, b).replace(/\s+/g, " ");
    return <>{a > 0 && "…"}{pre}<mark>{doc.sliceString(from, to)}</mark>{post}{b < doc.length && "…"}</>;
  };
  const rows = ORDER.filter((k) => result.counts[k] > 0);
  return (
    <div className="hm-float tidy" role="dialog" aria-label="中文排版整理" style={{ left: at.left, top: at.top, transformOrigin: at.origin }}
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("button")) e.preventDefault(); }}>
      <div className="tp-h"><b>中文排版整理</b><span className="tag">{scope}</span></div>
      {result.total > 0 ? <>
        <div className="tp-sum">将整理 <b className="num">{result.total.toLocaleString()}</b> 处</div>
        <div className="tp-rows">
          {rows.map((k) => <div key={k} className="tp-row"><span>{TIDY_LABELS[k]}</span><span className="num">{result.counts[k]}</span></div>)}
        </div>
      </> : <div className="tp-empty"><Icon name="check" size={16} /><span>没有需要整理的地方</span></div>}
      {result.repeats.length > 0 && <div className="tp-rep">
        <div className="tp-sub"><span>重复字词</span><span className="tag soft">只标出，不改</span><span className="num">{result.repeats.length}</span></div>
        <div className="tp-list">
          {result.repeats.slice(0, 8).map((r) => <button key={r.from} className="tp-hit" onClick={() => jump(r.from, r.to)}>{snippet(r.from, r.to)}</button>)}
          {result.repeats.length > 8 && <div className="tp-more">还有 {result.repeats.length - 8} 处，已在正文里标出</div>}
        </div>
      </div>}
      <div className="tp-foot">
        <button className="lnk" onClick={onSettings}>规则…</button>
        <span className="sp" />
        <button className="btn" onClick={onClose}>{result.total ? "取消" : "关闭"}</button>
        {result.total > 0 && <button ref={go} className="btn acc" onClick={() => onApply(planTidy(view, rules).result, scope)}>整理</button>}
      </div>
    </div>
  );
}
