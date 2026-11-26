//! 版本库：按段落内容寻址存储。
//!
//! 目录结构（都在用户的文件夹里）：
//!   .holymark/objects/<sha256>          每个段落块的原文，相同内容只存一次
//!   .holymark/versions/<文件路径哈希>.jsonl  每行一个版本记录，只记块哈希列表
//!
//! 块切分是无损的：每块包含它后面的空行，按顺序拼接即可还原原文。
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Saved,
    External,
    Auto,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Record {
    pub id: String,
    pub file: String,
    pub at: u64,
    pub source: Source,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub blocks: Vec<String>,
}

/// 发给前端的版本信息，不带块列表。
#[derive(Serialize, Debug, Clone)]
pub struct Meta {
    pub id: String,
    pub at: u64,
    pub source: Source,
    pub name: Option<String>,
    pub note: Option<String>,
}

impl From<&Record> for Meta {
    fn from(r: &Record) -> Self {
        Meta { id: r.id.clone(), at: r.at, source: r.source.clone(), name: r.name.clone(), note: r.note.clone() }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn sha(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

/// 按空行切块，但代码块（```）和公式块（$$）内部的空行不切。
pub fn split_blocks(text: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut cur = String::new();
    let mut fence: Option<&str> = None;
    let mut trailing_blank = false;
    for line in text.split_inclusive('\n') {
        let t = line.trim_end_matches(['\n', '\r']);
        let trimmed = t.trim_start();
        let blank = t.trim().is_empty();
        if fence.is_none() && !blank && trailing_blank && !cur.is_empty() {
            blocks.push(std::mem::take(&mut cur));
        }
        cur.push_str(line);
        if let Some(f) = fence {
            if trimmed.starts_with(f) && cur.lines().count() > 1 {
                fence = None;
            }
            trailing_blank = false;
            continue;
        }
        if trimmed.starts_with("```") {
            fence = Some("```");
        } else if trimmed.starts_with("$$") && trimmed.trim() == "$$" {
            fence = Some("$$");
        }
        trailing_blank = blank;
    }
    if !cur.is_empty() {
        blocks.push(cur);
    }
    blocks
}

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(root: &Path) -> Self {
        Store { dir: root.join(".holymark") }
    }

    fn log_path(&self, file: &str) -> PathBuf {
        self.dir.join("versions").join(format!("{}.jsonl", &sha(file)[..16]))
    }

    pub fn records(&self, file: &str) -> Vec<Record> {
        fs::read_to_string(self.log_path(file))
            .map(|s| s.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
            .unwrap_or_default()
    }

    fn write_records(&self, file: &str, recs: &[Record]) -> std::io::Result<()> {
        let mut s = String::new();
        for r in recs {
            s.push_str(&serde_json::to_string(r).unwrap());
            s.push('\n');
        }
        fs::write(self.log_path(file), s)
    }

    /// 文件或文件夹改名、移动后，把它（文件夹时是里面所有文件）的版本记录跟着搬过去。
    /// 记录文件名是路径的哈希，没法直接按前缀找，所以挨个读一下每个记录文件的第一条。
    pub fn rename(&self, from: &str, to: &str) -> std::io::Result<usize> {
        let dir = self.dir.join("versions");
        let Ok(entries) = fs::read_dir(&dir) else { return Ok(0) };
        let prefix = format!("{from}/");
        let mut moved = 0;
        for e in entries.filter_map(|e| e.ok()) {
            let Ok(text) = fs::read_to_string(e.path()) else { continue };
            let mut recs: Vec<Record> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
            let Some(file) = recs.first().map(|r| r.file.clone()) else { continue };
            let new = if file == from { to.to_string() } else if let Some(rest) = file.strip_prefix(&prefix) { format!("{to}/{rest}") } else { continue };
            for r in &mut recs {
                r.file = new.clone();
            }
            self.write_records(&new, &recs)?;
            if self.log_path(&new) != e.path() {
                fs::remove_file(e.path())?;
            }
            moved += 1;
        }
        Ok(moved)
    }

    pub fn content(&self, rec: &Record) -> std::io::Result<String> {
        let mut out = String::new();
        for h in &rec.blocks {
            out.push_str(&fs::read_to_string(self.dir.join("objects").join(h))?);
        }
        Ok(out)
    }

    #[allow(dead_code)]
    pub fn latest_content(&self, file: &str) -> Option<String> {
        self.records(file).last().and_then(|r| self.content(r).ok())
    }

    /// 存一个版本。内容和上一个版本相同时，只有“你保存的”会照样记录（相当于给当前状态起名）。
    /// 外部修改在 merge_ms 内连续发生时合并成一条。
    pub fn save(
        &self,
        file: &str,
        content: &str,
        source: Source,
        name: Option<String>,
        note: Option<String>,
        merge_ms: u64,
    ) -> std::io::Result<Option<Meta>> {
        fs::create_dir_all(self.dir.join("objects"))?;
        fs::create_dir_all(self.dir.join("versions"))?;
        let mut recs = self.records(file);
        if source != Source::Saved {
            if let Some(last) = recs.last() {
                if self.content(last).ok().as_deref() == Some(content) {
                    return Ok(None);
                }
            }
        }
        let mut hashes = Vec::new();
        for b in split_blocks(content) {
            let h = sha(&b);
            let p = self.dir.join("objects").join(&h);
            if !p.exists() {
                fs::write(p, &b)?;
            }
            hashes.push(h);
        }
        let at = now_ms();
        let rec = Record { id: format!("v{}", at), file: file.to_string(), at, source: source.clone(), name, note, blocks: hashes };
        let merge = source == Source::External
            && recs.last().map(|l| l.source == Source::External && at.saturating_sub(l.at) < merge_ms).unwrap_or(false);
        if merge {
            let meta = {
                let last = recs.last_mut().unwrap();
                last.blocks = rec.blocks.clone();
                last.at = at;
                Meta::from(&*last)
            };
            self.write_records(file, &recs)?;
            return Ok(Some(meta));
        }
        let mut f = OpenOptions::new().create(true).append(true).open(self.log_path(file))?;
        writeln!(f, "{}", serde_json::to_string(&rec).unwrap())?;
        Ok(Some(Meta::from(&rec)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_is_lossless_and_keeps_fences_together() {
        let t = "# 标题\n\n第一段\n第一段续\n\n\n```py\na = 1\n\nb = 2\n```\n\n$$\nx\n\ny\n$$\n\n最后";
        let b = split_blocks(t);
        assert_eq!(b.concat(), t);
        assert_eq!(b.len(), 5);
        assert!(b[2].contains("a = 1") && b[2].contains("b = 2"));
        assert!(b[3].contains("x") && b[3].contains("y"));
    }

    #[test]
    fn save_dedupes_blocks_and_skips_identical_auto() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path());
        let f = "正文/03.md";
        s.save(f, "甲\n\n乙\n", Source::Auto, None, None, 5000).unwrap();
        assert!(s.save(f, "甲\n\n乙\n", Source::Auto, None, None, 5000).unwrap().is_none());
        s.save(f, "甲\n\n丙\n", Source::Saved, Some("交导师前".into()), None, 5000).unwrap();
        let objs = fs::read_dir(d.path().join(".holymark/objects")).unwrap().count();
        assert_eq!(objs, 3);
        let recs = s.records(f);
        assert_eq!(recs.len(), 2);
        assert_eq!(s.content(&recs[1]).unwrap(), "甲\n\n丙\n");
        assert_eq!(recs[1].name.as_deref(), Some("交导师前"));
    }

    #[test]
    fn external_writes_merge_within_window() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path());
        s.save("a.md", "一", Source::External, None, None, 60_000).unwrap();
        s.save("a.md", "一二", Source::External, None, None, 60_000).unwrap();
        let recs = s.records("a.md");
        assert_eq!(recs.len(), 1);
        assert_eq!(s.content(&recs[0]).unwrap(), "一二");
    }

    #[test]
    fn rename_moves_history_of_file_and_folder() {
        let d = tempfile::tempdir().unwrap();
        let st = Store::new(d.path());
        st.save("a.md", "甲\n", Source::Saved, Some("一".into()), None, 0).unwrap();
        st.save("稿/b.md", "乙\n", Source::Saved, None, None, 0).unwrap();
        st.save("稿/c.md", "丙\n", Source::Saved, None, None, 0).unwrap();
        assert_eq!(st.rename("a.md", "新/a2.md").unwrap(), 1);
        assert!(st.records("a.md").is_empty());
        assert_eq!(st.records("新/a2.md")[0].name.as_deref(), Some("一"));
        assert_eq!(st.rename("稿", "正文").unwrap(), 2);
        assert_eq!(st.records("正文/b.md").len(), 1);
        assert_eq!(st.content(&st.records("正文/c.md")[0]).unwrap(), "丙\n");
    }
}
