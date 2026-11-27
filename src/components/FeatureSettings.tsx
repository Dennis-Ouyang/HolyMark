/** 新功能在设置里的几页 / 几行。Dialogs.tsx 里只接线，内容放在这里。 */
import { FONT_PRESETS, Settings } from "../lib/settings";
import type { TidyRules } from "../lib/tidy";
import { Segmented } from "./Segmented";

export function SRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="prow"><div className="pl">{label}{hint && <small>{hint}</small>}</div><div className="pc">{children}</div></div>;
}
export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <label className="inline"><button className={"switch" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} /><span>{label}</span></label>;
}

/** 设置 → 编辑器里的阅读和书写环境（N13）：字体组合预设、纸张底色、打字机滚动、段落聚焦 */
export function EnvSettings({ s, onChange }: { s: Settings; onChange: (p: Partial<Settings>) => void }) {
  return <>
    <SRow label="字体组合" hint="一次填好标题和正文字体，之后还能单独改">
      <div className="presets">{FONT_PRESETS.map((p) => (
        <button key={p.id} type="button" className={"btn sm" + (s.headingFont === p.heading && s.bodyFont === p.body ? " on" : "")} onClick={() => onChange({ headingFont: p.heading, bodyFont: p.body })}>{p.name}</button>
      ))}</div>
    </SRow>
    <SRow label="纸张底色" hint="只作用于正文区"><Segmented label="纸张底色" value={s.paper} options={[["default", "默认"], ["cream", "米白"], ["gray", "护眼灰"]]} onChange={(v) => onChange({ paper: v })} /></SRow>
    <SRow label="打字机滚动" hint="打字时光标所在行停在屏幕中间偏上"><Switch on={s.typewriter} label="开启" onChange={(v) => onChange({ typewriter: v })} /></SRow>
    <SRow label="段落聚焦" hint="其他段落变淡；专注模式里标题栏也有开关"><Switch on={s.paraFocus} label="开启" onChange={(v) => onChange({ paraFocus: v })} /></SRow>
  </>;
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
