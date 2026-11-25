# HolyMark

面向长篇中文写作的本地 Markdown 编辑器。打开一个文件夹就开始写，稿件就是普通的 `.md` 文件。

- **实时预览**：光标所在的块显示 Markdown 源码，其余部分按格式渲染。支持标题、强调、列表、任务列表、引用、表格、代码块（高亮）、LaTeX 公式、Mermaid 图表、图片、文献引用 `[@key]`、批注。
- **浮动工具栏与功能区**：选中文字出现格式栏；编辑区上方的功能区可折叠，分「开始」「插入」「本文版式」。
- **版本**：自动保存；`⌘S` 保存带名字的版本；文件被外部程序（比如 Claude Code）改写时自动记一个版本。点开任意版本与现在整篇对照，红删绿增，可以恢复。
- **批注**：用 CriticMarkup 写在文件里：`{==原文==}{>>@作者 日期：内容<<}`，AI 读得到，换编辑器也不丢。
- **设置分两层**：`⌘,` 是所有文件的默认值；「本文版式」写进文件开头的 YAML 属性区，只对这一篇生效。
- **导出**：`⌘⇧E` 导出 Word、PDF、Markdown。纸张、页边距、页眉页脚、中西文字体、字号、行距、缩进、各级标题和编号都能设，右边实时预览；可以选一个 Word 文件作参考文档，读取它的样式。Word 和 PDF 由内置的 Pandoc 和 Typst 生成，不用另装。

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
- 没有菜单栏。菜单里的命令都在功能区、`Ctrl+K` 命令面板和快捷键里，快捷键把 `⌘` 换成 `Ctrl`、`⌥` 换成 `Alt`。
- 默认字体是微软雅黑。文件属性区里写的 Mac 字体（如 `Songti SC`）在 Windows 上会自动用对应的字体（中易宋体）显示，反过来也一样。
- 安装包没有代码签名，第一次运行时 SmartScreen 可能拦一下：点「更多信息 → 仍要运行」。

## 长稿性能

浏览器预览里加 `?stress` 会生成一篇 20 万字的测试稿并直接打开（`?stress=400000` 指定字数），用来手动试手感。自动测量：

```bash
npm run dev
NODE_PATH=$(npm root -g) node scripts/bench-long-doc.mjs 200000   # 需要 Playwright
```

输出每次按键、每次移动光标的耗时和长任务（超过 50ms）次数。

## 测试

```bash
npm test                          # 前端：切块、字数、批注、大纲、版本对齐、导出选项换算、实时预览增量更新、路径与快捷键
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
  editor/commands.ts      格式命令（加减 Markdown 符号）
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
  export.rs               导出：找 Pandoc / Typst，改写 Word 参考文档，运行导出
  xml.rs                  改写 docx 用的极简 XML 树
  lib.rs                  Tauri 命令、外部修改监听、双击文件打开（单实例）
src-tauri/tauri.windows.conf.json   Windows 窗口：不要系统标题栏
```

## 数据放在哪

- 稿件：你的文件夹里，原样的 Markdown。
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
