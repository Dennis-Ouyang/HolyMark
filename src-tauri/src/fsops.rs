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
        out.push(Node { name, path: path.to_string_lossy().to_string(), dir, children });
    }
    Ok(out)
}

pub fn read_text(path: &Path) -> std::io::Result<String> {
    fs::read_to_string(path)
}

/// 先写临时文件再改名，避免写到一半崩溃留下损坏的稿件。
pub fn write_text(path: &Path, content: &str) -> std::io::Result<()> {
    let tmp: PathBuf = path.with_extension("holymark-tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)
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
    fn write_then_read_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        write_text(&p, "# 标题\n\n正文").unwrap();
        assert_eq!(read_text(&p).unwrap(), "# 标题\n\n正文");
        assert!(!p.with_extension("holymark-tmp").exists());
    }
}
