/**
 * 统一的数字输入：− 值 + 单位。方向键或两侧按钮按步长调整，回车或离开时生效；留空表示用默认值。
 * 输入不合法时不悄悄改掉：超出范围就改成边界值，同时在框下面用一行小字说明（「最大 10 厘米」），
 * 不是数字就恢复原值并说明（H27）。
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

interface Props {
  value: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  ariaLabel: string;
  disabled?: boolean;
  /** 说明里用的单位名（框里不显示单位时，比如页边距写在行标题里的「厘米」） */
  unitLabel?: string;
  onCommit: (v: string) => void;
}

export function NumberField({ value, placeholder, min = -Infinity, max = Infinity, step = 1, unit, ariaLabel, disabled, unitLabel, onCommit }: Props) {
  const [draft, setDraft] = useState(value);
  const [msg, setMsg] = useState("");
  const msgTimer = useRef(0);
  const tell = (m: string) => { setMsg(m); window.clearTimeout(msgTimer.current); msgTimer.current = window.setTimeout(() => setMsg(""), 3500); };
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => window.clearTimeout(msgTimer.current), []);
  const unitName = unitLabel ? ` ${unitLabel}` : unit ? ` ${unit}` : "";
  const decimals = (String(step).split(".")[1] || "").length;
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = (v: string) => {
    const t = v.trim();
    if (t === "") { onCommit(""); return; }
    const n = parseFloat(t);
    if (Number.isNaN(n) || !/^[-+]?\d*\.?\d+\s*$/.test(t)) { setDraft(value); tell("请输入数字"); return; }
    if (n > max) tell(`最大 ${max}${unitName}`);
    else if (n < min) tell(`最小 ${min}${unitName}`);
    const out = clamp(n).toFixed(decimals).replace(/\.0+$/, "");
    setDraft(out);
    if (out !== value) onCommit(out);
  };
  const bump = (dir: 1 | -1) => {
    const base = parseFloat(draft || placeholder || "0") || 0;
    commit(String(base + dir * step));
  };
  return (
    <span className={"numfield" + (disabled ? " disabled" : "") + (msg ? " invalid" : "")}>
      <button type="button" tabIndex={-1} aria-label={`减小${ariaLabel}`} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => bump(-1)}><Icon name="minus" size={12} /></button>
      <input value={draft} placeholder={placeholder} inputMode="decimal" aria-label={ariaLabel} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); bump(e.key === "ArrowUp" ? 1 : -1); }
        }} />
      <button type="button" tabIndex={-1} aria-label={`增大${ariaLabel}`} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => bump(1)}><Icon name="plus" size={12} /></button>
      {unit && <span className="unit">{unit}</span>}
      {msg && <span className="nf-msg" role="alert">{msg}</span>}
    </span>
  );
}
