//! HolyMark 后端：文件夹、读写、版本库、外部修改监听。
mod export;
mod fsops;
mod preview;
#[cfg(target_os = "macos")]
mod menu;
mod versions;
mod xml;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};
use fsops::slash;
use versions::{Meta, Source, Store};

#[derive(Default)]
struct Inner {
    root: Option<PathBuf>,
    /// 编辑器自己最近写入的内容，用来区分外部修改。键用 key() 统一过斜杠方向
    written: HashMap<String, String>,
    merge_ms: u64,
}

#[derive(Default)]
struct AppState {
    inner: Arc<Mutex<Inner>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// 从访达 / 资源管理器打开、但前端还没来得及处理的文件
    pending_open: Arc<Mutex<Vec<String>>>,
    fonts: Mutex<Option<Vec<FontFamily>>>,
}

#[derive(Serialize, Clone)]
struct FontFamily {
    /// CSS 里用的名字
    name: String,
    /// 给用户看的名字（有中文名时用中文名）
    display: String,
    /// 是否包含中文字形
    cjk: bool,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// written 表的键：同一个文件不管前端传来的是 C:/a/b.md，还是文件监听给的 C:\\a\\b.md，都对得上
fn key(p: &Path) -> String {
    slash(p)
}

fn rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

#[derive(Serialize, Clone)]
struct ExternalChange {
    path: String,
    version: Option<Meta>,
}

#[tauri::command]
fn open_folder(app: tauri::AppHandle, state: State<AppState>, root: String) -> Result<Vec<fsops::Node>, String> {
    let rootp = PathBuf::from(&root);
    let tree = fsops::tree(&rootp).map_err(err)?;
    {
        let r = rootp.clone();
        std::thread::spawn(move || purge_staged(&r));
    }
    {
        let mut i = state.inner.lock().unwrap();
        i.root = Some(rootp.clone());
        i.written.clear();
        if i.merge_ms == 0 {
            i.merge_ms = 5000;
        }
    }
    let inner = state.inner.clone();
    let handle = app.clone();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(ev) = res else { return };
        if !(ev.kind.is_modify() || ev.kind.is_create()) {
            return;
        }
        for p in ev.paths {
            if p.extension().and_then(|e| e.to_str()) != Some("md") || p.components().any(|c| c.as_os_str() == ".holymark") {
                continue;
            }
            let Ok(now) = std::fs::read_to_string(&p) else { continue };
            let (root, prev, merge) = {
                let i = inner.lock().unwrap();
                (i.root.clone(), i.written.get(&key(&p)).cloned(), i.merge_ms)
            };
            let Some(root) = root else { continue };
            if prev.as_deref() == Some(now.as_str()) {
                continue; // 编辑器自己写的
            }
            let store = Store::new(&root);
            let file = rel(&root, &p);
            // 外部写入前，编辑器里最后保存的状态先留一个自动版本，保证能回到改动前
            if let Some(prev) = prev {
                let _ = store.save(&file, &prev, Source::Auto, None, None, merge);
            }
            let version = store.save(&file, &now, Source::External, None, None, merge).ok().flatten();
            inner.lock().unwrap().written.insert(key(&p), now);
            let _ = handle.emit("external-change", ExternalChange { path: slash(&p), version });
        }
    })
    .map_err(err)?;
    w.watch(&rootp, RecursiveMode::Recursive).map_err(err)?;
    *state.watcher.lock().unwrap() = Some(w);
    Ok(tree)
}

/// 关闭文件夹：停止监听，回到没有打开工作区的状态
#[tauri::command]
fn close_folder(state: State<AppState>) {
    *state.watcher.lock().unwrap() = None;
    let mut i = state.inner.lock().unwrap();
    i.root = None;
    i.written.clear();
}

#[tauri::command]
fn list_tree(root: String) -> Result<Vec<fsops::Node>, String> {
    fsops::tree(Path::new(&root)).map_err(err)
}

#[tauri::command]
fn read_text(state: State<AppState>, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let s = fsops::read_text(&p).map_err(err)?;
    state.inner.lock().unwrap().written.insert(key(&p), s.clone());
    Ok(s)
}

#[tauri::command]
fn write_text(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    state.inner.lock().unwrap().written.insert(key(&p), content.clone());
    fsops::write_text(&p, &content).map_err(err)
}

fn store_for(state: &State<AppState>, path: &str) -> Result<(Store, String, u64), String> {
    let i = state.inner.lock().unwrap();
    let root = i.root.clone().ok_or("还没有打开文件夹")?;
    Ok((Store::new(&root), rel(&root, Path::new(path)), i.merge_ms))
}

#[tauri::command]
fn save_version(
    state: State<AppState>,
    path: String,
    content: String,
    source: Source,
    name: Option<String>,
    note: Option<String>,
) -> Result<Option<Meta>, String> {
    let (store, file, merge) = store_for(&state, &path)?;
    store.save(&file, &content, source, name, note, merge).map_err(err)
}

#[tauri::command]
fn list_versions(state: State<AppState>, path: String) -> Result<Vec<Meta>, String> {
    let (store, file, _) = store_for(&state, &path)?;
    Ok(store.records(&file).iter().rev().map(Meta::from).collect())
}

#[tauri::command]
fn read_version(state: State<AppState>, path: String, id: String) -> Result<String, String> {
    let (store, file, _) = store_for(&state, &path)?;
    let recs = store.records(&file);
    let r = recs.iter().find(|r| r.id == id).ok_or("找不到这个版本")?;
    store.content(r).map_err(err)
}

/// 目录里不重名的文件路径：重名时加 -1、-2…
fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut dest = dir.join(format!("{}{}", stem, ext));
    let mut n = 1;
    while dest.exists() {
        dest = dir.join(format!("{}-{}{}", stem, n, ext));
        n += 1;
    }
    dest
}

/// 把图片等文件复制进文件夹（默认放在文档旁的 assets/），返回新路径
#[tauri::command]
fn copy_into_folder(src: String, dir: String) -> Result<String, String> {
    let srcp = PathBuf::from(&src);
    let dirp = PathBuf::from(&dir);
    std::fs::create_dir_all(&dirp).map_err(err)?;
    let stem = srcp.file_stem().and_then(|s| s.to_str()).unwrap_or("image").to_string();
    let ext = srcp.extension().and_then(|s| s.to_str()).map(|e| format!(".{}", e)).unwrap_or_default();
    let dest = unique_path(&dirp, &stem, &ext);
    std::fs::copy(&srcp, &dest).map_err(err)?;
    Ok(slash(&dest))
}

/// 保存粘贴或拖进来的图片（base64），返回新路径
#[tauri::command]
fn save_image(dir: String, name: String, data: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(err)?;
    let dirp = PathBuf::from(&dir);
    std::fs::create_dir_all(&dirp).map_err(err)?;
    let np = Path::new(&name);
    let stem = np.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let ext = np.extension().and_then(|s| s.to_str()).map(|e| format!(".{}", e)).unwrap_or_else(|| ".png".into());
    let dest = unique_path(&dirp, stem, &ext);
    std::fs::write(&dest, bytes).map_err(err)?;
    Ok(slash(&dest))
}

#[tauri::command]
fn set_merge_window(state: State<AppState>, secs: u64) {
    state.inner.lock().unwrap().merge_ms = secs.max(1) * 1000;
}

/// 列出系统里装的字体家族。结果缓存，第一次调用大约需要几百毫秒。
#[tauri::command]
fn list_fonts(state: State<AppState>) -> Vec<FontFamily> {
    let mut cache = state.fonts.lock().unwrap();
    if let Some(f) = cache.as_ref() {
        return f.clone();
    }
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut map: std::collections::BTreeMap<String, FontFamily> = Default::default();
    for face in db.faces() {
        let Some((en, _)) = face.families.first() else { continue };
        if en.starts_with('.') {
            continue; // 系统内部字体
        }
        let zh = face.families.iter().find(|(_, l)| format!("{:?}", l).starts_with("Chinese")).map(|(n, _)| n.clone());
        let entry = map.entry(en.clone()).or_insert_with(|| FontFamily { name: en.clone(), display: en.clone(), cjk: false });
        if let Some(z) = zh {
            entry.display = z;
            entry.cjk = true;
        }
        if !entry.cjk && face.families.iter().any(|(n, _)| n.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))) {
            entry.cjk = true;
        }
    }
    let mut list: Vec<FontFamily> = map.into_values().collect();
    list.sort_by(|a, b| b.cjk.cmp(&a.cjk).then(a.display.cmp(&b.display)));
    *cache = Some(list.clone());
    list
}

/// 在指定目录新建一个不重名的 Markdown 文件，返回路径
#[tauri::command]
fn create_file(state: State<AppState>, dir: String, base: String) -> Result<String, String> {
    let d = PathBuf::from(&dir);
    let mut p = d.join(format!("{}.md", base));
    let mut n = 2;
    while p.exists() {
        p = d.join(format!("{} {}.md", base, n));
        n += 1;
    }
    let title = p.file_stem().and_then(|s| s.to_str()).unwrap_or("未命名").to_string();
    let content = format!("# {}\n\n", title);
    state.inner.lock().unwrap().written.insert(key(&p), content.clone());
    fsops::write_text(&p, &content).map_err(err)?;
    Ok(slash(&p))
}

/* ---------- 文件管理：新建文件夹、改名、副本、移动、删除到废纸篓 ---------- */

/// 改名或移动之后：版本历史跟着搬，编辑器写入记录的键也换成新路径
fn after_move(state: &State<AppState>, from: &Path, to: &Path) {
    let mut i = state.inner.lock().unwrap();
    let moved: Vec<(String, String)> = i
        .written
        .keys()
        .filter_map(|k| {
            let rest = PathBuf::from(k).strip_prefix(from).ok()?.to_path_buf();
            Some((k.clone(), if rest.as_os_str().is_empty() { key(to) } else { key(&to.join(rest)) }))
        })
        .collect();
    for (old, new) in moved {
        if let Some(v) = i.written.remove(&old) {
            i.written.insert(new, v);
        }
    }
    if let Some(root) = i.root.clone() {
        if from.starts_with(&root) && to.starts_with(&root) {
            let _ = Store::new(&root).rename(&rel(&root, from), &rel(&root, to));
        }
    }
}

#[tauri::command]
fn create_dir(dir: String, base: String) -> Result<String, String> {
    let p = fsops::unique_in(Path::new(&dir), &base, "");
    std::fs::create_dir_all(&p).map_err(err)?;
    Ok(slash(&p))
}

#[tauri::command]
fn rename_path(state: State<AppState>, path: String, name: String) -> Result<String, String> {
    fsops::valid_name(&name)?;
    let from = PathBuf::from(&path);
    let to = from.parent().ok_or("没有上一级文件夹")?.join(name.trim());
    if to == from {
        return Ok(path);
    }
    // 只改大小写时（macOS、Windows 上同一个文件）允许
    if to.exists() && to.to_string_lossy().to_lowercase() != from.to_string_lossy().to_lowercase() {
        return Err(format!("已经有一个叫「{}」的文件了", name.trim()));
    }
    std::fs::rename(&from, &to).map_err(err)?;
    after_move(&state, &from, &to);
    Ok(slash(&to))
}

#[tauri::command]
fn duplicate_path(path: String) -> Result<String, String> {
    let from = PathBuf::from(&path);
    if from.is_dir() {
        return Err("文件夹不能直接创建副本".into());
    }
    let stem = from.file_stem().and_then(|s| s.to_str()).unwrap_or("副本");
    let ext = from.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    let to = fsops::unique_in(from.parent().ok_or("没有上一级文件夹")?, &format!("{stem} 副本"), &ext);
    std::fs::copy(&from, &to).map_err(err)?;
    Ok(slash(&to))
}

#[tauri::command]
fn move_path(state: State<AppState>, path: String, dir: String) -> Result<String, String> {
    let from = PathBuf::from(&path);
    let dest = PathBuf::from(&dir);
    if dest.starts_with(&from) {
        return Err("不能把文件夹移到它自己里面".into());
    }
    let name = from.file_name().ok_or("路径不对")?;
    let to = dest.join(name);
    if to == from {
        return Ok(path);
    }
    if to.exists() {
        return Err(format!("「{}」里已经有同名的文件了", dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
    }
    std::fs::rename(&from, &to).map_err(err)?;
    after_move(&state, &from, &to);
    Ok(slash(&to))
}

/// 移到废纸篓（Windows 是回收站），可以从那里找回来
#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| format!("没能移到废纸篓：{e}"))
}

/* 删除可以撤销：先挪到文件夹里的 .holymark/trash/<时间>/ 暂存，提示条消失后再移到废纸篓；撤销就挪回原处。
   macOS 的废纸篓不能用程序恢复，所以不直接丢进去。 */

/// 暂存要删除的文件或文件夹，返回暂存后的路径
#[tauri::command]
fn stage_delete(state: State<AppState>, path: String) -> Result<String, String> {
    let root = state.inner.lock().unwrap().root.clone().ok_or("还没有打开文件夹")?;
    let from = PathBuf::from(&path);
    let name = from.file_name().ok_or("路径不对")?;
    let hold = root.join(".holymark").join("trash").join(versions::now_ms().to_string());
    std::fs::create_dir_all(&hold).map_err(err)?;
    let to = hold.join(name);
    std::fs::rename(&from, &to).map_err(err)?;
    Ok(slash(&to))
}

/// 撤销删除：挪回原处
#[tauri::command]
fn restore_staged(staged: String, original: String) -> Result<(), String> {
    let to = PathBuf::from(&original);
    if to.exists() {
        return Err("原来的位置已经有同名的文件了".into());
    }
    let from = PathBuf::from(&staged);
    std::fs::rename(&from, &to).map_err(err)?;
    if let Some(d) = from.parent() {
        let _ = std::fs::remove_dir(d);
    }
    Ok(())
}

/// 真正删除暂存的文件：移到废纸篓，再清掉暂存用的空文件夹
#[tauri::command]
fn commit_staged(staged: String) -> Result<(), String> {
    let p = PathBuf::from(&staged);
    if p.exists() {
        trash::delete(&p).map_err(|e| format!("没能移到废纸篓：{e}"))?;
    }
    if let Some(d) = p.parent() {
        let _ = std::fs::remove_dir(d);
    }
    Ok(())
}

/// 上次没来得及处理的暂存（比如应用被强行关掉），打开文件夹时移到废纸篓
fn purge_staged(root: &Path) {
    let dir = root.join(".holymark").join("trash");
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    for e in entries.filter_map(|e| e.ok()) {
        if let Ok(kids) = std::fs::read_dir(e.path()) {
            for k in kids.filter_map(|k| k.ok()) {
                let _ = trash::delete(k.path());
            }
        }
        let _ = std::fs::remove_dir(e.path());
    }
}

#[derive(Serialize)]
struct ExportTools {
    pandoc: Option<export::Tool>,
    typst: Option<export::Tool>,
}

/// 导出要用的 Pandoc、Typst 在不在、是什么版本
#[tauri::command]
async fn export_tools() -> ExportTools {
    ExportTools { pandoc: export::tool_info("pandoc"), typst: export::tool_info("typst") }
}

/// 导出过程中每进入一个阶段发一次 "export-progress"，前端据此显示进度
#[tauri::command]
async fn export_run(app: tauri::AppHandle, job: export::ExportJob) -> Result<export::ExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || export::run(job, &|stage| {
        let _ = app.emit("export-progress", stage.to_string());
    }))
    .await
    .map_err(err)?
}

/// 读参考文档（.docx / .dotx）里的样式，填进导出选项
#[tauri::command]
fn read_reference(path: String) -> Result<export::RefStyles, String> {
    export::read_reference(Path::new(&path))
}

#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    export::reveal(&path)
}

/// 文件预览卡片要画的内容（标题、开头几段、页数、修改时间）
#[tauri::command]
async fn file_preview(path: String) -> Result<preview::FilePreview, String> {
    tauri::async_runtime::spawn_blocking(move || preview::preview(Path::new(&path))).await.map_err(err)?
}

/// 用默认程序打开（导出完成后的「打开」）
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    export::open_path(&path)
}

/// 用系统浏览器打开网页（阅读模式里单击链接）。只接受 http、https、mailto，别的协议不打开
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
        return Err("只能打开网页链接".into());
    }
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("explorer").arg(&url).spawn();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let r = std::process::Command::new("xdg-open").arg(&url).spawn();
    r.map(|_| ()).map_err(err)
}

#[tauri::command]
fn take_pending_open(state: State<AppState>) -> Vec<String> {
    std::mem::take(&mut *state.pending_open.lock().unwrap())
}

/// 命令行参数里的 Markdown 文件（Windows 上双击 .md、或「打开方式」选 HolyMark 时，文件路径从这里传进来）
#[cfg(not(target_os = "macos"))]
fn md_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(a))
        .filter(|p| p.is_file() && matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("md" | "markdown")))
        .map(|p| slash(&p))
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::default();
    let pending = state.pending_open.clone();
    #[cfg(not(target_os = "macos"))]
    if let Ok(cwd) = std::env::current_dir() {
        let args: Vec<String> = std::env::args().collect();
        pending.lock().unwrap().extend(md_args(&args, &cwd));
    }
    let builder = tauri::Builder::default();
    // 只开一个窗口：应用已经在运行时再双击 .md，交给已有的窗口打开（单实例插件必须最先注册）
    #[cfg(not(target_os = "macos"))]
    let builder = {
        let pending = pending.clone();
        builder.plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {
            use tauri::Manager;
            let files = md_args(&args, Path::new(&cwd));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if !files.is_empty() {
                pending.lock().unwrap().extend(files.iter().cloned());
                let _ = app.emit("open-file", files.last().cloned());
            }
        }))
    };
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            // macOS 用原生菜单栏；Windows 上窗口没有系统标题栏，菜单里的命令在功能区、⌘K 和快捷键里都有
            #[cfg(target_os = "macos")]
            {
                let m = menu::build(app.handle())?;
                app.set_menu(m)?;
            }
            let _ = app;
            Ok(())
        })
        .on_menu_event(|app, e| {
            let _ = app.emit("menu", e.id().0.clone());
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            close_folder,
            file_preview,
            list_tree,
            read_text,
            write_text,
            save_version,
            list_versions,
            read_version,
            set_merge_window,
            copy_into_folder,
            save_image,
            list_fonts,
            create_file,
            take_pending_open,
            export_tools,
            export_run,
            read_reference,
            reveal,
            open_path,
            open_url,
            create_dir,
            rename_path,
            duplicate_path,
            move_path,
            trash_path,
            stage_delete,
            restore_staged,
            commit_staged
        ])
        .build(tauri::generate_context!())
        .expect("HolyMark 启动失败");
    app.run(move |handle, event| {
        // 在访达里用 HolyMark 打开 .md 文件
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            for u in urls {
                if let Ok(p) = u.to_file_path() {
                    let p = slash(&p);
                    pending.lock().unwrap().push(p.clone());
                    let _ = handle.emit("open-file", p);
                }
            }
        }
        let _ = (&handle, &event, &pending);
    });
}
