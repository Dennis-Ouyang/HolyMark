# HolyMark 设计词汇与动效规矩

改界面之前先读这一篇。人也好，AI 也好，改动都要按这里的规矩来；要破例就在这篇里写明理由。

来源：[Topinspo · Design Vocabulary](https://topinspo.design/vocabulary)。这个网站收了 75 个界面设计术语，每个词都配有改前/改后对比和一句「Say to AI」。本篇第一部分是把它落到 HolyMark 上的规矩，用的是这个项目实际在用的数值和写法；第二部分原样摘录与我们相关的那些「Say to AI」，作为对照。

HolyMark 的气质：**长篇写作工具，安静、克制、不抢正文**。网站上的数值是通用的，遇到"活泼"和"安静"冲突时，我们站安静那边：时长更短，幅度更小，回弹更轻。

---

## 一、动效规矩

### 1. 现成的工具，先用它们

| 要做的事 | 用什么 | 在哪 |
|---|---|---|
| 进场缓动 | `var(--ease)`，即 `cubic-bezier(.2,.8,.2,1)`（先快后缓） | `src/styles/app.css` 顶部 token |
| 退场缓动 | `var(--ease-out)`，即 `cubic-bezier(.4,0,1,1)`（先慢后快） | 同上 |
| 弹簧 | `var(--spring)` + `var(--spring-ms)`：stiffness 400 / damping 30，回弹约 3%，420ms 落定。旧 WebView 不支持 `linear()`，会自动退回 `--ease` / 220ms | 同上 |
| 条件渲染的弹窗、浮窗、提示条要有退场 | `<Presence>{cond && <X/>}</Presence>`，退场动画写在 `.leaving …` 规则里 | `src/components/Presence.tsx` |
| 按钮进入加载态 | 加 `.loading` 类，文字包在 `<span className="lbl">` 里，**文字不换** | `.btn.loading`，示例见 `ExportDialog.tsx` 的导出按钮 |
| 列表第一次出现时错峰进场 | `useStagger(group)`，返回 `{ cls, style }` 加到条目上 | `src/components/SidePanel.tsx` |
| 单选、分段切换 | `<Segmented>`，滑块用弹簧 | `src/components/Segmented.tsx` |

### 2. 时长与幅度

| 场景 | 时长 | 幅度 | 备注 |
|---|---|---|---|
| hover、颜色、边框变化 | 120ms | — | 不要更长 |
| 小浮层进场（菜单、下拉、浮窗、格式栏） | 120–160ms | `scale(.96–.97)` + 3–4px 位移 | 网站给的是 280ms / `scale(.92)`，对写作工具来说太慢太大 |
| 对话框进场 | 160–180ms | `scale(.98)` | |
| 退场 | 100–140ms | 往进来的方向退回去 | **退场比进场短** |
| 弹簧 | `--spring-ms` | 回弹 ≤ 3% | 关键帧里手写的回弹也不超过 `scale(1.04)` |
| 按下 | 按住 90ms ease-out，松开走弹簧 | 文字按钮 `.97`，图标按钮 `.94` | 已对 `.btn` `.ib` `.rb` 统一生效 |
| 错峰 | 每条间隔 40ms | 第 8 条以后一起进 | 只在第一次出现时错峰，平时重绘不重播 |
| 跳转高亮、闪烁提示 | ≤ 1s | — | 一次就停，不循环 |

### 3. 规则

1. **进场先快后缓，退场先慢后快。** 不要用 `linear` 做位移（转圈除外）。
2. **有进场就要有退场。** 新加的对话框、浮窗、提示条，用 `<Presence>` 包起来，并在 `.leaving` 规则里写退场。挂在 `document.body` 上的 portal（`Menu`、`Select`）不在 Presence 的 DOM 里，没有退场，进场做好就行。
3. **从哪来，往哪长（原点缩放）。** 浮层的 `transform-origin` 放在触发它的那个角或那个点：下拉放在按钮角上，右键菜单放在鼠标点上，格式栏放在选区那一侧。居中的对话框例外，从中心缩放。
4. **按钮的宽度和位置不能因为状态变化而跳。** 加载、成功、失败时都不换按钮文字；要显示状态，用叠加的图标或旁边的状态文字。
5. **等一下再显示加载。** 很快就能完成的操作，120–200ms 内不要出现转圈，免得一闪。
6. **弹簧只用在"落定"上**，比如滑块、开关、按下回弹。不要用在大面积位移或整页切换上。
7. **错峰只给列表首次出现用。** 打字、保存、增删一条时都不重播。
8. **每个动画都要尊重"减弱动态效果"。** `app.css` 里已有全局 `prefers-reduced-motion` 规则；新写的 JS 动画（`setTimeout`、`requestAnimationFrame` 驱动的）要自己判断。
9. **用 `scale`、`translate` 这类单独的变换属性，或者 `opacity`。** 不要去动画 `width`、`height`、`top`、`left`。唯一例外是分段滑块的 `width`。
10. **Windows 上避免半像素。** 定位用整数像素；静止状态不要留下 `translateX(-50%)` 这类会让文字发虚的变换。

### 4. 已经写明理由的例外

- **文件预览卡片的悬停**（`src/editor/fileCard.ts`、`.hm-fcard`）：前面那张纸上浮 6px、后面两张展开到 ±3.5°/4°，用 `transform` 走 240ms `--ease`，比「hover 120ms」长。理由：这是在纸张位移，不是颜色变化，120ms 太短看不出"纸张"的感觉；幅度很小、没有回弹，仍然安静。后面两张纸上没有字，静止时的旋转不会让文字发虚；前面那张静止时没有变换。
- **公式预览浮层**（`.hm-mathtip`）挂在 CodeMirror 的 tooltip 层里，和 `Menu`、`Select` 一样不在 `Presence` 里，没有退场。

---

## 二、视觉与交互规矩

- **浅底深字（Tint & Shade）**：状态标签、提示条、选中态用同色系浅底（8–14%）配同色深字，不用纯色实底。现成的 token：`--accent-soft` / `--accent-fg`，`--ins-bg` / `--ins`，`--del-bg` / `--del`，`--anno` / `--anno-line`。
- **遮罩（Scrim）**：一律用 `var(--scrim)`，浅色 28%、深色 50%，不要在组件里写死 rgba。
- **一个区域只有一个主按钮**（`.btn.acc`），其余用普通 `.btn` 或文字链接。
- **次要文字分级降灰**：正文 `--fg`，次要 `--fg-2`，时间和计数 `--fg-3`。
- **细线描边**：分组优先用留白，留白不够再用 `--line` 细线；不要叠加粗边框和阴影。
- **先做后撤销，代替"确定吗"**：可撤回的操作直接执行，再弹带「撤销」的提示条（`say(msg, { label: "撤销", run })`）。确认弹窗只留给真正无法撤回、而且会影响文件以外东西的操作。
- **会跳动的数字用等宽数字**：字数统计、进度、页码，用 `font-variant-numeric: tabular-nums`。
- **长文件名在中间截断**，保住扩展名和区分用的后缀。
- **快捷键提示右对齐、弱化**，统一用 `kbd()` 生成。
- **Tabs 和分段控件不要混用**：切换"页面"用标签，切换"同一份内容的不同看法"用 `Segmented`。

## 二之二、新功能加的规矩

新功能的样式放在 `src/styles/features.css`，组件和编辑器扩展尽量放进新文件（`src/features/`、`src/editor/features.ts`），共用的大文件里只加接线。

- **浮层统一外观 `--float`**：`--raised` 底，叠层淡阴影（1、3、6、12px，各约 5%）加一圈 0.5px 发丝描边；容器圆角 12px、里面的控件 8px。新做的浮层用 `.hm-float`（`position: fixed`，进场 150ms `floatIn`、退场 110ms `floatOut`，包在 `<Presence>` 里）。旧的 `.pop` / `--pop` 暂不改。
- **小标签 `.tag`**：浅底深字，默认是主题色（`--accent-soft` / `--accent-fg`）；`.tag.soft` 是提醒用的琥珀色（`--warn-bg` / `--warn`），只用于「提醒你看一眼、但不是错误」的信息。
- **等宽数字 `.num`**：会变的数字一律加。
- **只标出、不改**：程序发现但不该替用户决定的地方（比如重复字词），在正文里用 `--warn` 的细波浪下划线 `.hm-repeat` 标出，改到那几个字时标记自动消失。不用红色，红色留给错误和删除。
- **从触发点长出来**：从功能区按钮打开的浮层贴着按钮下沿、`transform-origin` 放在按钮那一侧；从 ⌘K 打开、没有触发点的，放在正文区右上角，原点在右上角。

- **补全列表 `.hm-ac`**：CodeMirror 的补全浮层也用 `--float` 外观；每一项是「名称（等宽）、弱化的说明、右对齐的预览」。补全只在特定位置出现（比如公式里的 `\`），正文里打字不弹。补全列表开着时，同一处的错误提示（「公式有误」）先藏起来，免得两层浮层叠在一起。
- **符号面板这类「连续点」的浮层**：按下时 `preventDefault`，焦点一直留在正文里，可以连着点；Esc 或右上角的叉关闭，关闭后焦点回到正文原来的位置。

## 三、现状里已知不合规的地方（待改）

- `.btn:disabled { opacity: .45 }`：网站建议禁用态用平的浅灰底加弱化文字，而不是整体降透明度。改的时候要连深色主题一起看。

---

## 四、原版提示词（Say to AI）

以下原文摘自 topinspo.design/vocabulary，用来对照。数值是网站给的通用值；跟第一部分冲突时，以第一部分为准。

| 词 | 中文 | Say to AI（原文） |
|---|---|---|
| **动效** | | |
| Easing | 缓动 | Animate the panel with ease-out, cubic-bezier(0.32, 0.72, 0, 1), over 240ms instead of linear for a soft stop. |
| Spring | 弹簧 | Animate the active pill with a snappy spring (stiffness 400, damping 30) instead of plain ease for a settle. |
| Press State | 按下反馈 | Scale buttons to 0.97 on press with a 120ms ease-out and spring cleanly back to 1 on release for tactile feel. |
| Loading Button | 加载态按钮 | Lock the submit button's width while loading, fade the label up into a centered spinner, and keep sibling buttons motionless so the toolbar never jumps. |
| Exit Motion | 退场动画 | Animate dismissed list cards out with a brief slide-and-fade before smoothly translating remaining cards upward, instead of snapping instantly. |
| Origin-Aware Motion | 原点缩放 | Set transform-origin on the dropdown menu to match its trigger button corner (e.g. top right) and animate gently from scale(0.92) + -4px over 280ms ease-out instead of popping from center. |
| Stagger | 错峰出场 | Stagger list item entrances by 50ms per row (0, 50, 100ms) instead of fading every row in at the same time. |
| Directional Motion | 方向性转场 | Push sub-pages in from the right while shifting the parent left, and slide back out right on Back instead of fading. |
| Shared Element | 共享元素 | Grow the same thumbnail into the detail view over 520ms with ease-out instead of hard-cutting to a new screen. |
| Hover Reveal | 悬停显示 | Hide the row copy and delete icons by default so the list stays calm, and smoothly fade them in on the hovered row while keeping other rows clean. |
| **层次与容器** | | |
| Scrim | 遮罩层 | Add a 26% dark scrim behind the open modal so the page recedes and focus locks onto the dialog. |
| Edge Fade | 边缘渐隐 | Fade the right 56px of the horizontal chip bar with a CSS mask-image gradient so overflowing tags never clip mid-word. |
| Sticky Header | 吸顶标题 | Give the pinned sticky header an opaque background, a 0.5px bottom hairline, and a soft downward shadow once scrolled so passing rows visibly tuck underneath instead of colliding. |
| Layered Shadow | 叠层阴影 | Replace the single dark smudge with 4 faint shadow layers (1, 3, 6, 12px at 5%) plus a soft hairline ring. |
| Concentric Radius | 同心圆角 | Set the inner cover radius to outer radius minus padding (20 − 10 = 10px) so the corner gap stays uniform. |
| Hairline Border | 细线描边 | Replace the heavy 1.5px #a3a3a3 border with a crisp 0.5px rgb(0 0 0 / 10%) hairline without adding shadow. |
| Divider vs. Space | 分隔线 vs 留白 | Remove dividers between sibling rows; separate items with space inside a group and keep one faint hairline between. |
| **颜色** | | |
| Tint & Shade | 浅底深字 | Replace heavy 100% solid fills on status pills, banners, and active tags with a light tint background (~8% hue), a faint matching hairline border, and deep shade text from the same hue. |
| Accent | 强调色 | Turn secondary actions into neutral white controls and save your one accent color solely for the Publish CTA. |
| Semantic Color | 语义色 | Color status pills by meaning: green for Passed, amber for 90% used, red for Failed; keep the rest neutral. |
| Muted Text | 次要文字降灰 | Keep comment body #171717, step names and Reply down to #737373, and mute timestamps and counts to #a3a3a3. |
| Disabled State | 禁用态 | Style disabled controls as a flat matte light-gray surface (#f2f2f2) with muted text and zero shadow instead of dimming dark buttons with opacity. |
| Destructive Action | 危险操作 | Isolate destructive menu items like Delete at the bottom below a hairline divider with restrained crimson text and icon instead of blending them in. |
| **文字** | | |
| Line Height | 行高 | Set body copy line-height to 1.7 so wrapped lines never crowd each other, while keeping headings tight at 1.2. |
| Tabular Numbers | 等宽数字 | Enable font-variant-numeric: tabular-nums on price columns and live totals so decimals align without jitter. |
| Text Balance | 标题均衡换行 | Add text-wrap: balance to the headline so it wraps into two even lines instead of leaving one orphan word. |
| Middle Truncation | 中间截断 | Use middle truncation instead of end ellipsis on long filenames and paths (e.g. design-sy…light.css) so users can still read the extension and version. |
| Shortcut Hint | 快捷键提示 | Move inline shortcuts like (Cmd+K) out of the menu labels and right-align them as subtle monospace keycaps (⌘ K, ⌘ E, ⌘ S) with a soft hairline border. |
| **交互模式** | | |
| Undo Toast | 先做后撤销 | Archive the email right away and show a toast with Undo for 5 seconds instead of an "Are you sure?" modal. |
| Diff View | 行内差异 | Show the AI rewrite inline in one line: strike removed words in red, tint added words green, with Accept below. |
| Tabs vs. Segmented | 标签页 vs 分段控件 | Keep Overview, Reports and Settings as tabs, and make 7D, 30D and 90D a small segmented control by the number. |
| Switch vs. Checkbox | 开关 vs 复选框 | Use a switch for Auto-save because it applies right away, and a checkbox for terms that only count on Save. |
| Popover vs. Tooltip | 浮层 vs 提示 | Keep tooltips to a short label, and put the share link field and Copy button in a popover that stays open. |
| Progressive Disclosure | 渐进展开 | Keep only the 2 most common export controls upfront and fold low-frequency settings (scale, color profile, metadata) behind a clean Advanced options disclosure row. |
| Command Palette | 命令面板 | Add a ⌘K command palette that filters every action as you type, so Export as PDF is one search away. |
| Empty State | 空状态 | Replace the bare empty text with a small icon, one line explaining what goes here, and a New collection button. |
| Inline Validation | 就地校验 | Show the mismatch error right under the Confirm field and outline that field in red, not at the top of the card. |
| Skeleton | 骨架屏 | While the post loads, show placeholders in its final layout (avatar, name, two lines) instead of a spinner. |
| Touch Target | 点击热区 | Keep the toolbar icons crisp at 15px, but expand each icon button's hit area to 40×40px so tapping never feels cramped. |
