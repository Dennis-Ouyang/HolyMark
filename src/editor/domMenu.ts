/**
 * 编辑器里（不是 React 的地方）弹出的小菜单：块把手、批注浮层的「更多」。
 * 外观和应用的 Menu 组件一样（.menu / .menu-item / .menu-sep），方向键选择、回车执行、Esc 或点外面关闭。
 */
import { iconSvg } from "../lib/icons";
import { kbd } from "../lib/platform";

export type DomMenuItem =
  | { sep: true }
  | { label: string; icon?: string; hint?: string; danger?: boolean; disabled?: boolean; run: () => void };

/** 在 anchor 下方（放不下就上方）弹出菜单；返回关闭函数 */
export function openDomMenu(anchor: HTMLElement, items: DomMenuItem[], opts: { label?: string; onClose?: () => void } = {}): () => void {
  const m = document.createElement("div");
  m.className = "menu hm-hmenu";
  m.setAttribute("role", "menu");
  if (opts.label) m.setAttribute("aria-label", opts.label);
  const btns: HTMLButtonElement[] = [];
  let at = -1;
  const hi = (k: number) => { btns.forEach((b, i) => b.classList.toggle("hi", i === k)); at = k; };
  for (const it of items) {
    if ("sep" in it) { const s = document.createElement("div"); s.className = "menu-sep"; s.setAttribute("role", "separator"); m.append(s); continue; }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item" + (it.danger ? " danger" : "");
    b.setAttribute("role", "menuitem");
    b.disabled = !!it.disabled;
    b.innerHTML = `<span class="mi">${it.icon ? iconSvg(it.icon, 14) : ""}</span><span class="ml"></span>${it.hint ? `<span class="mh">${kbd(it.hint)}</span>` : ""}`;
    b.querySelector(".ml")!.textContent = it.label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => { close(); it.run(); });
    b.addEventListener("mousemove", () => hi(btns.indexOf(b)));
    btns.push(b);
    m.append(b);
  }
  document.body.append(m);
  const ar = anchor.getBoundingClientRect(), mr = m.getBoundingClientRect();
  const left = Math.max(6, Math.min(ar.left, innerWidth - mr.width - 6));
  const below = ar.bottom + 4 + mr.height < innerHeight - 6;
  const top = below ? ar.bottom + 4 : Math.max(6, ar.top - 4 - mr.height);
  m.style.left = Math.round(left) + "px";
  m.style.top = Math.round(top) + "px";
  // 从触发的那个角长出来
  m.style.transformOrigin = `${Math.round(ar.left - left + ar.width / 2)}px ${below ? 0 : Math.round(mr.height)}px`;
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); e.stopPropagation();
      const live = btns.map((b, i) => (b.disabled ? -1 : i)).filter((i) => i >= 0);
      const k = live.indexOf(at), n = live.length;
      hi(live[((k < 0 ? (e.key === "ArrowDown" ? -1 : 0) : k) + (e.key === "ArrowDown" ? 1 : -1) + n) % n]);
    } else if (e.key === "Enter" && at >= 0) { e.preventDefault(); e.stopPropagation(); btns[at].click(); }
  };
  const outside = (e: MouseEvent) => { if (!m.contains(e.target as Node)) close(); };
  addEventListener("keydown", key, true);
  addEventListener("mousedown", outside, true);
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    removeEventListener("keydown", key, true);
    removeEventListener("mousedown", outside, true);
    m.classList.add("leaving");
    setTimeout(() => m.remove(), 100);
    opts.onClose?.();
  }
  return close;
}
