/**
 * 长稿压力测试用的文稿生成器：按目标字数生成一篇结构接近真实书稿的 Markdown，
 * 混有标题、段落、列表、引用、表格、公式、代码、Mermaid 图、批注和文献引用。
 * 结果是确定的（同样的参数永远生成同样的文本），方便前后对比。
 */

const SENT = [
  "长篇写作最难的部分往往不是开头，而是在第三万字附近仍然保持结构清楚",
  "作者需要在起草、修订与定稿之间来回切换，每一次切换都会消耗注意力",
  "已有研究多从文本产出效率出发，较少讨论注意力在不同阶段的分配方式",
  "访谈中有受访者提到，字数反馈既是动力，也会在疲惫时变成压力",
  "版本管理如果需要额外的操作步骤，大多数人会在第二周后放弃使用",
  "引入 AI 协作之后，判断一处修改是否可取成了新的认知负担",
  "我们把写作日志按周汇总，再与屏幕录制中的停顿时长对照",
  "结果显示，停顿超过三十秒的次数与当天的修订比例显著相关",
  "这并不意味着停顿本身是坏事，很多关键的结构调整恰恰发生在停顿之后",
  "为了降低录制本身的干扰，前两周的数据没有纳入正式分析",
];
const INLINE = [
  "其中**认知负荷**被定义为单位时间内需要同时保持的信息量",
  "相关系数为 $r = 0.62$，在 $p < 0.01$ 水平上显著",
  "这一点与前人的发现一致[@zhang2021]",
  "详见 `revision_ratio` 字段的定义",
  "受访者使用的工具从 *纯文本编辑器* 到 ~~文字处理软件~~ 协作文档不等",
  "{==这一结论==}{>>@王老师 2026-11-18：样本量偏小，结论要收一收。<<}需要更多样本支持",
  "参见[附录 B](附录B.md)中的完整问卷",
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

/** 生成大约 chars 个字符的书稿 */
export function longManuscript(chars = 200_000, seed = 7): string {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const para = () => {
    const n = 4 + Math.floor(r() * 5);
    const parts: string[] = [];
    for (let i = 0; i < n; i++) parts.push(r() < 0.3 ? pick(INLINE) : pick(SENT));
    return parts.join("，") + "。";
  };
  const out: string[] = ["---", "title: 长稿压力测试", "author: HolyMark", "---", ""];
  let len = 0, ch = 0, sec = 0;
  const push = (s: string) => { out.push(s, ""); len += s.length + 2; };
  while (len < chars) {
    if (sec % 6 === 0) { ch++; push(`# 第${ch}章　写作与注意力（${ch}）`); }
    sec++;
    push(`## ${ch}.${sec}　小节标题 ${sec}`);
    const blocks = 6 + Math.floor(r() * 6);
    for (let b = 0; b < blocks && len < chars; b++) {
      const k = r();
      if (k < 0.62) push(para());
      else if (k < 0.70) push(["- " + pick(SENT) + "；", "- " + pick(INLINE) + "；", "- [ ] " + pick(SENT) + "。", "- [x] " + pick(SENT) + "。"].join("\n"));
      else if (k < 0.76) push(["1. " + pick(SENT) + "；", "2. " + pick(SENT) + "；", "3. " + pick(INLINE) + "。"].join("\n"));
      else if (k < 0.81) push("> " + para());
      else if (k < 0.86) push(["| 数据来源 | 采集方式 | 规模 |", "| --- | --- | --- |", "| 半结构化访谈 | 每人两次 | 48 次 |", "| 写作日志 | 每日记录 | 1,036 篇 |", "| 屏幕录制 | 经同意后录制 | 312 小时 |"].join("\n"));
      else if (k < 0.90) push("$$\nL = \\sum_{i=1}^{n} w_i \\cdot \\frac{t_i}{T} + \\epsilon\n$$");
      else if (k < 0.94) push("```python\ndef revision_ratio(log):\n    edits = [e for e in log if e.kind == 'edit']\n    return len(edits) / max(1, len(log))\n```");
      else if (k < 0.955) push("```mermaid\nflowchart LR\n  A[起草] --> B[修订]\n  B --> C[定稿]\n  B --> A\n```");
      else if (k < 0.97) push("---");
      else push(`### ${ch}.${sec}.${b}　小标题`);
    }
  }
  return out.join("\n");
}
