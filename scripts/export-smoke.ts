/**
 * 导出冒烟测试：把演示文件夹写到磁盘，生成 Word、PDF 两个导出任务（job-docx.json、job-pdf.json）。
 * 用法：npx vite-node scripts/export-smoke.ts <输出目录>
 * 然后：HM_EXPORT_JOB=<输出目录>/job-pdf.json cargo test --lib e2e_from_env -- --ignored
 */
import { mkdirSync, writeFileSync } from "fs";
import { DEMO_FILES, DEMO_ROOT, DEMO_START } from "../src/lib/demo";
import { cloneOpts, defaultsName, defaultsYaml, docxStyle, EMPTY, prepareForPandoc, typstTemplate } from "../src/lib/exporting";

const OUT = process.argv[2];
if (!OUT) throw new Error("请给出输出目录");
const cjk = process.env.SMOKE_FONT_CJK || "Songti SC";
const root = `${OUT}/毕业论文`;
for (const [p, c] of Object.entries(DEMO_FILES)) {
  const f = root + p.slice(DEMO_ROOT.length);
  mkdirSync(f.replace(/\/[^/]*$/, ""), { recursive: true });
  writeFileSync(f, c);
}
const docDir = (root + DEMO_START.slice(DEMO_ROOT.length)).replace(/\/[^/]*$/, "");
// 1×1 的白色 PNG，代替浏览器里才能生成的 Mermaid 图
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

for (const fmt of ["docx", "pdf"] as const) {
  const o = cloneOpts(EMPTY);
  o.fmt = fmt;
  Object.assign(o, { paper: "A4", cjk, latin: "Times New Roman", size: "12", ls: "1.5", indent: "2", align: "justify", before: "0", after: "6" });
  o.H[1] = { ...o.H[1], size: "16", bold: "1", align: "center", num: "第{一}章", color: "black" };
  o.H[2] = { ...o.H[2], num: "{1}.{2}" };
  o.H[3] = { ...o.H[3], num: "{1}.{2}.{3}" };
  o.header = "{标题}";
  o.footer = "第 {页码} 页 / 共 {总页数} 页";
  const p = prepareForPandoc(DEMO_FILES[DEMO_START], o, docDir);
  const title = p.title || "研究设计";
  const job = {
    format: fmt, markdown: p.markdown, output: `${OUT}/out.${fmt}`,
    defaultsDir: `${root}/.holymark/export`, defaultsName: defaultsName(fmt),
    defaultsYaml: defaultsYaml(o, { bibliography: [`${root}/资料/references.bib`, ...p.bibliography], docDir }),
    referenceDoc: null,
    docxStyle: fmt === "docx" ? docxStyle(o, title) : null,
    typstTemplate: fmt === "pdf" ? typstTemplate(o, title) : null,
    assets: p.mermaid.map((_, i) => ({ name: `mermaid-${i + 1}.png`, data: png })),
    extraArgs: [],
  };
  writeFileSync(`${OUT}/job-${fmt}.json`, JSON.stringify(job, null, 1));
}
console.log(`已生成 ${OUT}/job-docx.json、job-pdf.json`);
