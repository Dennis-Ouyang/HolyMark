/** 新功能在设置里的几页 / 几行。Dialogs.tsx 里只接线，内容放在这里。 */
import type { Settings } from "../lib/settings";
import type { TidyRules } from "../lib/tidy";
import { Segmented } from "./Segmented";

export function SRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="prow"><div className="pl">{label}{hint && <small>{hint}</small>}</div><div className="pc">{children}</div></div>;
}
export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <label className="inline"><button className={"switch" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} /><span>{label}</span></label>;
}

/** 设置 → 排版整理：每条规则一行 */
export function TidySettings({ s, onChange }: { s: Settings; onChange: (p: Partial<Settings>) => void }) {
  const t = s.tidy;
  const set = (p: Partial<TidyRules>) => onChange({ tidy: { ...t, ...p } });
  return <>
    <p className="pnote">只在你执行「中文排版整理」时才改，打字时不会自动改。代码、公式、链接地址、文献引用、批注标记和 HTML 永远不动。</p>
    <SRow label="中英文之间的空格"><Segmented label="中英文之间的空格" value={t.space} options={[["off", "不处理"], ["add", "加空格"], ["remove", "去掉"]]} onChange={(v) => set({ space: v })} /></SRow>
    <SRow label="半角标点" hint="只在紧挨着中文时转；英文句子、数字、网址不动"><Switch on={t.punct} label="转成全角" onChange={(v) => set({ punct: v })} /></SRow>
    <SRow label="引号"><Segmented label="引号" value={t.quotes} options={[["off", "不处理"], ["corner", "「」"], ["curly", "“”"]]} onChange={(v) => set({ quotes: v })} /></SRow>
    <SRow label="省略号和破折号" hint="... 和 。。。 转成 ……，-- 转成 ——"><Switch on={t.dash} label="转换" onChange={(v) => set({ dash: v })} /></SRow>
    <SRow label="全角字母、数字"><Switch on={t.fullwidth} label="转成半角" onChange={(v) => set({ fullwidth: v })} /></SRow>
    <SRow label="多余的空格" hint="行首缩进和 Markdown 的硬换行保留"><Switch on={t.spaces} label="清理连续空格、行末空格" onChange={(v) => set({ spaces: v })} /></SRow>
    <SRow label="重复字词" hint="的的、了了这类只标出来，不改"><Switch on={t.repeats} label="提示" onChange={(v) => set({ repeats: v })} /></SRow>
  </>;
}
