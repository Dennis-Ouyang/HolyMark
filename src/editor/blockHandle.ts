/**
 * 块把手：鼠标停在某一块（目前是列表项）上时，左侧出现一个小把手。
 * - 点一下弹出小菜单（和应用的菜单同一套外观：.menu / .menu-item）；
 * - 按住拖动：上下换位置，左右改层级（由提供者决定能放在哪、放下后怎么改）。
 *
 * 做成通用的：每种块写一个 HandleProvider（给出把手对齐的位置、菜单、拖放规则），用 blockHandle([…]) 登记。
 * 所有提供者共用同一个把手（同一个插件，按登记顺序问，第一个认领的算），所以列表和其他块（N8）不会同时冒出两个把手。
 * 把手只在悬停时出现。
 */
import { Facet, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { iconSvg } from "../lib/icons";
import { openDomMenu, type DomMenuItem } from "./domMenu";

export type HandleMenuItem = DomMenuItem;

export interface DropSlot {
  /** 放在这个文档位置之前（行首；放到最后时是块的末尾） */
  before: number;
  /** 这个插入点在屏幕上的纵坐标（视口坐标） */
  y: number;
}

export interface HandleDrag {
  /** 能放下的位置 */
  slots(): DropSlot[];
  /** 拖到某个插入点、水平挪了 dx 像素时：指示线从哪里开始（视口横坐标），以及对应的层级 */
  place(slot: DropSlot, dx: number): { x: number; depth: number };
  drop(slot: DropSlot, depth: number): void;
}

export interface HandleTarget {
  /** 用来比较是不是同一个目标（比如列表项的行首位置） */
  key: number;
  /** 把手放在这个文档位置的左边，和这一行的第一行文字垂直居中 */
  anchor: number;
  menu(): HandleMenuItem[];
  drag?: HandleDrag;
  /** 菜单的名字（无障碍） */
  label: string;
  /** 把手离 anchor 多远（像素，默认 6）；列表留出折叠小三角的位置 */
  gap?: number;
}

export interface HandleProvider {
  /** 文档位置 pos 处有没有可以挂把手的块 */
  at(view: EditorView, pos: number): HandleTarget | null;
}

const HANDLE_W = 18;

class HandleView {
  el: HTMLButtonElement;
  line: HTMLDivElement;
  cur: HandleTarget | null = null;
  menu: { close: () => void } | null = null;
  dragging = false;
  raf = 0;
  constructor(readonly view: EditorView) {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "hm-handle";
    this.el.innerHTML = iconSvg("grip", 14);
    this.el.tabIndex = -1;
    this.line = document.createElement("div");
    this.line.className = "hm-dropline";
    document.body.append(this.el, this.line);
    this.el.addEventListener("mousedown", this.down);
    document.addEventListener("mousemove", this.move, { passive: true });
    window.addEventListener("scroll", this.hide, true);
  }

  destroy() {
    this.el.remove(); this.line.remove(); this.closeMenu();
    document.removeEventListener("mousemove", this.move);
    window.removeEventListener("scroll", this.hide, true);
  }

  update(u: ViewUpdate) { if (u.docChanged || u.geometryChanged) this.hide(); }

  hide = () => { if (this.dragging || this.menu) return; this.el.classList.remove("on"); this.cur = null; };

  /** 鼠标在正文（以及左边留给把手的那一条）上移动：找到下面的块，把手挪过去 */
  move = (e: MouseEvent) => {
    if (this.dragging || this.menu || e.buttons) return;
    cancelAnimationFrame(this.raf);
    const x = e.clientX, y = e.clientY;
    this.raf = requestAnimationFrame(() => {
      const r = this.view.contentDOM.getBoundingClientRect();
      if (e.target === this.el || this.el.contains(e.target as Node)) return;
      if (y < r.top || y > r.bottom || x > r.right || x < r.left - 72) { this.hide(); return; }
      // 正文上面盖着别的东西（对比页、浮层、对话框）时不出现：鼠标下最上面的元素得在正文所在的滚动区里
      const top = document.elementFromPoint(x, y);
      const area = this.view.scrollDOM.closest(".scroller") ?? this.view.scrollDOM;
      if (!top || !area.contains(top)) { this.hide(); return; }
      const pos = this.view.posAtCoords({ x: Math.max(x, r.left + 1), y }, false);
      let t: HandleTarget | null = null;
      for (const p of this.view.state.facet(handleProviders)) if ((t = p.at(this.view, pos))) break;
      if (!t) { this.hide(); return; }
      this.cur = t;
      const c = this.view.coordsAtPos(t.anchor, 1);
      if (!c) { this.hide(); return; }
      const lh = c.bottom - c.top;
      this.el.style.left = Math.round(c.left - HANDLE_W - (t.gap ?? 6)) + "px";
      this.el.style.top = Math.round(c.top + (lh - 22) / 2) + "px";
      this.el.setAttribute("aria-label", t.label);
      this.el.classList.add("on");
    });
  };

  /** 按下：没拖动就是点击（弹菜单），拖动超过 4px 进入拖放 */
  down = (e: MouseEvent) => {
    if (e.button !== 0 || !this.cur) return;
    e.preventDefault();
    const t = this.cur, x0 = e.clientX, y0 = e.clientY;
    let slots: DropSlot[] | null = null, slot: DropSlot | null = null, depth = 0;
    const mv = (ev: MouseEvent) => {
      if (!t.drag) return;
      if (!this.dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!this.dragging) { this.dragging = true; slots = t.drag.slots(); document.body.classList.add("hm-dragging"); this.el.classList.add("drag"); }
      slot = slots!.reduce((b, s) => (Math.abs(s.y - ev.clientY) < Math.abs(b.y - ev.clientY) ? s : b), slots![0]);
      const p = t.drag.place(slot, ev.clientX - x0);
      depth = p.depth;
      const r = this.view.contentDOM.getBoundingClientRect();
      this.line.style.left = Math.round(p.x) + "px";
      this.line.style.width = Math.max(40, Math.round(r.right - p.x)) + "px";
      this.line.style.top = Math.round(slot.y - 1) + "px";
      this.line.classList.add("on");
      this.el.style.top = Math.round(ev.clientY - 11) + "px";
    };
    const up = () => {
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
      if (this.dragging) {
        this.dragging = false;
        document.body.classList.remove("hm-dragging");
        this.el.classList.remove("drag", "on");
        this.line.classList.remove("on");
        if (slot) t.drag!.drop(slot, depth);
        this.view.focus();
      } else this.openMenu(t);
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
  };

  openMenu(t: HandleTarget) {
    this.closeMenu();
    this.el.classList.add("open");
    const close = openDomMenu(this.el, t.menu(), {
      label: t.label,
      onClose: () => { this.menu = null; this.el.classList.remove("open", "on"); this.view.focus(); },
    });
    this.menu = { close };
  }
  closeMenu() { this.menu?.close(); }
}

/** 登记过的把手提供者（按登记顺序） */
export const handleProviders = Facet.define<HandleProvider>();
const handlePlugin = ViewPlugin.define((view) => new HandleView(view));

export function blockHandle(providers: HandleProvider[]): Extension {
  return [providers.map((p) => handleProviders.of(p)), handlePlugin];
}
