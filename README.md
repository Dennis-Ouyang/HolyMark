# HolyMark

面向长篇中文写作的本地 Markdown 编辑器。打开一个文件夹就开始写，稿件就是普通的 `.md` 文件。

- **实时预览**：光标所在的块显示 Markdown 源码，其余部分按格式渲染。支持一到六级标题、强调、==高亮==、上下标、多级列表（Tab / ⇧Tab 调层级）、待办（父项按子项完成度铺底色）、引用、表格（可拖动列宽）、代码块（高亮）、LaTeX 公式、Mermaid 图表、图片（点一下可视化缩放）、文献引用 `[@key]`、批注。
- **浮动工具栏与功能区**：选中文字出现格式栏，按钮显示当前格式；粗体、斜体、删除线可以任意叠加、去掉，符号按规范嵌套写回。编辑区上方的功能区可折叠，分「开始」「插入」「版式」，窗口窄时可以横向滚动。
- **中文友好的强调识别**：`这是~~**测试**~~文字` 这类中文里紧挨着的格式符号，编辑器也能正确识别（CommonMark 的规则在没有空格的中文里会失效；Pandoc 导出本来就没问题）。
- **文件预览卡片**：正文里单独成段的 PDF、Word、PPT、Excel、Markdown 链接显示成一叠纸：PDF 画出第一页，其他画出开头的文字或表格；鼠标移上去纸张上浮、后页展开，双击用默认程序打开。
- **公式**：光标在 `$…$` 或 `$$…$$` 里时下方浮出渲染结果，写错了显示哪里错；行间公式编号可以在设置里打开（导出 PDF 也能编号）。
- **搜索**：`⌘K` 分「全部 / 本文 / 文件夹 / 命令」，结果按文件归组，右边预览匹配处前后的原文。
- **插入文件链接**：`⌘⇧C` 在光标处弹出小浮层：最近用过的、和本文同一个文件夹的文件，打字在整个文件夹里找，`@` 开头插文献引用，文件夹外的用系统文件窗口选。也可以直接从访达 / 资源管理器把文件拖进正文：图片插成插图（文件夹外的先复制进 assets/），其他文件插成链接。
- **文件管理**：文件树右键新建、改名、副本、移动、删除到废纸篓（版本历史跟着走，每一步都能在提示条上撤销）；点文件夹名切换最近打开的文件夹；任意两篇文稿可以左右对比。
- **版本**：自动保存；`⌘S` 保存带名字的版本；文件被外部程序（比如 Claude Code）改写时自动记一个版本。点开任意版本与现在整篇对照，红删绿增，可以恢复。
- **关闭前询问**：这次打开以后改过文件，关闭应用时会问保存还是不保存。选「不保存」文件回到打开时的样子，刚才写的内容作为一个版本留着，随时能找回。可以在设置里关掉。
- **批注**：图形化添加和编辑：选中文字点「批注」，下方弹出卡片直接写；正文里只显示高亮的原文和一个小图标，光标落在上面或点图标就能看、能改、能解决。文件里存的是标准的 CriticMarkup：`{==原文==}{>>@作者 日期：内容<<}`，AI 读得到，换编辑器也不丢。
- **设置分两层**：`⌘,` 是所有文件的默认值（带标题和正文的实时预览）；功能区「版式」写进文件开头的 YAML 属性区，只对这一篇生效。界面有浅色、深色和九种主题色。
- **导出**：`⌘⇧E` 导出 Word、PDF、Markdown。纸张、页边距、页眉页脚、中西文字体、字号、行距、缩进、各级标题和编号都能设，右边实时预览；页边距有常规、窄、适中、宽四种预设；一到三级标题分别设置。可以选一个 Word 文件作参考文档，读取它的样式（沿样式的继承关系和主题字体读出实际效果）。Word 和 PDF 由内置的 Pandoc 和 Typst 生成，不用另装；导出时显示进度，完成后可以直接打开文件。

图标用的是 [Tabler Icons](https://tabler.io/icons)（MIT 许可），PDF 缩略图用 [pdf.js](https://mozilla.github.io/pdf.js/)（Apache-2.0）。

设计稿与设计说明：<https://claude.ai/artifact/Uj4kSG4mLp19vCAiD6M7n3>

## 在 Mac 上运行

需要先装好：

1. Xcode 命令行工具：`xcode-select --install`
2. Rust：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
3. Node.js 20 或更新版本
4. 开发时导出需要 Pandoc 和 Typst：`brew install pandoc typst`（安装包里已经内置，用户不用装）

然后在项目目录里：

```bash
npm install
npm run tauri dev      # 开发模式，改代码会自动刷新
npm run tauri build    # 打包，产物在 src-tauri/target/release/bundle/
```

只想看界面，不装 Rust 也可以：`npm run dev`，然后浏览器打开 <http://localhost:1420>。浏览器里用的是内置的演示文件夹，不会读写你的文件。

Mac 安装包用的是临时签名（ad-hoc，`tauri.conf.json` 里 `"signingIdentity": "-"`），没有 Apple 开发者证书。第一次打开时系统会说「无法验证开发者」：到 **系统设置 → 隐私与安全性**，在底部点「仍要打开」即可，不用命令行。每装一个新版本要点一次；因为每次构建的签名不同，系统授过的权限（比如文件夹访问）更新后可能要重新允许。

## 在 Windows 上运行

需要先装好：

1. Microsoft C++ 生成工具：装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选「使用 C++ 的桌面开发」
2. Rust：下载运行 [rustup-init.exe](https://rustup.rs)，一路默认
3. Node.js 20 或更新版本
4. WebView2：Windows 10 和 11 已经自带，不用另装

然后在项目目录里（PowerShell 或命令提示符）：

```bash
npm install
npm run tauri dev                         # 开发模式
npm run tauri build -- --bundles nsis     # 打包，安装程序在 src-tauri/target/release/bundle/nsis/
```

本机打包出来的应用不带 Pandoc 和 Typst，导出 Word / PDF 时会去系统 PATH 里找（自己装上即可）。
GitHub 上「Actions → 构建 Windows 安装包」打出的安装包已经内置了这两个工具，跑完在页面底部下载。

Windows 版和 Mac 版的区别：

- 窗口没有系统标题栏，最小化、最大化、关闭按钮由应用自己画在右上角；拖动标题栏空白处移动窗口，双击最大化。
- 没有菜单栏。菜单里的命令都在功能区、`Ctrl+K` 命令面板和快捷键里，快捷键把 `⌘` 换成 `Ctrl`、`⌥` 换成 `Alt`。设置在左下角（Mac 上在菜单栏「HolyMark → 设置…」里）。
- 调用 Pandoc、Typst 时不弹出命令行窗口。
- 界面字号都是整数像素，滚动区域有不透明底色，微软雅黑在低分辨率屏上能用 ClearType 渲染，不发虚。
- 默认字体是微软雅黑。文件属性区里写的 Mac 字体（如 `Songti SC`）在 Windows 上会自动用对应的字体（中易宋体）显示，反过来也一样。
- 安装包没有代码签名，第一次运行时 SmartScreen 可能拦一下：点「更多信息 → 仍要运行」。

## 测试

```bash
npx tsc --noEmit                 # 类型检查
npx vitest run                   # 单元测试
cd src-tauri && cargo test --lib # Rust 端（需要 Rust 环境）
```

冒烟测试：打开浏览器预览，依次加载演示稿和一份覆盖所有块类型的测试稿（`tests/fixtures/all-blocks.md`），光标走遍每一行，再打开导出对话框和搜索，浅色、深色各跑一遍。控制台出现任何 error 就判失败。

```bash
npm run dev                                                # 另开一个终端
NODE_PATH=$(npm root -g) node scripts/smoke.mjs            # 需要全局装好 Playwright
```

检查构建产物在内容安全策略（CSP）下是否正常：`npx vite build && npx vite preview`（端口 1421，带上和桌面版相同的 CSP 头），然后 `node scripts/smoke.mjs http://localhost:1421`。

CSP 写在 `src-tauri/tauri.conf.json` 的 `app.security.csp`，每条指令一项。以后要访问新的网站（比如向 doi.org 取文献信息），在 `connect-src` 后面加上域名即可，`vite preview` 会自动用同一份。

## 长稿性能

浏览器预览里加 `?stress` 会生成一篇 20 万字的测试稿并直接打开（`?stress=400000` 指定字数），用来手动试手感。自动测量：

```bash
npm run dev
NODE_PATH=$(npm root -g) node scripts/bench-long-doc.mjs 200000   # 需要 Playwright
```

输出每次按键、每次移动光标的耗时和长任务（超过 50ms）次数。

## 测试

```bash
npm test                          # 前端：切块、字数、批注、大纲、版本对齐、导出选项换算、实时预览增量更新、格式切换、路径与快捷键
cd src-tauri && cargo test --lib  # 后端：文件树、读写、版本库、Word 样式改写
```

导出的端到端测试（真的调用 Pandoc 和 Typst）：

```bash
npx vite-node scripts/export-smoke.ts /tmp/hm-smoke
cd src-tauri && HM_EXPORT_JOB=/tmp/hm-smoke/job-pdf.json cargo test --lib e2e_from_env -- --ignored
```

## 结构

```
src/
  editor/livePreview.ts   实时预览：按块显示源码 / 渲染（CodeMirror 6 装饰，增量更新）
  editor/commands.ts      格式命令：粗体、斜体、删除线按“带格式的字”切换后规范地写回
  editor/cjkEmphasis.ts   中文友好的强调、删除线识别（替换 lezer 的同名解析器）
  lib/markdown.ts         切块、纯文本、字数、批注、大纲、版本对齐与逐字比较
  lib/backend.ts          后端接口：Tauri 里调 Rust，浏览器里用演示数据
  lib/exporting.ts        导出：选项、Markdown 预处理、Word 单位换算、Typst 模板、Pandoc defaults
  lib/exportPreview.ts    导出对话框里的分页预览
  lib/paths.ts            路径（前端一律用正斜杠，兼容 Windows 盘符）
  lib/platform.ts         平台判断、快捷键在 Mac / Windows 上的写法
  lib/shortcuts.ts        没有原生菜单时（Windows）的菜单快捷键
  components/             文件树、功能区、右栏、对照视图、对话框、导出
src-tauri/src/
  fsops.rs                文件树、原子写入
  versions.rs             版本库：按段落内容寻址，存在文件夹的 .holymark/ 里
  export.rs               导出：找 Pandoc / Typst，读取和改写 Word 参考文档的样式，运行导出（分阶段报告进度）
  xml.rs                  改写 docx 用的极简 XML 树
  lib.rs                  Tauri 命令、外部修改监听、双击文件打开（单实例）
src-tauri/tauri.windows.conf.json   Windows 窗口：不要系统标题栏
```

## 数据放在哪

- 稿件：你的文件夹里，原样的 Markdown。
- 想回到没有打开文件夹的开始页：点侧栏顶部的文件夹名 →「关闭文件夹」（菜单「文件 → 关闭文件夹」也行）；设置 → 通用里可以关掉「启动时打开上次的文件夹」。
- 版本：文件夹里的 `.holymark/`。删掉它不影响稿件，只是丢了历史版本。
- 导出配置：`.holymark/export/` 下的 Pandoc defaults 文件（`word.yaml`、`pdf.yaml`）和版式文件（`word-reference.docx`、`pdf-template.typst`），每次导出时更新，命令行里也能直接用：`pandoc -d .holymark/export/word.yaml 稿件.md -o 稿件.docx`。
- 应用设置：应用自己的存储里。

## 路线

- [x] 文件夹与文件树、自动保存
- [x] 实时预览编辑器、浮动工具栏、功能区
- [x] 大纲、批注、字数（含选中字数浮窗）
- [x] 版本库、外部修改记录、整篇对照与恢复
- [x] 设置与本文版式、⌘K 搜索（当前文件与文件夹内 Markdown）
- [x] 导出：Word / PDF / Markdown，全部选项可设置、实时预览，配置保存为 Pandoc defaults 文件
- [ ] 输入 `@` 直接弹出文献与文件列表
- [ ] 粘贴图片自动存入 assets/
- [ ] 全文索引（SQLite FTS5），搜索 Excel、PDF 文字层
