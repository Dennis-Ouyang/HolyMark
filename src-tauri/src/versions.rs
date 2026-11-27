//! 版本库：按段落内容寻址存储。
//!
//! 目录结构（工作区在用户的文件夹里；单独打开的文件存在应用自己的数据目录里，见 lib.rs 的 locate）：
//!   .holymark/objects/<sha256>          每个段落块的原文，相同内容只存一次
//!   .holymark/versions/<文件路径哈希>/<设备>.jsonl  每行一个版本记录，只记块哈希列表
//!
//! 块切分是无损的：每块包含它后面的空行，按顺序拼接即可还原原文。
//!
//! 多设备同步（G8）：文件夹放在网盘里、几台电脑同时用时，只往后追加的单个日志很容易被网盘生成「冲突副本」。
//! 所以每台设备只写自己的那一段（<设备>.jsonl），读的时候把所有设备的段合并、按时间排序。
//! 内容块按哈希命名，不同设备写同一个块也不会冲突。以前的 <文件路径哈希>.jsonl 照样读（当成一段）。
//! Store 对外的接口（new、records、content、save、rename）不变。
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

/// 这台设备的标识：第一次用时随机生成，存在用户目录的 .holymark-device 里（不在稿件文件夹里，免得被同步过去）
fn device_id() -> &'static str {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| {
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
        let f = home.map(|h| h.join(".holymark-device"));
        if let Some(f) = &f {
            if let Ok(s) = fs::read_to_string(f) {
                let s = s.trim().to_string();
                if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                    return s;
                }
            }
        }
        let seed = format!("{}-{}-{:?}", now_ms(), std::process::id(), std::thread::current().id());
        let id = sha(&seed)[..12].to_string();
        if let Some(f) = &f {
            let _ = fs::write(f, &id);
        }
        id
    })
}

pub struct Store {
    dir: PathBuf,
    device: String,
}

fn parse_lines(s: &str) -> Vec<Record> {
    s.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

impl Store {
    /// 工作区的版本库：文件夹里的 .holymark/
    pub fn new(root: &Path) -> Self {
        Store { dir: root.join(".holymark"), device: device_id().to_string() }
    }

    /// 放在别处的版本库（单独打开的文件：应用数据目录）。格式和工作区的一样，但不写 .gitignore（那里不是稿件文件夹）
    pub fn at(dir: PathBuf) -> Self {
        Store { dir, device: device_id().to_string() }
    }

    /// 把另一个版本库里 from 的全部版本搬进来，记在 to 名下（单独打开的文件改用「所在文件夹」作工作区时）。
    /// 读对方所有设备段，和这台设备在 to 名下的段合并（按 id 和内容去重、按时间排），只写这台设备的段，不碰别的设备的分段。
    /// 没有可搬的就什么都不写（不会建出空的 .holymark/）。
    pub fn import(&self, other: &Store, from: &str, to: &str) -> std::io::Result<usize> {
        let recs = other.records(from);
        if recs.is_empty() {
            return Ok(0);
        }
        fs::create_dir_all(self.dir.join("objects"))?;
        fs::create_dir_all(self.dir.join("versions"))?;
        if self.is_workspace() {
            self.ensure_gitignore();
        }
        for r in &recs {
            for h in &r.blocks {
                let dest = self.dir.join("objects").join(h);
                if !dest.exists() {
                    fs::copy(other.dir.join("objects").join(h), dest)?;
                }
            }
        }
        let mut all = self.own_records(to);
        let n = recs.len();
        for mut r in recs {
            // 同一毫秒里存的两个版本 id 会一样，所以连内容一起比
            if all.iter().any(|x| x.id == r.id && x.blocks == r.blocks) {
                continue;
            }
            r.file = to.to_string();
            all.push(r);
        }
        all.sort_by_key(|r| r.at);
        self.write_records(to, &all)?;
        Ok(n)
    }

    /// 工作区里的版本库（目录名是 .holymark）；应用数据目录里的单文件版本库不是
    fn is_workspace(&self) -> bool {
        self.dir.file_name().and_then(|n| n.to_str()) == Some(".holymark")
    }

    /// 测试用：指定设备
    #[cfg(test)]
    fn on_device(root: &Path, device: &str) -> Self {
        Store { dir: root.join(".holymark"), device: device.to_string() }
    }

    fn key(file: &str) -> String {
        sha(file)[..16].to_string()
    }

    /// 以前只有一段时的日志文件
    fn legacy_path(&self, file: &str) -> PathBuf {
        self.dir.join("versions").join(format!("{}.jsonl", Self::key(file)))
    }

    fn seg_dir(&self, file: &str) -> PathBuf {
        self.dir.join("versions").join(Self::key(file))
    }

    /// 这台设备写的那一段
    fn log_path(&self, file: &str) -> PathBuf {
        self.seg_dir(file).join(format!("{}.jsonl", self.device))
    }

    /// 所有段的路径（以前的单个日志 + 每台设备一段，包括网盘生成的冲突副本）
    fn segments(&self, file: &str) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let legacy = self.legacy_path(file);
        if legacy.exists() {
            out.push(legacy);
        }
        if let Ok(rd) = fs::read_dir(self.seg_dir(file)) {
            let mut v: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jsonl")).collect();
            v.sort();
            out.extend(v);
        }
        out
    }

    /// 所有设备的版本合并起来，按时间排；同一个 id 只留一条（网盘冲突副本里的重复）
    pub fn records(&self, file: &str) -> Vec<Record> {
        let mut all: Vec<Record> = self.segments(file).iter().filter_map(|p| fs::read_to_string(p).ok()).flat_map(|s| parse_lines(&s)).collect();
        all.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| a.id.cmp(&b.id)));
        all.dedup_by(|a, b| a.id == b.id);
        all
    }

    /// 只读这台设备的段
    fn own_records(&self, file: &str) -> Vec<Record> {
        fs::read_to_string(self.log_path(file)).map(|s| parse_lines(&s)).unwrap_or_default()
    }

    fn write_seg(path: &Path, recs: &[Record]) -> std::io::Result<()> {
        if let Some(d) = path.parent() {
            fs::create_dir_all(d)?;
        }
        let mut s = String::new();
        for r in recs {
            s.push_str(&serde_json::to_string(r).unwrap());
            s.push('\n');
        }
        fs::write(path, s)
    }

    fn write_records(&self, file: &str, recs: &[Record]) -> std::io::Result<()> {
        Self::write_seg(&self.log_path(file), recs)
    }

    /// 给用 git 管理稿件的人：.holymark 里哪些该提交、哪些不该（G8）。已经有了就不动
    fn ensure_gitignore(&self) {
        let p = self.dir.join(".gitignore");
        if p.exists() {
            return;
        }
        let _ = fs::write(
            p,
            "# HolyMark 的数据目录。用 git 管理稿件时：\n             # - versions/ 和 objects/ 是版本历史，想跟着稿件一起提交就保留；不想提交的话，把下面两行前面的 # 去掉。\n             # versions/\n             # objects/\n             # 删除后暂存的文件、导出时生成的临时配置，不用提交：\n             trash/\n             export/*.typst\n",
        );
    }

    /// 文件或文件夹改名、移动后，把它（文件夹时是里面所有文件）的版本记录跟着搬过去。
    /// 记录文件名是路径的哈希，没法直接按前缀找，所以挨个读一下每段的第一条。每段搬到新位置的同名段里。
    pub fn rename(&self, from: &str, to: &str) -> std::io::Result<usize> {
        let dir = self.dir.join("versions");
        let Ok(entries) = fs::read_dir(&dir) else { return Ok(0) };
        let prefix = format!("{from}/");
        let mut moved = std::collections::HashSet::new();
        // 以前的单段日志（versions/<key>.jsonl）和新的分段（versions/<key>/<设备>.jsonl）
        let mut segs: Vec<(PathBuf, Option<String>)> = Vec::new();
        for e in entries.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() {
                if let Ok(rd) = fs::read_dir(&p) {
                    for s in rd.filter_map(|s| s.ok()) {
                        let name = s.file_name().to_string_lossy().to_string();
                        segs.push((s.path(), Some(name)));
                    }
                }
            } else {
                segs.push((p, None));
            }
        }
        for (path, seg_name) in segs {
            let Ok(text) = fs::read_to_string(&path) else { continue };
            let mut recs = parse_lines(&text);
            let Some(file) = recs.first().map(|r| r.file.clone()) else { continue };
            let new = if file == from { to.to_string() } else if let Some(rest) = file.strip_prefix(&prefix) { format!("{to}/{rest}") } else { continue };
            for r in &mut recs {
                r.file = new.clone();
            }
            let dest = self.seg_dir(&new).join(seg_name.unwrap_or_else(|| format!("{}.jsonl", self.device)));
            // 目标段里已经有记录（以前的单段日志搬到这台设备的段）：合并
            let mut merged = fs::read_to_string(&dest).map(|s| parse_lines(&s)).unwrap_or_default();
            if dest != path {
                merged.extend(recs);
            } else {
                merged = recs;
            }
            merged.sort_by_key(|r| r.at);
            Self::write_seg(&dest, &merged)?;
            if dest != path {
                fs::remove_file(&path)?;
                if let Some(d) = path.parent() {
                    let _ = fs::remove_dir(d); // 空了就删掉
                }
            }
            moved.insert(new);
        }
        Ok(moved.len())
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
        fs::create_dir_all(self.seg_dir(file))?;
        if self.is_workspace() {
            self.ensure_gitignore();
        }
        let all = self.records(file);
        if source != Source::Saved {
            if let Some(last) = all.last() {
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
        // id 带上设备，几台设备同一毫秒存版本也不会撞；序号补零，同一毫秒里按 id 排序时先后不会乱（"-10" 排在 "-9" 前面）
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let rec = Record { id: format!("v{}-{}-{:06}", at, &self.device[..6.min(self.device.len())], seq % 1_000_000), file: file.to_string(), at, source: source.clone(), name, note, blocks: hashes };
        // 合并外部修改只在这台设备自己的段里做（别的设备的段不改写）
        let mut recs = self.own_records(file);
        let merge = source == Source::External
            && all.last().map(|l| recs.last().map(|o| o.id == l.id).unwrap_or(false)).unwrap_or(false)
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
        let _ = &mut recs;
        writeln!(f, "{}", serde_json::to_string(&rec).unwrap())?;
        Ok(Some(Meta::from(&rec)))
    }
}

/// 版本列表的稀疏规则（G7）：自动版本和外部修改一天内全留，两周内每小时留最后一个，更早的每天留最后一个；
/// 你保存的版本全部保留。只影响列出来的版本，不删除存储（对比、恢复时照样找得到）。
pub fn thin(recs: &[Record], now: u64) -> Vec<&Record> {
    const H: u64 = 3_600_000;
    const D: u64 = 24 * H;
    let mut out: Vec<&Record> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    // 从新到旧，每个时间桶留第一个遇到的（最新的）
    for r in recs.iter().rev() {
        if r.source == Source::Saved {
            out.push(r);
            continue;
        }
        let age = now.saturating_sub(r.at);
        let bucket = if age < D { None } else if age < 14 * D { Some((1u8, r.at / H)) } else { Some((2u8, r.at / D)) };
        match bucket {
            None => out.push(r),
            Some(b) => {
                if seen.insert(b) {
                    out.push(r);
                }
            }
        }
    }
    out.reverse();
    out
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
    fn each_device_writes_its_own_segment_and_reads_merge() {
        let d = tempfile::tempdir().unwrap();
        let a = Store::on_device(d.path(), "aaaaaa111111");
        let b = Store::on_device(d.path(), "bbbbbb222222");
        a.save("x.md", "甲\n", Source::Saved, Some("A".into()), None, 0).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(3));
        b.save("x.md", "乙\n", Source::Saved, Some("B".into()), None, 0).unwrap();
        let segs = fs::read_dir(d.path().join(".holymark/versions").join(Store::key("x.md"))).unwrap().count();
        assert_eq!(segs, 2);
        let names: Vec<_> = a.records("x.md").iter().map(|r| r.name.clone().unwrap()).collect();
        assert_eq!(names, vec!["A", "B"]);
        assert!(d.path().join(".holymark/.gitignore").exists());
    }

    #[test]
    fn legacy_single_log_is_still_read_and_moved_on_rename() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::on_device(d.path(), "cccccc333333");
        fs::create_dir_all(d.path().join(".holymark/versions")).unwrap();
        let rec = Record { id: "v1".into(), file: "old.md".into(), at: 1, source: Source::Saved, name: Some("旧".into()), note: None, blocks: vec![] };
        fs::write(s.legacy_path("old.md"), serde_json::to_string(&rec).unwrap() + "\n").unwrap();
        assert_eq!(s.records("old.md").len(), 1);
        s.rename("old.md", "new.md").unwrap();
        assert!(s.records("old.md").is_empty());
        assert_eq!(s.records("new.md")[0].name.as_deref(), Some("旧"));
    }

    #[test]
    fn thinning_keeps_saved_and_recent() {
        let h = 3_600_000u64;
        let now = 100 * 24 * h;
        let mk = |at: u64, src: Source| Record { id: format!("v{at}"), file: "a".into(), at, source: src, name: None, note: None, blocks: vec![] };
        let recs = vec![
            mk(now - 40 * 24 * h, Source::Auto), mk(now - 40 * 24 * h + 10, Source::Auto), // 更早：同一天留一个
            mk(now - 5 * 24 * h, Source::Auto), mk(now - 5 * 24 * h + 60_000, Source::Auto), // 两周内：同一小时留一个
            mk(now - 5 * 24 * h + 120_000, Source::Saved), // 你保存的：全留
            mk(now - h, Source::Auto), mk(now - h + 1, Source::Auto), // 一天内：全留
        ];
        let t = thin(&recs, now);
        assert_eq!(t.len(), 5);
        assert_eq!(t[0].at, now - 40 * 24 * h + 10);
    }

    #[test]
    fn reading_does_not_create_store_and_import_merges() {
        let d = tempfile::tempdir().unwrap();
        let ws = Store::new(d.path());
        assert!(ws.records("a.md").is_empty());
        assert!(!d.path().join(".holymark").exists(), "只读不建目录");
        // 单独打开时的版本库，搬进工作区
        let app = tempfile::tempdir().unwrap();
        let single = Store::at(app.path().join("single"));
        single.save("/x/a.md", "甲\n", Source::Auto, None, None, 0).unwrap();
        single.save("/x/a.md", "甲\n\n乙\n", Source::Saved, Some("改过".into()), None, 0).unwrap();
        assert_eq!(ws.import(&single, "/x/nothing.md", "a.md").unwrap(), 0);
        assert!(!d.path().join(".holymark").exists(), "没有可搬的不建目录");
        assert_eq!(ws.import(&single, "/x/a.md", "a.md").unwrap(), 2);
        let recs = ws.records("a.md");
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[1].name.as_deref(), Some("改过"));
        assert_eq!(ws.content(&recs[1]).unwrap(), "甲\n\n乙\n");
        // 再搬一次不重复
        ws.import(&single, "/x/a.md", "a.md").unwrap();
        assert_eq!(ws.records("a.md").len(), 2);
        // 应用数据目录里不写 .gitignore；工作区的有
        assert!(!app.path().join("single/.gitignore").exists());
        assert!(d.path().join(".holymark/.gitignore").exists());
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
