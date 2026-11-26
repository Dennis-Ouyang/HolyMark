//! 中文原生菜单。菜单项的 id 原样发给前端（事件名 "menu"），由前端执行对应动作。
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, label);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "HolyMark")
        .item(&PredefinedMenuItem::about(app, Some("关于 HolyMark"), None)?)
        .separator()
        .item(&item("settings", "设置…", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("服务"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("隐藏 HolyMark"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("全部显示"))?)
        .separator()
        // 退出交给前端：有没保存的修改时先问一声，再关窗口（最后一个窗口关掉应用就退出）
        .item(&item("quit", "退出 HolyMark", Some("CmdOrCtrl+Q"))?)
        .build()?;

    let file = SubmenuBuilder::new(app, "文件")
        .item(&item("new_file", "新建文稿", Some("CmdOrCtrl+N"))?)
        .item(&item("open_folder", "打开文件夹…", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item("save_version", "保存版本…", Some("CmdOrCtrl+S"))?)
        .item(&item("export", "导出…", Some("CmdOrCtrl+Shift+E"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, Some("关闭窗口"))?)
        .build()?;

    // 撤销、重做交给编辑器自己的历史；剪切、复制、粘贴用系统的
    let edit = SubmenuBuilder::new(app, "编辑")
        .item(&item("undo", "撤销", Some("CmdOrCtrl+Z"))?)
        .item(&item("redo", "重做", Some("CmdOrCtrl+Shift+Z"))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("剪切"))?)
        .item(&PredefinedMenuItem::copy(app, Some("拷贝"))?)
        .item(&PredefinedMenuItem::paste(app, Some("粘贴"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("全选"))?)
        .separator()
        .item(&item("find", "查找…", Some("CmdOrCtrl+F"))?)
        .item(&item("search", "在文件夹中搜索…", Some("CmdOrCtrl+K"))?)
        .build()?;

    let para = SubmenuBuilder::new(app, "段落")
        .item(&item("block_p", "正文", Some("CmdOrCtrl+0"))?)
        .item(&item("block_h1", "标题 1", Some("CmdOrCtrl+1"))?)
        .item(&item("block_h2", "标题 2", Some("CmdOrCtrl+2"))?)
        .item(&item("block_h3", "标题 3", Some("CmdOrCtrl+3"))?)
        .item(&item("block_h4", "标题 4", Some("CmdOrCtrl+4"))?)
        .item(&item("block_h5", "标题 5", Some("CmdOrCtrl+5"))?)
        .item(&item("block_h6", "标题 6", Some("CmdOrCtrl+6"))?)
        .item(&item("heading_up", "提升标题级别", Some("CmdOrCtrl+="))?)
        .item(&item("heading_down", "降低标题级别", Some("CmdOrCtrl+-"))?)
        .separator()
        .item(&item("block_quote", "引用", Some("CmdOrCtrl+Shift+."))?)
        .item(&item("block_ul", "无序列表", Some("CmdOrCtrl+Shift+8"))?)
        .item(&item("block_ol", "有序列表", Some("CmdOrCtrl+Shift+7"))?)
        .item(&item("block_task", "待办列表", Some("CmdOrCtrl+Shift+9"))?)
        .item(&item("indent", "增加缩进", Some("CmdOrCtrl+]"))?)
        .item(&item("outdent", "减少缩进", Some("CmdOrCtrl+["))?)
        .separator()
        .item(&item("insert_table", "插入表格", None)?)
        .item(&item("insert_code", "插入代码块", Some("CmdOrCtrl+Alt+C"))?)
        .item(&item("insert_math", "插入公式块", Some("CmdOrCtrl+Alt+B"))?)
        .item(&item("insert_mermaid", "插入图表", None)?)
        .item(&item("insert_image", "插入图片…", Some("CmdOrCtrl+Shift+I"))?)
        .item(&item("insert_hr", "插入分隔线", None)?)
        .build()?;

    let format = SubmenuBuilder::new(app, "格式")
        .item(&item("bold", "粗体", Some("CmdOrCtrl+B"))?)
        .item(&item("italic", "斜体", Some("CmdOrCtrl+I"))?)
        .item(&item("strike", "删除线", Some("CmdOrCtrl+Shift+X"))?)
        .item(&item("code", "行内代码", Some("CmdOrCtrl+E"))?)
        .item(&item("math", "行内公式", Some("CmdOrCtrl+Shift+M"))?)
        .item(&item("highlight", "高亮", Some("CmdOrCtrl+Shift+H"))?)
        .item(&item("sup", "上标", None)?)
        .item(&item("sub", "下标", None)?)
        .item(&item("link", "链接", Some("CmdOrCtrl+Shift+K"))?)
        .separator()
        .item(&item("cite", "引用文献或文件…", Some("CmdOrCtrl+Shift+C"))?)
        .item(&item("note", "添加批注", Some("CmdOrCtrl+Alt+M"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "显示")
        .item(&item("toggle_side", "显示 / 隐藏侧栏", Some("CmdOrCtrl+\\"))?)
        .item(&item("toggle_panel", "显示 / 隐藏右栏", Some("CmdOrCtrl+/"))?)
        .item(&item("toggle_ribbon", "折叠 / 展开功能区", Some("CmdOrCtrl+Alt+R"))?)
        .item(&item("focus", "专注模式", Some("CmdOrCtrl+Shift+F"))?)
        .separator()
        .item(&item("panel_outline", "大纲", Some("CmdOrCtrl+Alt+1"))?)
        .item(&item("panel_notes", "批注", Some("CmdOrCtrl+Alt+2"))?)
        .item(&item("panel_versions", "版本", Some("CmdOrCtrl+Alt+3"))?)
        .separator()
        .item(&item("toggle_syntax", "始终显示 Markdown 语法", None)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, Some("进入全屏"))?)
        .build()?;

    let window = SubmenuBuilder::new(app, "窗口")
        .item(&PredefinedMenuItem::minimize(app, Some("最小化"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("缩放"))?)
        .build()?;

    let help = SubmenuBuilder::new(app, "帮助")
        .item(&item("help_syntax", "Markdown 语法速查", None)?)
        .item(&item("help_keys", "快捷键", None)?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &para, &format, &view, &window, &help])
}
