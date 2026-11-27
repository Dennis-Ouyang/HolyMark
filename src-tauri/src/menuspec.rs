//! 按前端命令注册表（src/lib/commandRegistry.ts 的 menuSpec）重建原生菜单。
//! 快捷键在运行时改了以后，前端调用 set_menu 重新生成整个菜单。只在 macOS 上实际挂到应用上
//! （Windows 窗口没有菜单栏）；建菜单的代码不分平台，方便在任何系统上编译和测试。
use serde::Deserialize;
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpecItem {
    pub id: String,
    pub label: String,
    pub accel: Option<String>,
    #[serde(default)]
    pub sep_before: bool,
}

#[derive(Deserialize, Debug, Clone)]
pub struct SpecSection {
    pub key: String,
    pub title: String,
    pub items: Vec<SpecItem>,
}

fn section<R: Runtime>(app: &AppHandle<R>, s: &SpecSection) -> tauri::Result<Submenu<R>> {
    let mut b = SubmenuBuilder::new(app, &s.title);
    for (i, it) in s.items.iter().enumerate() {
        if it.sep_before && i > 0 {
            b = b.separator();
        }
        let mut m = MenuItemBuilder::with_id(it.id.clone(), it.label.clone());
        if let Some(a) = &it.accel {
            m = m.accelerator(a);
        }
        b = b.item(&m.build(app)?);
        // 编辑菜单：撤销、重做后面接系统的剪切、拷贝、粘贴、全选
        if s.key == "edit" && it.id == "redo" {
            b = b
                .separator()
                .item(&PredefinedMenuItem::cut(app, Some("剪切"))?)
                .item(&PredefinedMenuItem::copy(app, Some("拷贝"))?)
                .item(&PredefinedMenuItem::paste(app, Some("粘贴"))?)
                .item(&PredefinedMenuItem::select_all(app, Some("全选"))?);
        }
    }
    match s.key.as_str() {
        "file" => b = b.separator().item(&PredefinedMenuItem::close_window(app, Some("关闭窗口"))?),
        "view" => b = b.separator().item(&PredefinedMenuItem::fullscreen(app, Some("进入全屏"))?),
        _ => {}
    }
    b.build()
}

pub fn build_from<R: Runtime>(app: &AppHandle<R>, sections: &[SpecSection], settings_accel: Option<&str>) -> tauri::Result<Menu<R>> {
    let mut settings = MenuItemBuilder::with_id("settings", "设置…");
    if let Some(a) = settings_accel {
        settings = settings.accelerator(a);
    }
    let app_menu = SubmenuBuilder::new(app, "HolyMark")
        .item(&PredefinedMenuItem::about(app, Some("关于 HolyMark"), None)?)
        .separator()
        .item(&settings.build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("服务"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("隐藏 HolyMark"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("全部显示"))?)
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "退出 HolyMark").accelerator("CmdOrCtrl+Q").build(app)?)
        .build()?;
    let mut subs: Vec<Submenu<R>> = vec![app_menu];
    for s in sections {
        if s.items.is_empty() {
            continue;
        }
        if s.key == "help" {
            // 「窗口」放在「帮助」前面，和系统习惯一致
            subs.push(
                SubmenuBuilder::new(app, "窗口")
                    .item(&PredefinedMenuItem::minimize(app, Some("最小化"))?)
                    .item(&PredefinedMenuItem::maximize(app, Some("缩放"))?)
                    .build()?,
            );
        }
        subs.push(section(app, s)?);
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = subs.iter().map(|s| s as &dyn tauri::menu::IsMenuItem<R>).collect();
    Menu::with_items(app, &refs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_parses_from_frontend_json() {
        let json = r#"[{"key":"file","title":"文件","items":[{"id":"new_file","label":"新建文稿","accel":"CmdOrCtrl+N","sepBefore":false},{"id":"export","label":"导出…","accel":null,"sepBefore":true}]}]"#;
        let v: Vec<SpecSection> = serde_json::from_str(json).unwrap();
        assert_eq!(v[0].items[0].accel.as_deref(), Some("CmdOrCtrl+N"));
        assert!(v[0].items[1].sep_before);
    }
}
