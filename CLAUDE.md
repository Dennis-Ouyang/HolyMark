# HolyMark 工作约定

面向长篇中文写作的本地 Markdown 编辑器（Tauri 2 + React 18 + CodeMirror 6）。界面文字、注释、提交说明都用简体中文。

## 改界面之前

**先读 `docs/design-vocabulary.md`。** 所有界面、动效改动都按里面的规矩来；要破例，就在那篇文档里写明理由。要点：

- 气质是安静、克制、不抢正文。动效时长短、幅度小、回弹轻（≤ 3%，关键帧里的回弹不超过 `scale(1.04)`）。
- 用现成的 token 和组件，不要另起一套：`--ease`（进场）、`--ease-out`（退场）、`--spring` / `--spring-ms`（弹簧）、`--scrim`（遮罩），以及 `<Presence>`（退场）、`.btn.loading`（加载态按钮）、`<Segmented>`（单选）、`useStagger`（错峰）。
- 有进场就有退场：新加的条件渲染弹窗、浮窗、提示条，用 `<Presence>{cond && <X/>}</Presence>` 包起来。
- 浮层从触发点长出来（设好 `transform-origin`），退场比进场短。
- 按钮的宽度和位置不能因为状态变化而跳：加载时文字不换，叠加转圈。
- 可撤回的操作先做后撤销（提示条带「撤销」），不要先弹"确定吗"。
- 颜色用浅底深字的 token 对（`--accent-soft` / `--accent-fg` 等），遮罩用 `var(--scrim)`，不要在组件里写死 rgba。
- 尊重 `prefers-reduced-motion`；Windows 上定位用整数像素，避免文字发虚。

## 检查

- `npx tsc --noEmit`、`npx vitest run` 都要通过。
- 改了界面就用 `npm run dev` 在浏览器里实际点一遍（浏览器里用的是内置演示文件夹）。
- 推到 `main` 会触发 `.github/workflows` 里的 macOS 和 Windows 安装包构建。
