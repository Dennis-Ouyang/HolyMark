/**
 * 冒烟测试：打开浏览器预览，加载演示稿和一份覆盖所有块类型的测试稿，
 * 点几处常用界面（导出、搜索、设置、浅色 / 深色），控制台出现任何 error 就判失败。
 *
 * 用法：先 `npm run dev`，再
 *   NODE_PATH=$(npm root -g) node scripts/smoke.mjs            # 默认 http://localhost:1420
 *   NODE_PATH=$(npm root -g) node scripts/smoke.mjs http://localhost:1421   # 检查 vite preview（带 CSP）
 * 需要 Playwright（npm i -g playwright 或本机已装）。
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const url = process.argv[2] || "http://localhost:1420";
const fixture = readFileSync(new URL("../tests/fixtures/all-blocks.md", import.meta.url), "utf8");

const errors = [];
const browser = await chromium.launch();
const ok = (msg) => console.log("  ✓ " + msg);

async function run(theme) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, colorScheme: theme });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${theme}] ${m.text().split("\n")[0]}`); });
  page.on("pageerror", (e) => errors.push(`[${theme}] ${String(e).split("\n")[0]}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__hm?.view?.(), null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  ok(`${theme}：演示稿打开`);
  // 滚到底，让 Mermaid、公式、文件卡片都渲染一遍
  await page.evaluate(() => { const s = document.querySelector(".cm-scroller") || document.querySelector(".scroller"); if (s) s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(1500);
  await page.evaluate((t) => { const v = window.__hm.view(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } }); }, fixture);
  await page.waitForTimeout(1500);
  // 光标走一遍全文：每个块都进出一次源码 / 渲染
  await page.evaluate(async () => {
    const v = window.__hm.view();
    for (let i = 1; i <= v.state.doc.lines; i++) {
      v.dispatch({ selection: { anchor: v.state.doc.line(i).from } });
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await page.evaluate(() => { const s = document.querySelector(".cm-scroller") || document.querySelector(".scroller"); if (s) s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(1500);
  ok(`${theme}：测试稿渲染、光标走遍所有行`);
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+Shift+E`);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  ok(`${theme}：导出对话框`);
  await page.keyboard.press(`${mod}+K`);
  await page.waitForTimeout(400);
  await page.keyboard.type("研究");
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok(`${theme}：搜索`);
  await page.close();
}

try {
  await run("light");
  await run("dark");
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(`\n✗ 控制台有 ${errors.length} 条 error：`);
  for (const e of [...new Set(errors)]) console.error("  " + e);
  process.exit(1);
}
console.log("\n冒烟测试通过：控制台零报错");
