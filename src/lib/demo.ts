/** 浏览器预览用的演示文件夹（虚构的论文项目）。桌面版不会用到。 */
export const DEMO_ROOT = "/演示/毕业论文";

const ch3 = `---
title: 研究设计
bibliography: ../资料/references.bib
---
# 第三章　研究设计

## 3.1　研究问题

本研究关注的核心问题是：在长篇写作过程中，写作工具的设计如何影响作者的**认知负荷**与写作连续性。已有研究多从文本产出效率出发[@zhang2021]，较少讨论作者在起草、修订与定稿三个阶段中注意力的分配方式。

基于此，本章提出三个具体问题：

1. 作者在不同写作阶段对工具的需求有何差异；
2. 版本管理、字数反馈等*边缘功能*是否会打断写作流；
3. 引入 AI 协作后，作者如何判断修改是否可取，并保留最终决定权。

## 3.2　样本与数据

研究样本来自 2025 年 3 月至 9 月间招募的 {==24 名受访者==}{>>@王老师 2026-11-18：招募渠道和入选标准需要说清楚。<<}，其中硕士研究生 14 名、博士研究生 6 名、非虚构写作者 4 名。数据来源见表 3-1。

| 数据来源 | 采集方式 | 规模 |
| --- | --- | --- |
| 半结构化访谈 | 每人两次，每次约 60 分钟 | 48 次 |
| 写作日志 | 受访者每日记录 | 1,036 篇 |
| 屏幕录制 | 经同意后录制 | 312 小时 |

编码结果见[受访者编码表.xlsx](../资料/受访者编码表.xlsx)。各月份的访谈次数见图 3-1。

![图 3-1　各月访谈次数](../资料/图3-1.svg)
为降低录制本身对写作行为的干扰，前两周的录制数据不纳入正式分析。

## 3.3　分析框架

### 3.3.1　理论基础

本研究借鉴认知负荷理论[@sweller1988]，将写作过程中的认知负荷分为内在负荷、外在负荷与关联负荷三类。工具界面带来的负荷 $L_{ext}$ 被视为外在负荷的主要来源，可按下式估算：

$$
L_{ext} = \\sum_{i=1}^{n} w_i \\cdot t_i
$$

### 3.3.2　编码过程

编码流程如下，直到新访谈不再产生新的概念为止：

\`\`\`mermaid
flowchart LR
  A[访谈转录] --> B[开放式编码]
  B --> C[主轴编码]
  C --> D{是否饱和}
  D -- 否 --> A
  D -- 是 --> E[四个范畴]
\`\`\`

{==在一定程度上可以说==}{>>@我 2026-11-25：开头太虚，交给 Claude 精简。<<}，认知负荷的累积并非来自某一次显著的中断，而是来自大量细小的、非常频繁的确认动作。

> “我每写两段就想看看今天写了多少，看完就回不到刚才的句子里了。”——受访者 P07

## 3.4　信度与效度

样本的构成见[3.2 节](#样本与数据)。两名研究者独立完成了 30% 样本的编码，用 Cohen's κ 检验一致性：

\`\`\`python
from sklearn.metrics import cohen_kappa_score

kappa = cohen_kappa_score(coder_a, coder_b)
print(f"Cohen's κ = {kappa:.2f}")  # 0.82
\`\`\`

- [x] 对分歧条目逐条讨论并修订编码手册
- [x] 邀请 6 名受访者阅读初步结论
- [ ] 补充第二轮编码的一致性系数
`;

export const DEMO_FILES: Record<string, string> = {
  [`${DEMO_ROOT}/正文/01 绪论.md`]: "# 第一章　绪论\n\n长篇写作是一项持续数月的工作。\n",
  [`${DEMO_ROOT}/正文/02 文献综述.md`]: "# 第二章　文献综述\n\n认知负荷理论由 Sweller 于 1988 年提出。\n",
  [`${DEMO_ROOT}/正文/03 研究设计.md`]: ch3,
  [`${DEMO_ROOT}/资料/导师意见-1118.md`]: "# 导师意见\n\n第三章：[样本部分](<../正文/03 研究设计.md#样本与数据>)写得太简略，招募渠道和入选标准要补上。\n",
  [`${DEMO_ROOT}/资料/references.bib`]:
    "@article{zhang2021,\n  author = {张伟 and 王敏},\n  title = {学术写作中的数字工具使用与产出效率},\n  journal = {中国电化教育},\n  year = {2021}\n}\n\n@article{sweller1988,\n  author = {Sweller, John},\n  title = {Cognitive load during problem solving},\n  journal = {Cognitive Science},\n  year = {1988}\n}\n",
  [`${DEMO_ROOT}/README.md`]: "# 写作约定\n\n正文按章拆成单独文件，参考文献维护在 references.bib。\n",
};
export const DEMO_START = `${DEMO_ROOT}/正文/03 研究设计.md`;
/** 工作区以外的一个文件：浏览器预览里用 __hm.openExternal(DEMO_OUTSIDE) 试「单独打开一个文件」 */
export const DEMO_OUTSIDE = "/演示/下载/会议纪要.md";
DEMO_FILES[DEMO_OUTSIDE] = "# 会议纪要\n\n11 月 25 日，讨论第三章的修改。\n\n- [ ] 补充招募渠道\n- [ ] 重画图 3-1\n";

/** 演示用的图片：一张小柱状图（SVG），浏览器预览里点开能看放大效果 */
const bars = [6, 9, 8, 7, 8, 6, 4];
const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="300" viewBox="0 0 560 300" font-family="PingFang SC, Microsoft YaHei, sans-serif">
<rect width="560" height="300" fill="#fff"/>
<line x1="56" y1="250" x2="530" y2="250" stroke="#c9ccd4"/>
${bars.map((n, i) => `<rect x="${76 + i * 66}" y="${250 - n * 22}" width="38" height="${n * 22}" rx="3" fill="#7d84c8"/><text x="${95 + i * 66}" y="${242 - n * 22}" font-size="13" text-anchor="middle" fill="#444">${n}</text><text x="${95 + i * 66}" y="272" font-size="13" text-anchor="middle" fill="#666">${i + 3} 月</text>`).join("")}
<text x="28" y="36" font-size="15" fill="#222">各月访谈次数</text>
</svg>`;
export const DEMO_IMAGES: Record<string, string> = {
  // 一份两页的小 PDF（访谈提纲），浏览器预览里能看 PDF 预览
  [`${DEMO_ROOT}/资料/访谈提纲.pdf`]: "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFs0IDAgUiA2IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago0IDAgb2JqCjw8IC9UeXBlIC9QYWdlIC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFswIDAgNTk1IDg0Ml0gL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgMyAwIFIgPj4gPj4gL0NvbnRlbnRzIDUgMCBSID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNTQzID4+CnN0cmVhbQpCVCAvRjEgMjAgVGYgNzIgNzQwIFRkIChJbnRlcnZpZXcgUHJvdG9jb2wpIFRqIEVUCjAuMzUgMC4zOCAwLjg1IFJHIDIgdyA3MiA3MjUgbSA1MjMgNzI1IGwgUwpCVCAvRjEgMTIgVGYgNzIgNjkwIFRkICgxLiBCYWNrZ3JvdW5kIGFuZCB3cml0aW5nIGhhYml0cykgVGogRVQKQlQgL0YxIDEyIFRmIDcyIDY2OCBUZCAoMi4gVG9vbHMgdXNlZCBpbiBkcmFmdGluZyBhbmQgcmV2aXNpb24pIFRqIEVUCkJUIC9GMSAxMiBUZiA3MiA2NDYgVGQgKDMuIE1vbWVudHMgb2YgaW50ZXJydXB0aW9uKSBUaiBFVApCVCAvRjEgMTIgVGYgNzIgNjI0IFRkICg0LiBWZXJzaW9uIGhpc3RvcnkgYW5kIHJlY292ZXJ5KSBUaiBFVApCVCAvRjEgMTIgVGYgNzIgNjAyIFRkICg1LiBXb3JraW5nIHdpdGggQUkgc3VnZ2VzdGlvbnMpIFRqIEVUCjAuODUgMC44NiAwLjkgcmcgNzIgMzYwIDQ1MSAxODAgcmUgZgowLjM1IDAuMzggMC44NSByZyAxMDAgMzgwIDQwIDEyMCByZSBmIDE3MCAzODAgNDAgOTAgcmUgZiAyNDAgMzgwIDQwIDE0MCByZSBmIDMxMCAzODAgNDAgNzAgcmUgZgplbmRzdHJlYW0KZW5kb2JqCjYgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSAzIDAgUiA+PiA+PiAvQ29udGVudHMgNyAwIFIgPj4KZW5kb2JqCjcgMCBvYmoKPDwgL0xlbmd0aCA0NjcgPj4Kc3RyZWFtCkJUIC9GMSAyMCBUZiA3MiA3NDAgVGQgKENvZGluZyBTdW1tYXJ5KSBUaiBFVAowLjM1IDAuMzggMC44NSBSRyAyIHcgNzIgNzI1IG0gNTIzIDcyNSBsIFMKQlQgL0YxIDEyIFRmIDcyIDY5MCBUZCAoQ2F0ZWdvcnkgQTogYXR0ZW50aW9uIHNoaWZ0cykgVGogRVQKQlQgL0YxIDEyIFRmIDcyIDY2OCBUZCAoQ2F0ZWdvcnkgQjogY29uZmlybWF0aW9uIGFjdGlvbnMpIFRqIEVUCkJUIC9GMSAxMiBUZiA3MiA2NDYgVGQgKENhdGVnb3J5IEM6IHJlY292ZXJ5IGNvc3QpIFRqIEVUCkJUIC9GMSAxMiBUZiA3MiA2MjQgVGQgKENhdGVnb3J5IEQ6IHRydXN0IGluIHN1Z2dlc3Rpb25zKSBUaiBFVAowLjg1IDAuODYgMC45IHJnIDcyIDM2MCA0NTEgMTgwIHJlIGYKMC4zNSAwLjM4IDAuODUgcmcgMTAwIDM4MCA0MCAxMjAgcmUgZiAxNzAgMzgwIDQwIDkwIHJlIGYgMjQwIDM4MCA0MCAxNDAgcmUgZiAzMTAgMzgwIDQwIDcwIHJlIGYKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgOAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTIxIDAwMDAwIG4gCjAwMDAwMDAxOTEgMDAwMDAgbiAKMDAwMDAwMDMxNyAwMDAwMCBuIAowMDAwMDAwOTEwIDAwMDAwIG4gCjAwMDAwMDEwMzYgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA4IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgoxNTUzCiUlRU9GCg==",
  [`${DEMO_ROOT}/资料/图3-1.svg`]: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(chart),
};

/** 演示用的 Excel：浏览器里没法解析真的 xlsx，直接给出阅读版的内容 */
export const DEMO_DOCS: Record<string, import("./filePreview").FileDocument> = {
  [`${DEMO_ROOT}/资料/受访者编码表.xlsx`]: {
    kind: "excel", title: "受访者编码表", size: 18_432, modified: Date.now() - 3 * 86_400_000, pages: 2, lines: [],
    sections: [
      { title: "编码", lines: ["编号\t身份\t写作年限\t主要工具\t访谈次数", "P01\t硕士\t3\tWord\t2", "P02\t博士\t6\tLaTeX\t2", "P03\t非虚构写作者\t11\tScrivener\t2", "P07\t硕士\t2\tTypora\t2", "P12\t博士\t5\tObsidian\t2"] },
      { title: "汇总", lines: ["身份\t人数", "硕士研究生\t14", "博士研究生\t6", "非虚构写作者\t4"] },
    ],
  },
};
