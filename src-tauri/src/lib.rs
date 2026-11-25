//! HolyMark 后端：文件夹、读写、版本库、外部修改监听。
mod fsops;
mod menu;
mod versions;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};
use versions::{Meta, Source, Store};

#[derive(Default)]
struct Inner {
    root: Option<PathBuf>,
    /// 编辑器自己最近写入的内容，用来区分外部修改
    written: HashMap<PathBuf, String>,
    merge_ms: u64,
}

#[derive(Default)]
struct AppState {
    inner: Arc<Mutex<Inner>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// 从 Finder 打开、但前端还没来得及处理的文件
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
                (i.root.clone(), i.written.get(&p).cloned(), i.merge_ms)
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
            inner.lock().unwrap().written.insert(p.clone(), now);
            let _ = handle.emit("external-change", ExternalChange { path: p.to_string_lossy().to_string(), version });
        }
    })
    .map_err(err)?;
    w.watch(&rootp, RecursiveMode::Recursive).map_err(err)?;
    *state.watcher.lock().unwrap() = Some(w);
    Ok(tree)
}

#[tauri::command]
fn list_tree(root: String) -> Result<Vec<fsops::Node>, String> {
    fsops::tree(Path::new(&root)).map_err(err)
}

#[tauri::command]
fn read_text(state: State<AppState>, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let s = fsops::read_text(&p).map_err(err)?;
    state.inner.lock().unwrap().written.insert(p, s.clone());
    Ok(s)
}

#[tauri::command]
fn write_text(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    state.inner.lock().unwrap().written.insert(p.clone(), content.clone());
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

/// 把图片等文件复制进文件夹（默认放在文档旁的 assets/），重名时自动加序号，返回新路径
#[tauri::command]
fn copy_into_folder(src: String, dir: String) -> Result<String, String> {
    let srcp = PathBuf::from(&src);
    let dirp = PathBuf::from(&dir);
    std::fs::create_dir_all(&dirp).map_err(err)?;
    let stem = srcp.file_stem().and_then(|s| s.to_str()).unwrap_or("image").to_string();
    let ext = srcp.extension().and_then(|s| s.to_str()).map(|e| format!(".{}", e)).unwrap_or_default();
    let mut dest = dirp.join(format!("{}{}", stem, ext));
    let mut n = 1;
    while dest.exists() {
        dest = dirp.join(format!("{}-{}{}", stem, n, ext));
        n += 1;
    }
    std::fs::copy(&srcp, &dest).map_err(err)?;
    Ok(dest.to_string_lossy().to_string())
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
    state.inner.lock().unwrap().written.insert(p.clone(), content.clone());
    fsops::write_text(&p, &content).map_err(err)?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
fn take_pending_open(state: State<AppState>) -> Vec<String> {
    std::mem::take(&mut *state.pending_open.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::default();
    let pending = state.pending_open.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            let m = menu::build(app.handle())?;
            app.set_menu(m)?;
            Ok(())
        })
        .on_menu_event(|app, e| {
            let _ = app.emit("menu", e.id().0.clone());
        })
        .invoke_handler(tauri::generate_handler![
            open_folder,
            list_tree,
            read_text,
            write_text,
            save_version,
            list_versions,
            read_version,
            set_merge_window,
            copy_into_folder,
            list_fonts,
            create_file,
            take_pending_open
        ])
        .build(tauri::generate_context!())
        .expect("HolyMark 启动失败");
    app.run(move |handle, event| {
        // 在 Finder 里用 HolyMark 打开 .md 文件
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            for u in urls {
                if let Ok(p) = u.to_file_path() {
                    let p = p.to_string_lossy().to_string();
                    pending.lock().unwrap().push(p.clone());
                    let _ = handle.emit("open-file", p);
                }
            }
        }
        let _ = (&handle, &event, &pending);
    });
}
