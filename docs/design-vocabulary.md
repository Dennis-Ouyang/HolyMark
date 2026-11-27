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

- **文件横条的纸张预览**（`src/editor/fileCard.ts`、`.hm-fpeek`）：文件卡片已改成横条，一叠纸的画法只在悬停图标 400ms 后出现的浮层里，静止的纸张不再常驻正文；浮层退场 100ms。
- **公式预览浮层**（`.hm-mathtip`）、批注浮层（`.hm-notebub`）、链接提示（`.hm-linktip`）挂在 CodeMirror 的 tooltip 层里，和 `Menu`、`Select` 一样不在 `Presence` 里，没有退场。
- **编辑器里的 DOM 菜单和小浮层**（`domMenu.ts` 的块把手菜单、批注的更多菜单、引用和脚注的悬停浮层、统一悬停提示 `Tooltip.tsx`）不是 React，不走 `Presence`；菜单关闭时加 `.leaving` 走 100ms 淡出，悬停提示直接消失（只是文字提示，没有退场更安静）。
- **侧栏抽屉**（窄窗口，`.app.narrow`）用 `translate` 200ms `--ease` 滑出。理由：这是一整块面板的进出，从屏幕边缘滑进来比淡入更好懂；时长仍在对话框档位内。

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

- **浮层外观**用 `app.css` 的 `--float`（见下文「叠层阴影」），新功能不另定义 token。新做的浮层用 `.hm-float`（`position: fixed`，`--raised` 底，容器圆角 12px、里面的控件 8px，进场 150ms `floatIn`、退场 110ms `floatOut`，包在 `<Presence>` 里）。
- **小标签 `.tag`**：浅底深字，默认是主题色（`--accent-soft` / `--accent-fg`）；`.tag.soft` 是提醒用的琥珀色（`--warn-bg` / `--warn`，都在 `app.css`），只用于「提醒你看一眼、但不是错误」的信息。
- **等宽数字 `.num`**：会变的数字一律加。
- **只标出、不改**：程序发现但不该替用户决定的地方（比如重复字词），在正文里用 `--warn` 的细波浪下划线 `.hm-repeat` 标出，改到那几个字时标记自动消失。不用红色，红色留给错误和删除。
- **从触发点长出来**：从功能区按钮打开的浮层贴着按钮下沿、`transform-origin` 放在按钮那一侧；从 ⌘K 打开、没有触发点的，放在正文区右上角，原点在右上角。

- **补全列表 `.hm-ac`**：CodeMirror 的补全浮层也用 `--float` 外观；每一项是「名称（等宽）、弱化的说明、右对齐的预览」。补全只在特定位置出现（比如公式里的 `\`），正文里打字不弹。补全列表开着时，同一处的错误提示（「公式有误」）先藏起来，免得两层浮层叠在一起。
- **符号面板这类「连续点」的浮层**：按下时 `preventDefault`，焦点一直留在正文里，可以连着点；Esc 或右上角的叉关闭，关闭后焦点回到正文原来的位置。

- **文献、脚注的悬停浮层**：阅读模式和编辑时用同一套（文献 `.hm-citetip`：题名、作者和年份、出处；脚注 `.hm-fntip`），不另做一套外观。缺了的文献写「文献库里没有 @key」。
- **悬停提示只有一个 `.hm-tip`**：要异步算内容的（文件树悬停显示字数），在元素上写 `data-tipsrc`，用 `setTipSource` 登记，由 `TooltipLayer` 统一显示，不自己再画一个。
- **图片放大 `.lightbox`**：遮罩 `var(--scrim)` 加 2px 模糊；第一张从正文里原来的位置长出来（量出原位和终点，`transform` 260ms `--ease`），之后翻页只淡入；退场 110ms 淡出并缩到 .97，比进场短。图注和「第几张」放在图片下方的小牌子里，计数用 `--fg-3` 等宽数字。缩放以指针处为中心，静止时位移取整数像素。
- **打开链接只有一个入口**（`editor/links.ts` 的 `openLink`）：编辑时 ⌘ / Ctrl + 点击、阅读模式单击、文件横条、跨文件 `.md#锚点` 都走它；锚点按 Pandoc 规则找，找不到用提示条说明，跳转记进返回 / 前进。后端拦下（比如不直接打开程序和脚本）时，提示条显示后端给的原因。
- **阅读模式**：只是「不能编辑」，不换一套样式：版式、字体、颜色都和编辑时一样，只把编辑用的控件（图片工具条、表格工具条、批注小图标）藏起来，链接显示手形、图片显示放大镜。

- **纸张底色**：`--paper-cream`、`--paper-gray` 两个 token，深浅色各一套（米白 / 暖黑，护眼灰 / 深灰），只铺在正文区（`.main .scroller`），侧栏、标题栏、右栏不变。
- **段落聚焦**：只在编辑器有焦点时生效；其余块降到 35% 不透明度，160ms 过渡。
- **打字机滚动不做动画**：每次按键都在移动，平滑滚动会和编辑器自己的滚动校正互相打断，所以直接到位（这条是「滚动要平滑」的例外）。

## 三、这一轮新增的规矩

### 颜色与 token

- **黄色只留一个色相**（琥珀），按用途分深浅：`--mark-bg`（==高亮==）、`--hit-bg`（搜索命中）、`--hit-cur`（当前命中）、`--hit-line`（滚动条刻度）。不要在组件里写 `rgba(232,180,40,…)`。
- **批注不用黄色**：原文一层 `--note-bg`（主题色 9%，深色 16%），悬停 `--note-bg-hover`，页边圆点 `--note-fg`。琥珀色在语义上是「警告」，只给 `--warn`。
- **语义色**：成功 `--ins`，警告 `--warn`，出错 `--del`。提示条前面的小圆点按语义着色，普通提示不带点（`say(msg, kind, action)`）。
- **选中态一律浅底深字**：菜单、下拉、⌘K、列表的当前项是 `--accent-soft` 底 + `--accent-fg` 字；危险项选中时 `--del-bg` + `--del`。不再用「实色主题色 + 白字」。
- **三档灰的分工**：`--fg-3` 只给时间、计数、快捷键键帽这类可以忽略的信息；承载信息的次要文字（空状态说明、设置说明、「找不到这个文件」、副标题）用 `--fg-2`（`--fg-3` 在白底上对比度只有约 3.3:1）。
- **禁用态**：平的浅灰底（`--hover`）加 `--fg-3` 文字、不带阴影，不整体降透明度；加载中的按钮不受影响。
- **叠层阴影** `--float`：发丝描边 + 1/3/6/12px 四层淡影。浮层（批注、插入文件、DOM 菜单、引用和脚注浮层、悬停提示、块工具条）用它；居中的对话框仍用 `--pop`。

### 块与版心

- **块的左右边缘对齐正文栏**（二选一里选了「对齐」，不向外伸出）：表格、图片框、代码块、公式块、Mermaid 的可见边缘都在正文栏上；悬停底色可以向外伸出（文件横条伸出 8px），但内容的对齐不变。列表、引用里的块对齐所在块的文字起点。
- **块的上下间距两档**：`--gap-text`（段距，空行收窄后的高度；列表紧跟段落时上面也留这一档）；`--gap-media`（图表、公式、图片、表格在段距之外上下各 8px）。列表项之间 5px。
- **块工具条放在块内部的右上角**，悬停（表格）或选中（图片）才出现，不浮在块上方盖住上一行正文；样式统一（`--raised` + `--float`，按下状态浅底深字）。
- **块的「显示源代码」**：表格、图片在工具条右端，文件横条在「更多」菜单，列表在把手菜单；说法统一成「显示源代码 / 源代码」。
- **列表**：符号放在固定宽度的槽（`--slot: 1.75em`）里悬挂在文字左边；每深一层缩进一个槽宽，子项符号对齐父项文字起点；项目符号按 • ◦ ▪ 循环；编号用等宽数字、右对齐、位数多了往左伸。
- **待办**：进度只数叶子；父项用进度环和一个安静的计数「3/4」（12px、`--fg-3`，全部完成时 `--accent-fg`），不铺整行底色；矛盾状态显示半选。
- **表格默认三线表**（顶线、表头下线、底线，没有竖线），数字列右对齐、等宽数字；编辑时字体不变，只有一层聚焦框。

### 文字与信息层级

- **不用「·」把几条信息串成一行一样灰的字**。用字号、字重、三档灰和间距分层，必要时拆两行或右对齐（时间右对齐、等宽数字、`--fg-3`；增减字数用绿 / 红数字单独显示）。
- **中间截断**：文件名、文稿名、路径一律用 `MidName`（React）或 `midNameEl`（编辑器里），保住结尾和扩展名之前的区分部分。
- **文件类型用图标容器**（`fileKind.ts`、`FileBadge`）：类型约 9% 浅底 + 发丝内描边 + 同色深字，Office 和 PDF 写「W」「X」「P」「PDF」，其他用图标。文件横条、文件树、插入浮层共用。
- **空状态**：一个小图标、一句话说明、一个操作（`Empty`），不用「Markdown 语法」这类术语。
- **悬停提示**用 `TooltipLayer`：名称 + 右对齐的弱化键帽，约 400ms，只放文字，不放可点的东西。快捷键文字由命令注册表的 `tipOf(id)` 生成，不在组件里手写「⌘⇧E」。
- **数字框就地说明**：超出范围改成边界值并在框下面说明（「最大 10 厘米」），不悄悄改掉。
- **引号统一用「」**。

### 交互

- **对话框关闭后把焦点和光标还给正文**（App 统一处理）；**Esc 只关最上面一层**（开着下拉、菜单时先关它们）。
- **先做后撤销**扩展到：恢复默认（导出、设置）、套用预设、删除列表项、勾选父项、解决 / 删除批注、撤销这次打开以来的修改。
- **⌘S 是不打断的存档点**：提示条「已存档」带「起个名字」，点了才弹对话框；关闭应用不问也不回滚。
- **窄窗口**（< 1100）两侧栏变成浮在正文上的抽屉；功能区窄（< 760）时段落样式收成下拉、分组标签收起；导出对话框窄（< 980）时「选项 / 预览」切换。

## 四、需要产品负责人定的名字

这一轮按「不另造概念」的要求，以下叫法先这样写，请产品负责人定：

- 功能区标签「本篇显示」（原来叫「版式」，和导出里的「版式」同名不同义）；
- ⌘S 的「存档」和提示条上的「起个名字」；右栏的「撤销这次打开以来的修改」；
- 批量导出的「导出这个文件夹…」「合并成一个文件」「分别导出」，以及输出文件夹名「导出」；
- 导出的场景预设名「学位论文」「课程论文」「投稿」「打印稿」（交接文档里给的）；
- 设置页「写作与版本」「本篇显示」相关说明，「批注署名」。

---

## 五、原版提示词（Say to AI）

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
