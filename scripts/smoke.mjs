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

async function run(theme) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base);
  await ready(page);
  let failed = 0;
  for (const s of steps) {
    try {
      await s.fn(page);
      await page.waitForTimeout(150);
      if (shotDir) await page.screenshot({ path: `${shotDir}/${theme}-${s.name.replace(/[\\/:*?"<>| ]/g, "_")}.png` });
      console.log(`  ✓ ${s.name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${s.name}：${String(e.message || e).split("\n")[0]}`);
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
