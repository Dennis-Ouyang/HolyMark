/**
 * 图标：Tabler Icons（MIT 许可，https://tabler.io/icons），24 格、线条风格统一。
 * 只引用用到的那几十个，打包时不会把整套都带进来。React 组件（Icons.tsx）和不是 React 的地方（表格工具条）共用这一份。
 * 要换、要加图标：在 tabler.io/icons 找到名字，在下面加一行 import 和对应的名字。
 */
import i_side from "@tabler/icons/outline/layout-sidebar.svg?raw";
import i_panel from "@tabler/icons/outline/layout-sidebar-right.svg?raw";
import i_search from "@tabler/icons/outline/search.svg?raw";
import i_focus from "@tabler/icons/outline/focus-centered.svg?raw";
import i_folder from "@tabler/icons/outline/folder.svg?raw";
import i_doc from "@tabler/icons/outline/file-text.svg?raw";
import i_file from "@tabler/icons/outline/file.svg?raw";
import i_chev from "@tabler/icons/outline/chevron-down.svg?raw";
import i_gear from "@tabler/icons/outline/settings.svg?raw";
import i_check from "@tabler/icons/outline/check.svg?raw";
import i_plus from "@tabler/icons/outline/plus.svg?raw";
import i_minus from "@tabler/icons/outline/minus.svg?raw";
import i_rowAbove from "@tabler/icons/outline/row-insert-top.svg?raw";
import i_rowBelow from "@tabler/icons/outline/row-insert-bottom.svg?raw";
import i_colLeft from "@tabler/icons/outline/column-insert-left.svg?raw";
import i_colRight from "@tabler/icons/outline/column-insert-right.svg?raw";
import i_delRow from "@tabler/icons/outline/row-remove.svg?raw";
import i_delCol from "@tabler/icons/outline/column-remove.svg?raw";
import i_source from "@tabler/icons/outline/source-code.svg?raw";
import i_code from "@tabler/icons/outline/code.svg?raw";
import i_math from "@tabler/icons/outline/math-function.svg?raw";
import i_link from "@tabler/icons/outline/link.svg?raw";
import i_note from "@tabler/icons/outline/message.svg?raw";
import i_ul from "@tabler/icons/outline/list.svg?raw";
import i_ol from "@tabler/icons/outline/list-numbers.svg?raw";
import i_task from "@tabler/icons/outline/list-check.svg?raw";
import i_quote from "@tabler/icons/outline/blockquote.svg?raw";
import i_table from "@tabler/icons/outline/table.svg?raw";
import i_img from "@tabler/icons/outline/photo.svg?raw";
import i_codeb from "@tabler/icons/outline/source-code.svg?raw";
import i_mathb from "@tabler/icons/outline/math.svg?raw";
import i_mermaid from "@tabler/icons/outline/hierarchy-3.svg?raw";
import i_cite from "@tabler/icons/outline/paperclip.svg?raw";
import i_hr from "@tabler/icons/outline/separator-horizontal.svg?raw";
import i_back from "@tabler/icons/outline/chevron-left.svg?raw";
import i_close from "@tabler/icons/outline/x.svg?raw";
import i_up from "@tabler/icons/outline/chevron-up.svg?raw";
import i_cmd from "@tabler/icons/outline/terminal-2.svg?raw";
import i_go from "@tabler/icons/outline/arrow-right.svg?raw";
import i_reset from "@tabler/icons/outline/arrow-back-up.svg?raw";
import i_open from "@tabler/icons/outline/external-link.svg?raw";
import i_warn from "@tabler/icons/outline/alert-triangle.svg?raw";
import i_highlight from "@tabler/icons/outline/highlight.svg?raw";
import i_indent from "@tabler/icons/outline/indent-increase.svg?raw";
import i_outdent from "@tabler/icons/outline/indent-decrease.svg?raw";
import i_compare from "@tabler/icons/outline/columns-2.svg?raw";
import i_edit from "@tabler/icons/outline/pencil.svg?raw";
import i_copy from "@tabler/icons/outline/copy.svg?raw";
import i_trash from "@tabler/icons/outline/trash.svg?raw";
import i_export from "@tabler/icons/outline/file-export.svg?raw";
import i_bold from "@tabler/icons/outline/bold.svg?raw";
import i_italic from "@tabler/icons/outline/italic.svg?raw";
import i_strike from "@tabler/icons/outline/strikethrough.svg?raw";
import i_sup from "@tabler/icons/outline/superscript.svg?raw";
import i_sub from "@tabler/icons/outline/subscript.svg?raw";
import i_resize from "@tabler/icons/outline/arrows-diagonal-2.svg?raw";
import i_pdf from "@tabler/icons/outline/file-type-pdf.svg?raw";
import i_word from "@tabler/icons/outline/file-type-docx.svg?raw";
import i_ppt from "@tabler/icons/outline/presentation.svg?raw";
import i_excel from "@tabler/icons/outline/file-spreadsheet.svg?raw";
import i_markdown from "@tabler/icons/outline/markdown.svg?raw";
import i_bib from "@tabler/icons/outline/bookmark.svg?raw";
import i_grip from "@tabler/icons/outline/grip-vertical.svg?raw";
import i_down from "@tabler/icons/outline/arrow-down.svg?raw";
import i_upArrow from "@tabler/icons/outline/arrow-up.svg?raw";
import i_fileOff from "@tabler/icons/outline/file-off.svg?raw";
import i_dots from "@tabler/icons/outline/dots.svg?raw";
import i_info from "@tabler/icons/outline/info-circle.svg?raw";
import i_external from "@tabler/icons/outline/external-link.svg?raw";
import i_eye from "@tabler/icons/outline/eye.svg?raw";
import i_chevRight from "@tabler/icons/outline/chevron-right.svg?raw";
import i_zip from "@tabler/icons/outline/file-zip.svg?raw";
import i_photo from "@tabler/icons/outline/photo.svg?raw";
import i_movie from "@tabler/icons/outline/movie.svg?raw";
import i_music from "@tabler/icons/outline/music.svg?raw";
import i_braces from "@tabler/icons/outline/braces.svg?raw";
import i_fileUnknown from "@tabler/icons/outline/file-unknown.svg?raw";
import i_moveTo from "@tabler/icons/outline/folder-symlink.svg?raw";
import i_folderPlus from "@tabler/icons/outline/folder-plus.svg?raw";
import i_filePlus from "@tabler/icons/outline/file-plus.svg?raw";
import i_pencil from "@tabler/icons/outline/pencil.svg?raw";
import i_alignLeft from "@tabler/icons/outline/align-left.svg?raw";
import i_alignCenter from "@tabler/icons/outline/align-center.svg?raw";
import i_alignRight from "@tabler/icons/outline/align-right.svg?raw";
import i_rows from "@tabler/icons/outline/layout-rows.svg?raw";
import i_outline from "@tabler/icons/outline/list-tree.svg?raw";
import i_history from "@tabler/icons/outline/history.svg?raw";

const RAW: Record<string, string> = {
  side: i_side,
  panel: i_panel,
  search: i_search,
  focus: i_focus,
  folder: i_folder,
  doc: i_doc,
  file: i_file,
  chev: i_chev,
  gear: i_gear,
  check: i_check,
  plus: i_plus,
  minus: i_minus,
  rowAbove: i_rowAbove,
  rowBelow: i_rowBelow,
  colLeft: i_colLeft,
  colRight: i_colRight,
  delRow: i_delRow,
  delCol: i_delCol,
  source: i_source,
  code: i_code,
  math: i_math,
  link: i_link,
  note: i_note,
  ul: i_ul,
  ol: i_ol,
  task: i_task,
  quote: i_quote,
  table: i_table,
  img: i_img,
  codeb: i_codeb,
  mathb: i_mathb,
  mermaid: i_mermaid,
  cite: i_cite,
  hr: i_hr,
  back: i_back,
  close: i_close,
  up: i_up,
  cmd: i_cmd,
  go: i_go,
  reset: i_reset,
  open: i_open,
  warn: i_warn,
  highlight: i_highlight,
  indent: i_indent,
  outdent: i_outdent,
  compare: i_compare,
  edit: i_edit,
  copy: i_copy,
  trash: i_trash,
  export: i_export,
  bold: i_bold,
  italic: i_italic,
  strike: i_strike,
  sup: i_sup,
  sub: i_sub,
  resize: i_resize,
  pdf: i_pdf,
  word: i_word,
  ppt: i_ppt,
  excel: i_excel,
  markdown: i_markdown,
  bib: i_bib,
  grip: i_grip,
  down: i_down,
  upArrow: i_upArrow,
  fileOff: i_fileOff,
  dots: i_dots,
  info: i_info,
  external: i_external,
  eye: i_eye,
  chevRight: i_chevRight,
  zip: i_zip,
  photo: i_photo,
  movie: i_movie,
  music: i_music,
  braces: i_braces,
  fileUnknown: i_fileUnknown,
  moveTo: i_moveTo,
  folderPlus: i_folderPlus,
  filePlus: i_filePlus,
  pencil: i_pencil,
  alignLeft: i_alignLeft,
  alignCenter: i_alignCenter,
  alignRight: i_alignRight,
  rows: i_rows,
  outline: i_outline,
  history: i_history,
};

/** 去掉外层 svg 和 Tabler 用来占位的透明方块，只留下线条 */
const inner = new Map<string, string>();
export function iconBody(name: string): string {
  let b = inner.get(name);
  if (b === undefined) {
    const raw = RAW[name] ?? "";
    b = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, "").trim();
    inner.set(name, b);
  }
  return b;
}
export const hasIcon = (name: string) => name in RAW;

/** 给不是 React 的地方用：一整段 svg 字符串 */
export function iconSvg(name: string, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconBody(name)}</svg>`;
}
