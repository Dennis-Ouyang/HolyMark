//! 从 Word 导入（G9）：用内置的 Pandoc 把 .docx 转成 Markdown，图片放进文稿旁边的图片文件夹（默认 assets/）。
use crate::export::{command, find_tool};
use crate::fsops;
use std::path::{Path, PathBuf};

/// 把 src（.docx）转成 dest_dir 里的同名 .md（重名时加编号），返回新文件的路径
pub fn docx_to_md(src: &Path, dest_dir: &Path, image_dir: &str) -> Result<PathBuf, String> {
    let pandoc = find_tool("pandoc").ok_or("没有找到 Pandoc，没法从 Word 导入")?;
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("导入的文稿").to_string();
    let out = fsops::unique_in(dest_dir, &stem, ".md");
    // 图片先解到「图片文件夹/文稿名/」下，免得不同文稿的 image1.png 互相覆盖；链接写成相对路径
    let media = Path::new(image_dir).join(&stem);
    let mut cmd = command(&pandoc);
    cmd.current_dir(dest_dir)
        .arg(src)
        .args(["-f", "docx", "-t", "markdown-raw_html-native_divs-native_spans-bracketed_spans-fenced_divs+east_asian_line_breaks", "--wrap=none", "--markdown-headings=atx"])
        .arg(format!("--extract-media={}", media.to_string_lossy().replace('\\', "/")))
        .arg("-o")
        .arg(&out);
    let r = cmd.output().map_err(|e| format!("无法运行 Pandoc：{e}"))?;
    if !r.status.success() {
        return Err(format!("Pandoc 没能转换这个文件：{}", String::from_utf8_lossy(&r.stderr).trim()));
    }
    // 有的 Pandoc 版本把列表写成「-   甲」「1.  一」（符号后面补空格对齐），规整成一个空格，和 HolyMark 自己写的一样
    let text = std::fs::read_to_string(&out).map_err(|e| e.to_string())?;
    std::fs::write(&out, tidy_lists(&text)).map_err(|e| e.to_string())?;
    Ok(out)
}

/// 「-   甲」→「- 甲」，「10.  十」→「10. 十」；续行的缩进跟着减掉同样的空格
pub fn tidy_lists(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut fence = false;
    for line in md.split_inclusive('\n') {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
        }
        if !fence {
            let ind = &line[..line.len() - t.len()];
            let marker_len = if t.starts_with("- ") || t.starts_with("* ") || t.starts_with("+ ") {
                1
            } else {
                t.find(|c: char| !c.is_ascii_digit()).filter(|&i| i > 0 && (t[i..].starts_with(". ") || t[i..].starts_with(") "))).map(|i| i + 1).unwrap_or(0)
            };
            if marker_len > 0 {
                let rest = &t[marker_len..];
                let body = rest.trim_start_matches(' ');
                if rest.len() - body.len() > 1 && !body.is_empty() {
                    out.push_str(ind);
                    out.push_str(&t[..marker_len]);
                    out.push(' ');
                    out.push_str(body);
                    continue;
                }
            }
        }
        out.push_str(line);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tidy_list_markers() {
        assert_eq!(tidy_lists("-   甲\n-   乙\n\n1.  一\n10. 十\n```\n-   代码里不动\n```\n"), "- 甲\n- 乙\n\n1. 一\n10. 十\n```\n-   代码里不动\n```\n");
    }

    /// 有 Pandoc 时：用 Pandoc 自己生成一个 .docx，再导入回来
    #[test]
    fn roundtrip_when_pandoc_exists() {
        let Some(pandoc) = find_tool("pandoc") else { return };
        let d = tempfile::tempdir().unwrap();
        let md = d.path().join("源.md");
        std::fs::write(&md, "# 标题\n\n有**加粗**的段落。\n\n- 甲\n- 乙\n").unwrap();
        let docx = d.path().join("论文.docx");
        let ok = command(&pandoc).arg(&md).arg("-o").arg(&docx).status().unwrap().success();
        assert!(ok);
        let out_dir = d.path().join("稿件");
        std::fs::create_dir(&out_dir).unwrap();
        let p = docx_to_md(&docx, &out_dir, "assets").unwrap();
        assert_eq!(p.file_name().unwrap(), "论文.md");
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains("# 标题"), "{text}");
        assert!(text.contains("**加粗**"), "{text}");
        assert!(text.contains("- 甲"), "{text}");
    }
}
