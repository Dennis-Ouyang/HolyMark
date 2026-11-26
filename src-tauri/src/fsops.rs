//! 文件夹树、读写文本文件。
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone)]
pub struct Node {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub children: Vec<Node>,
}

/// 隐藏文件、HolyMark 自己的数据目录和常见的大目录不出现在文件树里。
fn skip(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name == "target"
}

/// 交给前端的路径一律用正斜杠。Windows 的 `C:\a\b` 变成 `C:/a/b`（Windows 也认正斜杠）；
/// macOS 和 Linux 上反斜杠是合法的文件名字符，原样保留。
pub fn slash(p: &Path) -> String {
    let s = p.to_string_lossy();
    if cfg!(windows) {
        s.replace('\\', "/")
    } else {
        s.into_owned()
    }
}

pub fn tree(root: &Path) -> std::io::Result<Vec<Node>> {
    let mut out = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(root)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| {
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        (!is_dir, e.file_name().to_string_lossy().to_lowercase())
    });
    for e in entries {
        let name = e.file_name().to_string_lossy().to_string();
        if skip(&name) {
            continue;
        }
        let path = e.path();
        let dir = path.is_dir();
        let children = if dir { tree(&path).unwrap_or_default() } else { Vec::new() };
        out.push(Node { name, path: slash(&path), dir, children });
    }
    Ok(out)
}

/// 目录里不重名的路径：重名时在名字后面加「 2」「 3」……（扩展名保留）
pub fn unique_in(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut p = dir.join(format!("{stem}{ext}"));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{stem} {n}{ext}"));
        n += 1;
    }
    p
}

/// 文件名里不能有的字符（Windows 的规矩最严，按它来）
pub fn valid_name(name: &str) -> Result<(), String> {
    let t = name.trim();
    if t.is_empty() || t == "." || t == ".." {
        return Err("名字不能为空".into());
    }
    if let Some(c) = t.chars().find(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Err(format!("名字里不能有「{c}」"));
    }
    Ok(())
}

/// 只按字面整理路径：去掉 `.`、按 `..` 回退一级。不碰磁盘，所以不存在的路径也能用。
pub fn lexical(p: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                // 不能退到根以上
                if !matches!(out.components().next_back(), None | Some(Component::RootDir) | Some(Component::Prefix(_))) {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 比较用的形式：字面整理后统一斜杠；Windows 和 macOS 的文件系统默认不分大小写，按小写比
fn cmp_form(p: &Path) -> String {
    let s = slash(&lexical(p));
    let s = s.trim_end_matches('/').to_string();
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s
    }
}

/// p 是否在 root 里面（含 root 本身）。路径必须是绝对路径；`..` 绕出去的不算。
/// 先按字面判断；如果 p 或它的上级已经存在，再按真实路径（解开符号链接）判断一次。
pub fn within(root: &Path, p: &Path) -> bool {
    if !p.is_absolute() || !root.is_absolute() {
        return false;
    }
    let (r, q) = (cmp_form(root), cmp_form(p));
    let lexical_ok = q == r || q.starts_with(&format!("{r}/"));
    if !lexical_ok {
        return false;
    }
    // 符号链接可能指向文件夹外面：找到最近一个存在的上级，按真实路径再比一次
    let Ok(real_root) = root.canonicalize() else { return lexical_ok };
    let full = lexical(p);
    let mut probe = full.as_path();
    loop {
        if let Ok(real) = probe.canonicalize() {
            let rest = full.strip_prefix(probe).unwrap_or(Path::new(""));
            let (r, q) = (cmp_form(&real_root), cmp_form(&real.join(rest)));
            return q == r || q.starts_with(&format!("{r}/"));
        }
        match probe.parent() {
            Some(pp) => probe = pp,
            None => return lexical_ok,
        }
    }
}

/// 用默认程序打开时不放行的类型：可执行程序和脚本。文稿里的链接不该一点就启动程序。
pub fn is_executable_like(p: &Path) -> bool {
    const EXEC: &[&str] = &[
        "app", "command", "tool", "terminal", "sh", "bash", "zsh", "csh", "fish", "pkg", "mpkg", "scpt", "applescript", "workflow", "jar",
        "exe", "bat", "cmd", "com", "msi", "msp", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "scr", "pif", "lnk", "reg",
        "cpl", "inf", "url", "desktop", "appimage", "run", "py", "pl", "rb",
    ];
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXEC.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn read_text(path: &Path) -> std::io::Result<String> {
    fs::read_to_string(path)
}

/// 先写临时文件再改名，避免写到一半崩溃留下损坏的稿件。
pub fn write_text(path: &Path, content: &str) -> std::io::Result<()> {
    let tmp: PathBuf = path.with_extension("holymark-tmp");
    fs::write(&tmp, content)?;
    // Windows 上稿件正被别的程序（杀毒软件、同步盘、预览）短暂占用时，改名会失败，稍等重试几次
    let mut tries = 0;
    loop {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied && tries < 10 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_skips_hidden_and_sorts_dirs_first() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("正文")).unwrap();
        fs::create_dir(d.path().join(".holymark")).unwrap();
        fs::write(d.path().join("README.md"), "x").unwrap();
        fs::write(d.path().join("正文/01.md"), "x").unwrap();
        let t = tree(d.path()).unwrap();
        assert_eq!(t.len(), 2);
        assert!(t[0].dir && t[0].name == "正文");
        assert_eq!(t[0].children[0].name, "01.md");
    }

    #[test]
    fn slash_only_rewrites_on_windows() {
        let p = Path::new("a").join("b.md");
        if cfg!(windows) {
            assert_eq!(slash(&p), "a/b.md");
        } else {
            assert_eq!(slash(Path::new("a\\b.md")), "a\\b.md");
            assert_eq!(slash(&p), "a/b.md");
        }
    }

    #[test]
    fn within_checks_folder_bounds() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("稿件");
        fs::create_dir_all(root.join("正文")).unwrap();
        assert!(within(&root, &root));
        assert!(within(&root, &root.join("a.md")));
        assert!(within(&root, &root.join("正文/还没有的.md")));
        assert!(within(&root, &root.join("正文/../b.md")));
        assert!(!within(&root, &root.join("../外面.md")));
        assert!(!within(&root, &root.join("正文/../../外面.md")));
        assert!(!within(&root, &d.path().join("稿件二/a.md")));
        assert!(!within(&root, Path::new("相对路径.md")));
        #[cfg(unix)]
        {
            let outside = d.path().join("外面");
            fs::create_dir(&outside).unwrap();
            std::os::unix::fs::symlink(&outside, root.join("链接")).unwrap();
            assert!(!within(&root, &root.join("链接/a.md")));
        }
    }

    #[test]
    fn lexical_never_climbs_above_root() {
        assert_eq!(lexical(Path::new("/a/b/../../../c")), PathBuf::from("/c"));
        assert_eq!(lexical(Path::new("/a/./b/../c")), PathBuf::from("/a/c"));
    }

    #[test]
    fn executables_are_flagged() {
        assert!(is_executable_like(Path::new("/x/Calculator.app")));
        assert!(is_executable_like(Path::new("C:/x/setup.EXE")));
        assert!(is_executable_like(Path::new("/x/run.command")));
        assert!(!is_executable_like(Path::new("/x/论文.pdf")));
        assert!(!is_executable_like(Path::new("/x/数据.xlsx")));
    }

    #[test]
    fn write_then_read_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        write_text(&p, "# 标题\n\n正文").unwrap();
        assert_eq!(read_text(&p).unwrap(), "# 标题\n\n正文");
        assert!(!p.with_extension("holymark-tmp").exists());
    }
}
