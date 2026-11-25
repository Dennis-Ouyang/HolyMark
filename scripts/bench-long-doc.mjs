// 长稿性能测量：用浏览器预览打开 20 万字的测试稿，测打字和移动光标的耗时。
// 用法：先 `npm run dev`，再 `node scripts/bench-long-doc.mjs [字数]`
import { createRequire } from "node:module";
// 用全局装的 Playwright 也行：NODE_PATH=$(npm root -g) node scripts/bench-long-doc.mjs
const { chromium } = createRequire(import.meta.url)("playwright");

const chars = +(process.argv[2] || 200000);
const url = `http://localhost:1420/?stress=${chars}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: "longtask", buffered: true });
});
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__hm?.view?.()?.state.doc.length > 1000, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const loadMs = Date.now() - t0;

// 光标放到文档中部某段末尾
await page.evaluate(() => {
  const v = window.__hm.view();
  const doc = v.state.doc;
  let n = Math.floor(doc.lines / 2);
  while (!/。$/.test(doc.line(n).text)) n++;
  v.focus();
  v.dispatch({ selection: { anchor: doc.line(n).to }, scrollIntoView: true });
});
await page.waitForTimeout(800);
await page.evaluate(() => { window.__long = []; });

// 1) 真实键盘输入：逐个发送按键，每个按键等渲染进程处理完
const N = 80;
let t = Date.now();
for (let i = 0; i < N; i++) await page.keyboard.type("a");
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
const typeMs = (Date.now() - t) / N;

// 2) 编辑器同步更新耗时（状态 + 装饰 + DOM）
const dispatchMs = await page.evaluate(() => {
  const v = window.__hm.view();
  const xs = [];
  for (let i = 0; i < 60; i++) {
    const a = performance.now();
    v.dispatch({ changes: { from: v.state.selection.main.head, insert: "字" }, selection: { anchor: v.state.selection.main.head + 1 } });
    xs.push(performance.now() - a);
  }
  xs.sort((a, b) => a - b);
  return { median: xs[30], p90: xs[54] };
});
await page.waitForTimeout(500);

// 3) 移动光标（只改选区，不改文字）
t = Date.now();
for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowDown");
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
const arrowMs = (Date.now() - t) / 40;
await page.waitForTimeout(500);

const longs = await page.evaluate(() => window.__long);
const docLen = await page.evaluate(() => window.__hm.view().state.doc.length);
console.log(JSON.stringify({
  docChars: docLen,
  loadMs,
  perKeystrokeMs: +typeMs.toFixed(1),
  editorDispatchMs: { median: +dispatchMs.median.toFixed(2), p90: +dispatchMs.p90.toFixed(2) },
  perArrowMs: +arrowMs.toFixed(1),
  longTasks: longs.length,
  longestTaskMs: Math.round(Math.max(0, ...longs)),
}, null, 2));
await browser.close();
