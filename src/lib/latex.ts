/**
 * 常用 LaTeX 命令：公式补全和符号面板共用这一份。
 * insert 是补全插入的内容，${1} ${2} 是参数位置（插入后光标停在第一个，Tab 跳到下一个）；
 * preview 是右侧用 KaTeX 画出来的样子（不写就画 cmd 本身）。
 */
export type SymbolCat = "greek" | "ops" | "rel" | "arrows" | "sets" | "struct";
export const SYMBOL_CATS: [SymbolCat, string][] = [["greek", "希腊字母"], ["ops", "运算"], ["rel", "关系"], ["arrows", "箭头"], ["sets", "集合与逻辑"], ["struct", "结构"]];

export interface TexItem { cmd: string; insert?: string; preview?: string; cat?: SymbolCat; info?: string }

const greek = "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega"
  .split(" ").map((n): TexItem => ({ cmd: "\\" + n, cat: "greek" }));

const plain = (cat: SymbolCat, list: string) => list.split(" ").map((c): TexItem => ({ cmd: c, cat }));

export const TEX: TexItem[] = [
  ...greek,
  ...plain("ops", "\\times \\div \\pm \\mp \\cdot \\ast \\circ \\bullet \\oplus \\otimes \\partial \\nabla \\infty \\prime \\ldots \\cdots \\vdots \\ddots"),
  { cmd: "\\sum", insert: "\\sum_{${1:i=1}}^{${2:n}}", preview: "\\sum_{i=1}^{n}", cat: "ops" },
  { cmd: "\\prod", insert: "\\prod_{${1:i=1}}^{${2:n}}", preview: "\\prod_{i=1}^{n}", cat: "ops" },
  { cmd: "\\int", insert: "\\int_{${1:a}}^{${2:b}}", preview: "\\int_{a}^{b}", cat: "ops" },
  { cmd: "\\iint", cat: "ops" }, { cmd: "\\oint", cat: "ops" },
  { cmd: "\\lim", insert: "\\lim_{${1:x \\to 0}}", preview: "\\lim_{x \\to 0}", cat: "ops" },
  ...plain("rel", "= \\neq \\approx \\equiv \\sim \\simeq \\cong \\propto < > \\leq \\geq \\ll \\gg \\prec \\succ \\perp \\parallel \\mid"),
  ...plain("arrows", "\\to \\gets \\leftrightarrow \\Rightarrow \\Leftarrow \\Leftrightarrow \\implies \\iff \\mapsto \\longrightarrow \\longleftarrow \\uparrow \\downarrow \\nearrow \\searrow \\rightleftharpoons"),
  ...plain("sets", "\\in \\notin \\ni \\subset \\subseteq \\supset \\supseteq \\cap \\cup \\setminus \\emptyset \\forall \\exists \\nexists \\neg \\land \\lor \\therefore \\because"),
  { cmd: "\\mathbb", insert: "\\mathbb{${1:R}}", preview: "\\mathbb{R}", cat: "sets" },
  { cmd: "\\frac", insert: "\\frac{${1}}{${2}}", preview: "\\frac{a}{b}", cat: "struct", info: "分式" },
  { cmd: "\\dfrac", insert: "\\dfrac{${1}}{${2}}", preview: "\\dfrac{a}{b}" },
  { cmd: "\\sqrt", insert: "\\sqrt{${1}}", preview: "\\sqrt{x}", cat: "struct", info: "根号" },
  { cmd: "\\sqrt[n]", insert: "\\sqrt[${1:n}]{${2}}", preview: "\\sqrt[n]{x}", cat: "struct" },
  { cmd: "^{}", insert: "^{${1}}", preview: "x^{n}", cat: "struct", info: "上标" },
  { cmd: "_{}", insert: "_{${1}}", preview: "x_{i}", cat: "struct", info: "下标" },
  { cmd: "\\overline", insert: "\\overline{${1}}", preview: "\\overline{x}", cat: "struct" },
  { cmd: "\\hat", insert: "\\hat{${1}}", preview: "\\hat{x}", cat: "struct" },
  { cmd: "\\bar", insert: "\\bar{${1}}", preview: "\\bar{x}" },
  { cmd: "\\vec", insert: "\\vec{${1}}", preview: "\\vec{v}", cat: "struct" },
  { cmd: "\\dot", insert: "\\dot{${1}}", preview: "\\dot{x}" },
  { cmd: "\\tilde", insert: "\\tilde{${1}}", preview: "\\tilde{x}" },
  { cmd: "\\left(", insert: "\\left( ${1} \\right)", preview: "\\left( x \\right)", cat: "struct" },
  { cmd: "matrix", insert: "\\begin{matrix}\n${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}\n\\end{matrix}", preview: "\\begin{matrix}a&b\\\\c&d\\end{matrix}", info: "矩阵" },
  { cmd: "pmatrix", insert: "\\begin{pmatrix}\n${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}\n\\end{pmatrix}", preview: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", cat: "struct", info: "矩阵（圆括号）" },
  { cmd: "bmatrix", insert: "\\begin{bmatrix}\n${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}\n\\end{bmatrix}", preview: "\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}", info: "矩阵（方括号）" },
  { cmd: "cases", insert: "\\begin{cases}\n${1:x} & ${2:x \\ge 0} \\\\\n${3:-x} & ${4:x < 0}\n\\end{cases}", preview: "\\begin{cases}x&x\\ge0\\\\-x&x<0\\end{cases}", cat: "struct", info: "分段" },
  { cmd: "aligned", insert: "\\begin{aligned}\n${1:a} &= ${2:b} \\\\\n${3:c} &= ${4:d}\n\\end{aligned}", preview: "\\begin{aligned}a&=b\\\\c&=d\\end{aligned}", cat: "struct", info: "多行对齐" },
  { cmd: "\\mathrm", insert: "\\mathrm{${1}}", preview: "\\mathrm{d}x" },
  { cmd: "\\mathbf", insert: "\\mathbf{${1}}", preview: "\\mathbf{x}" },
  { cmd: "\\mathcal", insert: "\\mathcal{${1}}", preview: "\\mathcal{L}" },
  { cmd: "\\text", insert: "\\text{${1}}", preview: "\\text{文字}", info: "公式里的文字" },
  ...["sin", "cos", "tan", "log", "ln", "exp", "max", "min", "arg", "det"].map((f): TexItem => ({ cmd: "\\" + f })),
  { cmd: "\\quad" }, { cmd: "\\qquad" },
];

/** 补全里显示的名字：环境写成 \begin{xxx} */
export const texLabel = (t: TexItem) => (/^[a-z]+$/.test(t.cmd) ? `\\begin{${t.cmd}}` : t.cmd);
/** 补全插入的内容：没写 insert 的命令插入它本身；环境整段插入 */
export const texInsert = (t: TexItem) => t.insert ?? t.cmd;
export const texPreview = (t: TexItem) => t.preview ?? t.cmd;

/** 光标是否在公式里：$$…$$ 块，或者这一行光标前面有一个还没配对的 $ */
export function inlineMathOpen(line: string, col: number): boolean {
  let open = false;
  for (let i = 0; i < col; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] !== "$") continue;
    if (line[i + 1] === "$") { i++; continue; }
    open = !open;
  }
  return open;
}
