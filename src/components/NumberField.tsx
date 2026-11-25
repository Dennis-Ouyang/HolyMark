/** 统一的数字输入：− 值 + 单位。方向键或两侧按钮按步长调整，回车或离开时生效；留空表示用默认值。 */
import { useEffect, useState } from "react";
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
  onCommit: (v: string) => void;
}

export function NumberField({ value, placeholder, min = -Infinity, max = Infinity, step = 1, unit, ariaLabel, disabled, onCommit }: Props) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const decimals = (String(step).split(".")[1] || "").length;
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = (v: string) => {
    const t = v.trim();
    if (t === "") { onCommit(""); return; }
    const n = parseFloat(t);
    if (Number.isNaN(n)) { setDraft(value); return; }
    const out = clamp(n).toFixed(decimals).replace(/\.0+$/, "");
    setDraft(out);
    if (out !== value) onCommit(out);
  };
  const bump = (dir: 1 | -1) => {
    const base = parseFloat(draft || placeholder || "0") || 0;
    commit(String(base + dir * step));
  };
  return (
    <span className={"numfield" + (disabled ? " disabled" : "")}>
      <button type="button" tabIndex={-1} aria-label={`减小${ariaLabel}`} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => bump(-1)}><Icon name="minus" size={12} /></button>
      <input value={draft} placeholder={placeholder} inputMode="decimal" aria-label={ariaLabel} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); bump(e.key === "ArrowUp" ? 1 : -1); }
        }} />
      <button type="button" tabIndex={-1} aria-label={`增大${ariaLabel}`} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => bump(1)}><Icon name="plus" size={12} /></button>
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}
