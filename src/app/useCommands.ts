/**
 * 命令分发、快捷键同步（含 macOS 原生菜单重建）与全局键盘监听 hook（G6、N15）。
 */
import { useEffect, useMemo, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import type { EditorHandle } from "../editor/Editor";
import { Backend, isTauri } from "../lib/backend";
import type { Settings } from "../lib/settings";
import type { Heading } from "../lib/markdown";
import type { PanelTab } from "../components/SidePanel";
import type { PaletteItem, Pane } from "../components/Dialogs";
import { BlockKind, indentList, insertBlock, insertLink, insertNote, setBlock, shiftHeading, tableMarkdown, toggleInline } from "../editor/commands";
import { foldHeadings, foldToLevel, unfoldAll } from "../editor/sectionFold";
import { accelOf, COMMANDS, customShortcuts, keyCaps, loadShortcuts, menuSpec, onShortcutsChange, shortcutOf } from "../lib/commandRegistry";
import { menuIdFor } from "../lib/shortcuts";
import { kbd } from "../lib/platform";
import { COMMAND_ICON, DlgKind, nativeMenu, SayFn } from "./appUtils";

/** 阅读模式里不能编辑：改正文的菜单命令不执行 */
const editsDoc = (id: string) =>
  /^(block_|insert_)/.test(id) ||
  ["bold", "italic", "strike", "code", "math", "highlight", "sup", "sub", "link", "cite", "note", "indent", "outdent", "heading_up", "heading_down", "undo", "redo", "tidy", "math_symbols"].includes(id);

export interface UseCommandsArgs {
  be: Backend | null;
  s: Settings;
  sRef: React.MutableRefObject<Settings>;
  update: (p: Partial<Settings>) => void;
  root: string;
  single: string;
  path: string;
  viewing: string;
  setViewing: (p: string) => void;
  dlg: DlgKind;
  setDlg: React.Dispatch<React.SetStateAction<DlgKind>>;
  setReplaceQ: (q: string) => void;
  focus: boolean;
  setFocus: React.Dispatch<React.SetStateAction<boolean>>;
  setTab: (t: PanelTab) => void;
  toggleSide: () => void;
  togglePanel: () => void;
  openPanel: () => void;
  openSettings: (pane?: Pane) => void;
  openExport: () => void;
  ed: React.RefObject<EditorHandle>;
  view: () => EditorView | null;
  hs: Heading[];
  jump: (pos: number, rec?: boolean) => void;
  readingOn: boolean;
  toggleReading: () => void;
  navCanBack: boolean;
  navCanForward: boolean;
  navBack: () => void;
  navForward: () => void;
  refPanePath: string;
  closeRefPane: () => void;
  openTidy: () => void;
  openSymbols: () => void;
  copyFormatted: (target: "word" | "wechat") => void;
  newFile: () => void;
  chooseFolder: () => void;
  closeFolder: () => void;
  checkpoint: () => void;
  openInsert: () => void;
  pickImage: () => void;
  importDocx: () => void;
  requestClose: () => void;
  hasCmp: boolean;
  clearCompare: () => void;
  say: SayFn;
}

export function useCommands(a: UseCommandsArgs) {
  const { be, s, sRef, update, root, single, path, viewing, setViewing, dlg, setDlg, setReplaceQ, focus, setFocus, setTab, toggleSide, togglePanel, openPanel, openSettings, openExport, ed, view, hs, jump, readingOn, toggleReading, navCanBack, navCanForward, navBack, navForward, refPanePath, closeRefPane, openTidy, openSymbols, copyFormatted, newFile, chooseFolder, closeFolder, checkpoint, openInsert, pickImage, importDocx, requestClose, hasCmp, clearCompare, say } = a;

  function onMenu(id: string) {
    const v = view();
    const ae = document.activeElement as HTMLElement | null;
    const inField = !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae.isContentEditable && !ae.classList.contains("cm-content")));
    if (id === "undo" || id === "redo") {
      if (inField) document.execCommand(id);
      else if (id === "undo") ed.current?.undo(); else ed.current?.redo();
      return;
    }
    if (readingOn && editsDoc(id)) { say("阅读模式里不能编辑，双击正文或按 " + kbd("⌘⇧R") + " 回到编辑"); return; }
    const block = id.startsWith("block_") ? (id.slice(6) as BlockKind) : null;
    if (block) { if (v) setBlock(v, block); return; }
    const inline = { bold: "bold", italic: "italic", strike: "strike", code: "code", math: "math", highlight: "highlight", sup: "sup", sub: "sub" } as const;
    if (id in inline) { if (v) toggleInline(v, inline[id as keyof typeof inline]); return; }
    switch (id) {
      case "settings": openSettings(); break;
      case "tidy": if (path) openTidy(); break;
      case "reading": if (path) toggleReading(); break;
      case "copy_rich": case "copy_wechat": copyFormatted(id === "copy_wechat" ? "wechat" : "word"); break;
      case "folder_replace": if (root) { setReplaceQ(v && !v.state.selection.main.empty ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to).split("\n")[0] : ""); setDlg("replace"); } break;
      case "nav_back": navBack(); break;
      case "nav_forward": navForward(); break;
      case "math_symbols": if (path) openSymbols(); break;
      case "fold_all": if (v) foldHeadings(v, 1); break;
      case "unfold_all": if (v) unfoldAll(v); break;
      case "fold_h2": if (v) foldToLevel(v, 2); break;
      case "typewriter": update({ typewriter: !s.typewriter }); break;
      case "para_focus": update({ paraFocus: !s.paraFocus }); break;
      case "paper_default": case "paper_cream": case "paper_gray": update({ paper: id.slice(6) as Settings["paper"] }); break;
      case "close_preview": setViewing(""); break;
      case "ref_open": if (root || single) setDlg("refpick"); break;
      case "ref_close": closeRefPane(); break;
      case "new_file": newFile(); break;
      case "open_folder": chooseFolder(); break;
      case "close_folder": closeFolder(); break;
      case "save_version": if (path) checkpoint(); break;
      case "find": ed.current?.find(); break;
      case "search": setDlg((d) => (d === "palette" ? null : "palette")); break;
      case "link": if (v) insertLink(v); break;
      case "cite": openInsert(); break;
      case "note": if (v) insertNote(v); break;
      case "insert_table": if (v) insertBlock(v, tableMarkdown(2, 3), 2); break;
      case "insert_code": if (v) insertBlock(v, "```\n\n```", 4); break;
      case "insert_math": if (v) insertBlock(v, "$$\n\n$$", 3); break;
      case "insert_mermaid": if (v) insertBlock(v, "```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```", 11); break;
      case "insert_image": pickImage(); break;
      case "insert_hr": if (v) insertBlock(v, "---"); break;
      case "toggle_side": toggleSide(); break;
      case "toggle_panel": togglePanel(); break;
      case "toggle_ribbon": update({ ribbonCollapsed: !s.ribbonCollapsed }); break;
      case "focus": setFocus((x) => !x); break;
      case "panel_outline": openPanel(); setTab("outline"); break;
      case "panel_notes": openPanel(); setTab("notes"); break;
      case "panel_versions": openPanel(); setTab("versions"); break;
      case "toggle_syntax": update({ syntax: s.syntax === "always" ? "active" : "always" }); break;
      case "help_syntax": setDlg("help_syntax"); break;
      case "help_keys": setDlg("help_keys"); break;
      case "save_version_named": if (path) setDlg("save"); break;
      case "compare_file": if (path) setDlg("cmpfile"); break;
      case "import_docx": importDocx(); break;
      case "export": openExport(); break;
      case "quit": requestClose(); break;
      case "indent": if (v) indentList(v, 1); break;
      case "heading_up": if (v) shiftHeading(v, -1); break;
      case "heading_down": if (v) shiftHeading(v, 1); break;
      case "outdent": if (v) indentList(v, -1); break;
    }
  }

  const menuRef = useRef(onMenu);
  menuRef.current = onMenu;
  useEffect(() => { if (be) return be.onMenu((id) => menuRef.current(id)); }, [be]);

  // 自定义快捷键（N15）：启动时从设置里恢复；之后改了就存回设置（原生菜单的重建见下面）
  useEffect(() => {
    loadShortcuts(sRef.current.shortcuts);
    return onShortcutsChange(() => update({ shortcuts: customShortcuts() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // macOS 原生菜单按命令注册表生成；快捷键在运行时改了就重建（G6）
  useEffect(() => {
    if (!be || be.isDemo || !nativeMenu) return;
    const sync = () => { be.setMenu(menuSpec(), accelOf(shortcutOf("settings"))).catch(() => {}); };
    sync();
    return onShortcutsChange(sync);
  }, [be]);

  // 原生应用没有网页右键菜单；正文和输入框里保留系统的拷贝粘贴菜单
  useEffect(() => {
    if (!isTauri) return;
    const f = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".cm-content, input, textarea, [contenteditable=true]")) e.preventDefault();
    };
    addEventListener("contextmenu", f);
    return () => removeEventListener("contextmenu", f);
  }, []);

  // 没有原生菜单时（Windows、浏览器预览），菜单里的快捷键都在这里处理；
  // macOS 上原生菜单先接住这些按键，这里只兜底几个常用的
  const APP_LEVEL = useMemo(() => new Set(["folder_replace", "reading", "search", "save_version", "export", "settings", "focus", "toggle_side", "toggle_panel", "toggle_ribbon", "new_file", "open_folder", "panel_outline", "panel_notes", "panel_versions"]), []);
  const MAC_FALLBACK = useMemo(() => new Set(["reading", "search", "save_version", "settings", "focus", "toggle_side", "toggle_panel", "new_file", "open_folder"]), []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dlg && viewing) { setViewing(""); return; }
      if (e.key === "Escape" && !dlg) { if (hasCmp) clearCompare(); else if (focus) setFocus(false); return; }
      if (e.defaultPrevented || e.isComposing) return; // 编辑器自己处理过的（如 ⌘B），或正在用输入法
      const id = menuIdFor(e);
      if (!id || (nativeMenu && !MAC_FALLBACK.has(id))) return;
      // 焦点在输入框、表格单元格里时，格式和插入类的快捷键不作用到正文
      const ae = document.activeElement as HTMLElement | null;
      const inField = !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae.isContentEditable && !ae.classList.contains("cm-content")));
      if (inField && !APP_LEVEL.has(id)) return;
      e.preventDefault();
      menuRef.current(id);
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  });

  /** 命令此刻能不能用（⌘K 里只列能用的） */
  function commandAvailable(id: string) {
    switch (id) {
      case "close_folder": return !!(root || single);
      case "nav_back": return navCanBack;
      case "nav_forward": return navCanForward;
      case "close_preview": return !!viewing;
      case "ref_open": return !!(root || single);
      case "ref_close": return !!refPanePath;
      case "folder_replace": return !!root;
      case "paper_default": case "paper_cream": case "paper_gray": return s.paper !== id.slice(6);
      case "reading": case "fold_all": case "unfold_all": case "fold_h2": case "tidy": case "math_symbols": case "copy_rich": case "copy_wechat": return !!path;
      default: return true;
    }
  }
  /** 开关类命令现在是不是开着（⌘K 里显示「退出…」「关闭…」） */
  function commandOn(id: string) {
    return id === "reading" ? readingOn : id === "typewriter" ? s.typewriter : id === "para_focus" ? s.paraFocus : false;
  }
  // ⌘K 里的命令由命令注册表生成：能搜到所有命令（G6）
  const commands: PaletteItem[] = [
    ...COMMANDS.filter((c) => !c.hidden && commandAvailable(c.id)).map((c) => ({
      group: "命令", icon: COMMAND_ICON[c.id] ?? "cmd", title: (c.onTitle && commandOn(c.id) ? c.onTitle : c.paletteTitle ?? c.title), sub: c.sub ?? c.alias,
      keys: shortcutOf(c.id) ? keyCaps(shortcutOf(c.id)!) : undefined,
      run: () => setTimeout(() => menuRef.current(c.id), 0),
    })),
    ...hs.filter((h) => h.level >= 2).map((h) => ({ group: "跳转", icon: "go", title: h.text, run: () => jump(h.pos) })),
  ];

  return { menuRef, commands };
}
