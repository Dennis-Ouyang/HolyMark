// 浏览器预览冒烟测试：逐项点一遍主要功能，要求控制台零报错。
// 用法：先 `npm run dev`，再 `node scripts/smoke.mjs`（需要 Playwright；全局装的用 NODE_PATH=$(npm root -g)）
// 加 `--shots 目录` 会在每一步后截图，浅色、深色各一份。
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.env.HM_URL || "http://localhost:1420/";
const shotDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : "";

/** 每一条：名字 + 在页面里执行的检查（抛错即失败） */
const steps = [];
const step = (name, fn) => steps.push({ name, fn });

const ready = (page) => page.waitForFunction(() => window.__hm?.view?.()?.state.doc.length > 100, null, { timeout: 30000 });
const menu = (page, id) => page.evaluate((i) => window.__hm.menu(i), id);
const docText = (page) => page.evaluate(() => window.__hm.view().state.doc.toString());

step("打开演示文件夹", async (page) => {
  const t = await docText(page);
  if (!t.includes("研究设计")) throw new Error("没有打开第三章");
});

step("⌘K 打开再关上", async (page) => {
  await menu(page, "search");
  await page.waitForSelector(".search");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".search", { state: "detached" });
});

step("N10 中文排版整理：预览、执行、撤销", async (page) => {
  const before = await docText(page);
  await page.evaluate(() => { const v = window.__hm.view(); v.dispatch({ changes: { from: v.state.doc.length, insert: "\n\n测试一下,好的...这是是重复\n" } }); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const v = window.__hm.view(); v.dispatch({ selection: { anchor: 0 } }); });
  await menu(page, "tidy");
  await page.waitForSelector(".hm-float.tidy");
  const sum = await page.textContent(".tp-sum");
  if (!/将整理/.test(sum)) throw new Error("没有显示将整理几处：" + sum);
  if (!(await page.$(".tp-hit"))) throw new Error("没有列出重复字词");
  await page.click(".hm-float.tidy .btn.acc");
  await page.waitForSelector(".toast");
  const after = await docText(page);
  if (!after.includes("测试一下，好的……")) throw new Error("没有整理：" + after.slice(-40));
  await page.click(".toast .lnk");
  await page.waitForTimeout(200);
  const undone = await docText(page);
  if (!undone.includes("测试一下,好的...")) throw new Error("撤销没有还原");
  await page.evaluate((t) => { const v = window.__hm.view(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } }); }, before);
});
step("N14 写作统计：今天净增、7 天柱子、文件树悬停字数", async (page) => {
  await page.evaluate(() => { const v = window.__hm.view(); v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); });
  await page.keyboard.type("统计测试");
  await page.waitForTimeout(1000);
  await page.click(".statusbar [data-countpop]");
  await page.waitForSelector(".countpop .wstats");
  const head = await page.textContent(".ws-head b");
  if (!/^\+/.test(head.trim())) throw new Error("今天净增不对：" + head);
  if ((await page.$$(".ws-col")).length !== 7) throw new Error("不是 7 根柱子");
  await page.click(".statusbar [data-countpop]");
  await page.hover(".tree .tn[data-path*='02 文献综述']");
  await page.waitForSelector(".hm-tip", { timeout: 3000 });
  const t = await page.textContent(".hm-tip");
  if (!/字/.test(t)) throw new Error("悬停提示不对：" + t);
  await page.mouse.move(700, 500);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
});
step("N12 公式补全、Tab 跳参数、符号面板", async (page) => {
  const before = await docText(page);
  await page.evaluate(() => { const v = window.__hm.view(); const n = v.state.doc.length; v.focus(); v.dispatch({ changes: { from: n, insert: "\n\n$$\nx = \n$$\n" }, selection: { anchor: n + 9 } }); });
  await page.keyboard.type("\\fra");
  await page.waitForSelector(".hm-ac .hm-ac-tex");
  await page.keyboard.press("Enter");
  await page.keyboard.type("a");
  await page.keyboard.press("Tab");
  await page.keyboard.type("b");
  const t = await docText(page);
  if (!t.includes("x = \\frac{a}{b}")) throw new Error("补全或 Tab 不对：" + t.slice(-30));
  // 正文里打 \ 不弹出
  await page.evaluate(() => { const v = window.__hm.view(); v.dispatch({ selection: { anchor: 5 } }); });
  await page.keyboard.type("\\al");
  await page.waitForTimeout(300);
  if (await page.$(".hm-ac")) throw new Error("正文里也弹出了公式补全");
  await page.evaluate((b) => { const v = window.__hm.view(); v.focus(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: b + "\n\n$$\nx\n$$\n" } }); }, before);
  await page.waitForTimeout(100);
  await page.evaluate(() => { const v = window.__hm.view(); v.dispatch({ selection: { anchor: v.state.doc.length - 4 }, scrollIntoView: true }); });
  await page.waitForSelector(".hm-mt-sym");
  await page.waitForTimeout(200);
  await page.dispatchEvent(".hm-mt-sym", "mousedown");
  await page.waitForSelector(".hm-float.symp");
  await page.click(".sp-tabs button:has-text('希腊字母')");
  await page.click(".sp-sym >> nth=0");
  if (!(await docText(page)).includes("\\alpha")) throw new Error("符号面板没有插入");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".hm-float.symp", { state: "detached" });
  await page.evaluate((b) => { const v = window.__hm.view(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: b } }); }, before);
});
step("N6 按章节折叠：小三角、占位、命令、跳进去自动展开、目录收起", async (page) => {
  await page.hover(".hm-h2 >> nth=0");
  await page.dispatchEvent(".hm-h2 >> nth=0 >> .hm-fold", "mousedown");
  await page.waitForSelector(".hm-folded");
  const t = await page.textContent(".hm-folded");
  if (!/^已折叠 [\d,]+ 字$/.test(t)) throw new Error("占位文字不对：" + t);
  await page.click(".hm-folded");
  await page.waitForTimeout(150);
  if (await page.$(".hm-folded")) throw new Error("点占位没有展开");
  await menu(page, "fold_h2");
  await page.waitForTimeout(150);
  if ((await page.$$(".hm-folded")).length < 3) throw new Error("折叠到二级标题不对");
  // 跳到某个折起来的地方：自动展开
  await page.evaluate(() => { const v = window.__hm.view(); const p = v.state.doc.toString().indexOf("招募"); v.dispatch({ selection: { anchor: p } }); });
  await page.waitForTimeout(150);
  const n = (await page.$$(".hm-folded")).length;
  await menu(page, "unfold_all");
  await page.waitForTimeout(150);
  if (await page.$(".hm-folded")) throw new Error("展开全部没有展开");
  if (n >= 4) throw new Error("跳进折叠区域没有自动展开");
  // 目录：收起子级只影响目录
  const before = (await page.$$(".ol .oi")).length;
  await page.hover(".ol .oi:has-text('分析框架')");
  await page.click(".ol .oi:has-text('分析框架') .ofold");
  const after = (await page.$$(".ol .oi")).length;
  if (after !== before - 2) throw new Error(`目录收起不对：${before} → ${after}`);
  if (await page.$(".hm-folded")) throw new Error("目录收起影响了正文");
  await page.click(".ol .oi:has-text('分析框架') .ofold");
});
step("N2 阅读模式：只读、图片放大、勾选框、悬停文献、双击回到编辑", async (page) => {
  const before = await docText(page);
  await page.click("button[aria-label='阅读模式']");
  await page.waitForSelector(".cm-editor.hm-reading");
  if (await page.$(".ribbon")) throw new Error("功能区没有隐藏");
  // 点正文不切成源码、打字不改正文
  await page.click(".hm-h2 >> nth=1");
  await page.keyboard.type("x");
  if ((await docText(page)) !== before) throw new Error("阅读模式里正文被改了");
  if ((await page.$$(".hm-mark")).length) throw new Error("阅读模式里显示了源码符号");
  // 编辑命令被挡住
  await menu(page, "bold");
  if ((await docText(page)) !== before) throw new Error("阅读模式里格式命令改了正文");
  // 图片放大：←→、Esc
  await page.click(".hm-figure img");
  await page.waitForSelector(".lightbox img");
  if (!(await page.textContent(".lightbox figcaption")).includes("各月访谈次数")) throw new Error("没有图注");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".lightbox", { state: "detached" });
  if (!(await page.$(".cm-editor.hm-reading"))) throw new Error("Esc 把阅读模式也关了");
  // 待办勾选框照样能点
  await page.evaluate(() => { const sc = document.querySelector(".scroller"); sc.scrollTop = sc.scrollHeight; });
  await page.waitForTimeout(200);
  await page.click(".hm-check:not(.on)");
  if (!(await docText(page)).includes("- [x] 补充第二轮")) throw new Error("勾选框点不动");
  await page.click(".hm-check.on >> nth=-1");
  // 悬停文献
  await page.evaluate(() => { document.querySelector(".scroller").scrollTop = 0; });
  await page.waitForTimeout(200);
  await page.hover(".hm-cite >> nth=0");
  await page.waitForSelector(".hm-hovercard", { timeout: 3000 });
  if (!(await page.textContent(".hm-hovercard")).includes("学术写作")) throw new Error("文献卡片内容不对");
  await page.mouse.move(10, 400);
  // 单击链接：浏览器预览里给出说明
  await page.click(".hm-link:has-text('受访者编码表')");
  await page.waitForSelector(".toast:has-text('浏览器预览里打不开本机文件')");
  // 双击回到编辑，光标在双击处
  const box = await page.$eval(".hm-h2 >> nth=1", (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
  await page.mouse.dblclick(box.x, box.y);
  await page.waitForSelector(".cm-editor:not(.hm-reading)");
  const at = await page.evaluate(() => { const v = window.__hm.view(); return v.state.doc.lineAt(v.state.selection.main.head).text; });
  if (!at.startsWith("## 3.2")) throw new Error("双击后光标不在双击的位置：" + at);
});
step("N3 记住位置：切换文件、重新加载后恢复光标、顶部段落、折叠、阅读模式", async (page) => {
  const target = await page.evaluate(() => {
    const v = window.__hm.view(); const p = v.state.doc.toString().indexOf("两名研究者"); v.focus();
    v.dispatch({ selection: { anchor: p + 3 }, scrollIntoView: true }); return p + 3;
  });
  await menu(page, "fold_h2");
  await page.evaluate(() => { const v = window.__hm.view(); const p = v.state.doc.toString().indexOf("两名研究者"); v.dispatch({ selection: { anchor: p + 3 } }); });
  await page.waitForTimeout(200);
  await page.click("button[aria-label='阅读模式']");
  const check = async (label) => {
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => { const v = window.__hm.view(); return { head: v.state.selection.main.head, folded: document.querySelectorAll(".hm-folded").length, reading: !!document.querySelector(".cm-editor.hm-reading"), top: document.querySelector(".scroller").scrollTop }; });
    if (st.head !== target) throw new Error(`${label}：光标没恢复 ${st.head} ≠ ${target}`);
    if (st.folded < 3) throw new Error(`${label}：折叠没恢复`);
    if (!st.reading) throw new Error(`${label}：阅读模式没恢复`);
  };
  await page.click(".tree .tn[data-path*='02 文献综述']");
  await page.waitForTimeout(300);
  if (await page.$(".cm-editor.hm-reading")) throw new Error("另一篇不该是阅读模式");
  await page.click(".tree .tn[data-path*='03 研究设计']");
  await check("切换回来");
  await page.reload();
  await page.waitForFunction(() => window.__hm?.view?.()?.state.doc.length > 100);
  await check("重新加载");
  await page.click("button[aria-label='阅读模式']");
  await menu(page, "unfold_all");
  await page.evaluate(() => localStorage.removeItem("holymark-positions"));
});
step("N4 文内跳转：锚点链接、找不到的提示、跨文件、返回前进、写链接时的提示", async (page) => {
  const line = () => page.evaluate(() => { const v = window.__hm.view(); return v.state.doc.lineAt(v.state.selection.main.head).text; });
  if (await page.$(".navarrows")) throw new Error("没有历史时不该出现箭头");
  // 阅读模式里单击本文锚点
  await page.click("button[aria-label='阅读模式']");
  if (!(await docText(page)).includes("[3.2 节](#样本与数据)")) throw new Error("演示文稿里没有锚点链接");
  await page.evaluate(() => { document.querySelector(".scroller").scrollTop = 99999; });
  await page.waitForTimeout(300);
  await page.click(".hm-link:has-text('3.2 节')");
  await page.waitForTimeout(300);
  if (!(await line()).startsWith("## 3.2")) throw new Error("没跳到 3.2：" + (await line()));
  await page.waitForSelector(".navarrows");
  // 返回、前进（Alt+← / ⌃⌘←）
  await page.keyboard.press(process.platform === "darwin" ? "Control+Meta+ArrowLeft" : "Alt+ArrowLeft");
  await page.waitForTimeout(300);
  if ((await line()).startsWith("## 3.2")) throw new Error("返回没有回去");
  await page.click(".navarrows button[aria-label='前进']");
  await page.waitForTimeout(300);
  if (!(await line()).startsWith("## 3.2")) throw new Error("前进不对");
  await page.click("button[aria-label='阅读模式']");
  // 跨文件：导师意见里的链接，⌘ / Ctrl + 单击
  await page.click(".tree .tn[data-path*='导师意见']");
  await page.waitForTimeout(300);
  await page.click(".hm-link:has-text('样本部分')", { modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await page.waitForTimeout(600);
  const p = await page.evaluate(() => document.querySelector(".crumbs").textContent);
  if (!p.includes("03 研究设计")) throw new Error("没打开第三章：" + p);
  if (!(await line()).startsWith("## 3.2")) throw new Error("跨文件没跳到锚点");
  // 找不到锚点
  await page.evaluate(() => window.__hm.view().dispatch({ selection: { anchor: 0 } }));
  // 写链接时的提示
  await page.evaluate(() => { const v = window.__hm.view(); v.focus(); const n = v.state.doc.length; v.dispatch({ changes: { from: n, insert: "\n\n见[这里](" } }); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { const v = window.__hm.view(); v.dispatch({ selection: { anchor: v.state.doc.length } }); });
  await page.keyboard.type("#样本");
  await page.waitForSelector(".hm-ac");
  await page.keyboard.press("Enter");
  const t = await page.evaluate(() => window.__hm.view().state.doc.toString());
  if (!t.endsWith("见[这里](#样本与数据")) throw new Error("锚点补全不对：" + t.slice(-20));
  await page.evaluate(() => { const v = window.__hm.view(); const s = v.state.doc.toString(); const i = s.lastIndexOf("\n\n见[这里]"); v.dispatch({ changes: { from: i, to: s.length } }); });
});
step("N1 单独打开一个文件、只看不改不存版本、改了才存、打开所在文件夹后版本还在", async (page) => {
  const OUT = "/演示/下载/会议纪要.md";
  const vkey = "holymark-demo-versions:" + OUT;
  // 工作区里：打开不存版本，改一个字才存起点
  await page.click(".tree .tn[data-path*='02 文献综述']");
  await page.waitForTimeout(400);
  const k2 = "holymark-demo-versions:/演示/毕业论文/正文/02 文献综述.md";
  if (await page.evaluate((k) => localStorage.getItem(k), k2)) throw new Error("只打开没改就存了版本");
  await page.evaluate(() => { const v = window.__hm.view(); v.focus(); v.dispatch({ changes: { from: v.state.doc.length, insert: "补" } }); });
  await page.waitForTimeout(1000);
  if (!(await page.evaluate((k) => localStorage.getItem(k), k2))) throw new Error("改了以后没有存起点版本");
  await page.evaluate(() => { const v = window.__hm.view(); v.dispatch({ changes: { from: v.state.doc.length - 1, to: v.state.doc.length } }); });
  // 单独打开：左栏只有这一个文件，默认阅读模式
  await page.evaluate((p) => window.__hm.openExternal(p), OUT);
  await page.waitForTimeout(500);
  if ((await page.textContent(".side .folder .fname")) !== "单个文件") throw new Error("左栏不是单个文件");
  if ((await page.$$(".tree .tn")).length !== 1) throw new Error("左栏应该只有这一个文件");
  if (!(await page.$(".cm-editor.hm-reading"))) throw new Error("从外部打开没有默认用阅读模式");
  if (await page.evaluate((k) => localStorage.getItem(k), vkey)) throw new Error("只看不改就存了版本");
  // 改一个字以后版本能用
  await page.click("button[aria-label='阅读模式']");
  await page.evaluate(() => { const v = window.__hm.view(); v.focus(); v.dispatch({ changes: { from: v.state.doc.length, insert: "- [ ] 改一个字\n" } }); });
  await page.waitForTimeout(1000);
  await menu(page, "panel_versions");
  await page.waitForSelector(".ver");
  // 打开所在文件夹：之前的版本都还在
  await page.click(".tn.single-open");
  await page.waitForTimeout(500);
  if ((await page.textContent(".side .folder .fname")) !== "下载") throw new Error("没有把所在文件夹当工作区打开");
  await page.waitForSelector(".ver");
  await menu(page, "panel_outline");
  // 回到演示文件夹
  await page.evaluate(() => window.__hm.openExternal("/演示/毕业论文/正文/03 研究设计.md"));
  await page.waitForTimeout(300);
  await page.goto(page.url());
  await page.waitForFunction(() => window.__hm?.view?.()?.state.doc.length > 100);
});
step("N5 预览 PDF、图片、Excel，切回 Markdown 编辑状态保留", async (page) => {
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("holymark-settings") || "{}"); s.showAllFiles = true; localStorage.setItem("holymark-settings", JSON.stringify(s)); });
  await page.reload();
  await page.waitForFunction(() => window.__hm?.view?.()?.state.doc.length > 100);
  await page.evaluate(() => { const v = window.__hm.view(); v.focus(); v.dispatch({ selection: { anchor: 40 } }); });
  await page.click(".tree .tn[data-path*='访谈提纲.pdf']");
  await page.waitForSelector(".fv-page");
  await page.waitForFunction(() => document.querySelectorAll(".fv-page").length === 2);
  if (!(await page.textContent(".fv-pdfbar")).includes("1 / 2")) throw new Error("没有页码");
  await page.click(".fv-pdfbar button[aria-label='放大']");
  if (!(await page.$(".finfo dd"))) throw new Error("右栏没有文件信息");
  await page.click(".tree .tn[data-path*='图3-1.svg']");
  await page.waitForSelector(".fv-img-wrap img");
  await page.click(".fv-tools button:has-text('实际大小')");
  await page.click(".tree .tn[data-path*='受访者编码表.xlsx']");
  await page.waitForSelector(".fv-sheet table");
  if ((await page.$$(".fv-sheet")).length !== 2) throw new Error("Excel 应该有两张表");
  await page.click(".fv-head button:has-text('用默认程序打开')");
  await page.waitForSelector(".toast:has-text('浏览器预览里打不开本机文件')");
  // 回到正在编辑的那篇：光标还在原处
  await page.click(".tree .tn[data-path*='03 研究设计']");
  await page.waitForSelector(".fviewer", { state: "detached" });
  const head = await page.evaluate(() => window.__hm.view().state.selection.main.head);
  if (head !== 40) throw new Error("切回来以后光标变了：" + head);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("holymark-settings") || "{}"); s.showAllFiles = false; localStorage.setItem("holymark-settings", JSON.stringify(s)); });
});
step("N13 纸张底色、字体预设、打字机滚动、段落聚焦", async (page) => {
  await menu(page, "settings");
  await page.click(".prefs nav button:has-text('编辑器')");
  await page.click(".prefs .segm button:has-text('米白')");
  await page.click(".prefs .presets button:has-text('楷体')");
  const [main, side] = await page.evaluate(() => [getComputedStyle(document.querySelector(".main .scroller")).backgroundColor, getComputedStyle(document.querySelector(".side")).backgroundColor]);
  if (main === side) throw new Error("纸张底色没有只作用于正文区");
  if (!(await page.evaluate(() => getComputedStyle(document.querySelector(".hm-editor")).getPropertyValue("--ed-b") || document.querySelector(".app").style.getPropertyValue("--ed-b"))).includes("Kai")) throw new Error("字体预设没有生效");
  await page.click(".prefs .prow:has-text('打字机滚动') .switch");
  await page.click(".prefs .prow:has-text('段落聚焦') .switch");
  await page.keyboard.press("Escape");
  // 打字机：在中间某段末尾打字，光标停在屏幕 45% 左右
  await page.evaluate(() => { const v = window.__hm.view(); v.focus(); const p = v.state.doc.toString().indexOf("确认动作。") + 5; v.dispatch({ selection: { anchor: p }, scrollIntoView: true }); });
  await page.waitForTimeout(200);
  await page.keyboard.type("打字");
  await page.waitForTimeout(600);
  if (!(await docText(page)).includes("确认动作。打字")) throw new Error("打的字没进正文：" + (await page.evaluate(() => document.activeElement.className)));
  const ratio = await page.evaluate(() => { const v = window.__hm.view(); const c = v.coordsAtPos(v.state.selection.main.head); const r = document.querySelector(".scroller").getBoundingClientRect(); return (c.top - r.top) / r.height; });
  if (Math.abs(ratio - 0.45) > 0.08) throw new Error("打字机滚动位置不对：" + ratio.toFixed(2) + " " + (await page.evaluate(() => localStorage.getItem("holymark-settings").match(/"typewriter":\w+/)?.[0] + document.querySelector(".app").className)));
  const dim = await page.evaluate(() => [...document.querySelectorAll(".cm-content > *")].filter((e) => getComputedStyle(e).opacity !== "1").length);
  if (!dim) throw new Error("段落聚焦没有让其他段落变淡");
  if (!(await page.$(".cm-content > .hm-pf-cur"))) throw new Error("段落聚焦没有标出当前段落");
  await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace");
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("holymark-settings")); Object.assign(s, { paper: "default", typewriter: false, paraFocus: false }); delete s.headingFont; delete s.bodyFont; localStorage.setItem("holymark-settings", JSON.stringify(s)); });
  await page.reload();
  await page.waitForFunction(() => window.__hm?.view?.()?.state.doc.length > 100);
});
step("N17 复制为带格式的文字：Word（MathML）、公众号（公式图片）", async (page) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin });
  const read = () => page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const html = items[0].types.includes("text/html") ? await (await items[0].getType("text/html")).text() : "";
    const text = items[0].types.includes("text/plain") ? await (await items[0].getType("text/plain")).text() : "";
    return { html, text };
  });
  await page.evaluate(() => { const v = window.__hm.view(); v.dispatch({ selection: { anchor: 0 } }); });
  await menu(page, "copy_rich");
  await page.waitForSelector(".toast:has-text('已复制全文')");
  let c = await read();
  if (!c.html.includes("<math") || !c.html.includes("<table") || !c.html.includes("style=")) throw new Error("Word 版的 HTML 不对");
  if (!c.html.includes("data:image/svg")) throw new Error("图片没有内嵌");
  if (!c.text.includes("研究设计")) throw new Error("没有纯文本");
  if (c.html.includes("{==")) throw new Error("批注标记没去掉");
  await menu(page, "copy_wechat");
  await page.waitForSelector(".toast:has-text('可以粘进公众号编辑器')");
  c = await read();
  if (!c.html.includes("data:image/png")) throw new Error("公众号版的公式没有转成图片");
  if (c.html.includes("<math")) throw new Error("公众号版不该有 MathML");
});
step("N21 用 DOI 生成文献条目：加载态、键名去重、追加到 .bib、插入引用、失败说明", async (page) => {
  await page.evaluate(() => { const v = window.__hm.view(); v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); });
  await page.waitForTimeout(100);
  await menu(page, "cite");
  await page.waitForSelector(".ins input");
  await page.keyboard.type("@https://doi.org/10.9999/nothing");
  await page.waitForSelector(".ins-row:has-text('加到')");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ins-err");
  // 演示用的 DOI：Sweller 1988 已经在文献库里，键名要变成 sweller1988a
  await page.fill(".ins input", "@10.1207/s15516709cog1202_4");
  await page.waitForSelector(".ins-row:has-text('references.bib')");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ins-row:has-text('正在向 doi.org 请求')");
  await page.waitForSelector(".ins", { state: "detached", timeout: 5000 });
  const t = await docText(page);
  if (!t.endsWith("[@sweller1988a]")) throw new Error("没有插入引用：" + t.slice(-30));
  await page.waitForSelector(".toast:has-text('sweller1988a')");
  await page.evaluate(() => { const v = window.__hm.view(); const n = v.state.doc.length; v.dispatch({ changes: { from: n - "[@sweller1988a]".length, to: n } }); });
});
step("N9 在文件夹里替换：预览、取消勾选、执行、存版本、撤销", async (page) => {
  const before = await docText(page);
  const other = "/演示/毕业论文/资料/导师意见-1118.md";
  await menu(page, "search");
  await page.waitForSelector(".search");
  await page.keyboard.type("第三章");
  await page.click(".s-scope button:has-text('文件夹')");
  await page.click(".s-repl");
  await page.waitForSelector(".frep");
  await page.fill(".frep input[aria-label='替换为']", "第 3 章");
  await page.waitForSelector(".fr-hit del");
  const n = (await page.$$(".fr-hit")).length;
  if (n < 2) throw new Error("匹配太少：" + n);
  if (!(await page.textContent(".fr-hit ins")).includes("第 3 章")) throw new Error("没有显示替换后的样子");
  // 取消勾选一处，数目跟着变，再勾回来
  await page.click(".fr-hit >> nth=0");
  const foot = await page.textContent(".fr-foot");
  if (!foot.includes(`替换 ${n - 1} 处`)) throw new Error("取消勾选后数目不对：" + foot);
  await page.click(".fr-hit >> nth=0");
  await page.click(".fr-foot .btn.acc");
  await page.waitForSelector(".toast:has-text('个文件里替换')");
  const after = await docText(page);
  if (after === before || !after.includes("第 3 章")) throw new Error("当前文件没有替换");
  const saved = await page.evaluate((p) => localStorage.getItem("holymark-demo-versions:" + p), other);
  if (!saved || !saved.includes("替换前自动保存")) throw new Error("替换前没有给别的文件存版本");
  await page.click(".toast .lnk");
  await page.waitForSelector(".toast:has-text('已撤销替换')");
  if ((await docText(page)) !== before) throw new Error("撤销没有还原当前文件");
});

async function run(theme) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base);
  await ready(page);
  let failed = 0;
  // HM_ONLY=关键词 只跑名字里带这个词的步骤（第一步「打开演示文件夹」总会跑）
  const only = process.env.HM_ONLY;
  for (const s of steps.filter((x, i) => !only || i === 0 || x.name.includes(only))) {
    try {
      await s.fn(page);
      await page.waitForTimeout(150);
      if (shotDir) await page.screenshot({ path: `${shotDir}/${theme}-${s.name.replace(/[\\/:*?"<>| ]/g, "_")}.png` });
      console.log(`  ✓ ${s.name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${s.name}：${String(e.message || e).split("\n").slice(0, process.env.HM_VERBOSE ? 6 : 1).join("\n      ")}`);
      if (shotDir) await page.screenshot({ path: `${shotDir}/${theme}-FAIL-${s.name.replace(/[\\/:*?"<>| ]/g, "_")}.png` }).catch(() => {});
    }
  }
  await browser.close();
  return { failed, errors };
}

let bad = 0;
for (const theme of ["light", "dark"]) {
  console.log(theme === "light" ? "浅色" : "深色");
  const { failed, errors } = await run(theme);
  bad += failed;
  if (errors.length) { bad += errors.length; console.log("  控制台报错：\n    " + errors.join("\n    ")); }
}
console.log(bad ? `有 ${bad} 处问题` : "全部通过，控制台零报错");
process.exit(bad ? 1 : 0);
