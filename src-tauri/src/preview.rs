//! 文件预览：正文里单独成段的文件链接显示成纸张卡片，这里读出卡片上要画的东西。
//! Word / PPT / Excel 都是 zip 里的 XML，按标签把文字抠出来就够画缩略图了；PDF 由前端的 pdf.js 画第一页。
use serde::Serialize;
use std::io::Read;
use std::path::Path;

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    /// md / word / ppt / excel / pdf / other
    pub kind: String,
    pub title: String,
    /// 开头的几段文字（Excel 是前几行，单元格用制表符隔开）
    pub lines: Vec<String>,
    pub size: u64,
    /// 修改时间，毫秒
    pub modified: u64,
    /// 页数 / 幻灯片数 / 工作表数（知道的话）
    pub pages: Option<u32>,
}

/// 整篇的阅读版（N5 正文区的只读预览）：PPT 每张一节，Excel 每张工作表一节
#[derive(Serialize, Default, Debug)]
pub struct Section {
    pub title: String,
    pub lines: Vec<String>,
}
#[derive(Serialize, Default, Debug)]
pub struct FileDocument {
    #[serde(flatten)]
    pub info: FilePreview,
    pub sections: Vec<Section>,
}

/// 取出所有 <tag …>文字</tag> 里的文字；遇到 end 标签时换一段
fn texts(xml: &str, tag: &str, para_end: &str, max: usize) -> Vec<String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = vec![];
    let mut cur = String::new();
    let mut rest = xml;
    loop {
        let a = rest.find(&open);
        let p = if para_end.is_empty() { None } else { rest.find(para_end) };
        match (a, p) {
            (Some(i), Some(j)) if j < i => {
                if !cur.trim().is_empty() {
                    out.push(std::mem::take(&mut cur).trim().to_string());
                    if out.len() >= max {
                        return out;
                    }
                }
                cur.clear();
                rest = &rest[j + para_end.len()..];
            }
            (Some(i), _) => {
                let after = &rest[i + open.len()..];
                // <w:t> 或 <w:t xml:space="preserve">，但不能是 <w:tab> 这种
                if !(after.starts_with('>') || after.starts_with(' ')) {
                    rest = after;
                    continue;
                }
                let Some(gt) = after.find('>') else { break };
                if after[..gt].ends_with('/') {
                    rest = &after[gt + 1..];
                    continue;
                }
                let body = &after[gt + 1..];
                let Some(end) = body.find(&close) else { break };
                cur.push_str(&crate::xml::unescape(&body[..end]));
                rest = &body[end + close.len()..];
            }
            (None, Some(j)) => {
                if !cur.trim().is_empty() {
                    out.push(std::mem::take(&mut cur).trim().to_string());
                }
                rest = &rest[j + para_end.len()..];
                if out.len() >= max {
                    return out;
                }
            }
            (None, None) => break,
        }
    }
    if !cur.trim().is_empty() && out.len() < max {
        out.push(cur.trim().to_string());
    }
    out
}

fn zip_text(z: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut f = z.by_name(name).ok()?;
    let mut s = String::new();
    // 只读前 2MB，够取开头几段
    (&mut f).take(2 << 20).read_to_string(&mut s).ok()?;
    Some(s)
}

fn core_title(z: &mut zip::ZipArchive<std::fs::File>) -> Option<String> {
    let core = zip_text(z, "docProps/core.xml")?;
    texts(&core, "dc:title", "", 1).into_iter().next().filter(|t| !t.trim().is_empty())
}

fn shared_strings(z: &mut zip::ZipArchive<std::fs::File>, max: usize) -> Vec<String> {
    // 每个 <si> 一条（空的也要占位，否则编号会错开）；里面可能是 <t>，也可能是几段 <r><t>，去掉标签拼起来
    let Some(x) = zip_text_full(z, "xl/sharedStrings.xml") else { return vec![] };
    x.split("<si").skip(1).take(max).map(|part| {
        let body = part.split("</si>").next().unwrap_or("");
        let body = body.find('>').map(|i| &body[i + 1..]).unwrap_or("");
        // 注音（<rPh>）不要
        let body: String = body.split("<rPh").enumerate().map(|(i, seg)| if i == 0 { seg } else { seg.split("</rPh>").nth(1).unwrap_or("") }).collect();
        crate::xml::unescape(&strip_tags(&body))
    }).collect()
}

/// Excel：第一张表的前几行，共享字符串换成文字
fn sheet_rows(z: &mut zip::ZipArchive<std::fs::File>) -> Vec<String> {
    let shared = shared_strings(z, 4000);
    sheet_rows_of(z, "xl/worksheets/sheet1.xml", &shared, 8, 6)
}

/// 某一张工作表的前 max_rows 行、每行前 max_cols 格，单元格用制表符隔开
fn sheet_rows_of(z: &mut zip::ZipArchive<std::fs::File>, name: &str, shared: &[String], max_rows: usize, max_cols: usize) -> Vec<String> {
    let Some(sheet) = zip_text(z, name) else { return vec![] };
    let mut rows = vec![];
    for row in sheet.split("</row>").take(max_rows) {
        let mut cells = vec![];
        for c in row.split("<c ").skip(1) {
            let head = &c[..c.find('>').unwrap_or(0)];
            let v = c.find("<v>").and_then(|i| c[i + 3..].find("</v>").map(|j| c[i + 3..i + 3 + j].to_string()));
            let inline = c.find("<t>").and_then(|i| c[i + 3..].find("</t>").map(|j| c[i + 3..i + 3 + j].to_string()));
            let val = if head.contains("t=\"s\"") { v.and_then(|i| i.parse::<usize>().ok()).and_then(|i| shared.get(i).cloned()) } else { inline.or(v) };
            cells.push(crate::xml::unescape(&val.unwrap_or_default()));
            if cells.len() >= max_cols {
                break;
            }
        }
        if cells.iter().any(|c| !c.is_empty()) {
            rows.push(cells.join("\t"));
        }
    }
    rows
}

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for ch in s.chars() {
        match ch {
            '<' => inside = true,
            '>' => inside = false,
            _ if !inside => out.push(ch),
            _ => {}
        }
    }
    out
}

/// 整篇的阅读版：Word 全部段落；PPT 每张一节；Excel 每张工作表一节（每张最多 500 行、30 列）
pub fn document(path: &Path) -> Result<FileDocument, String> {
    let info = preview(path)?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let open = || -> Result<zip::ZipArchive<std::fs::File>, String> {
        zip::ZipArchive::new(std::fs::File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    let mut sections = vec![];
    match ext.as_str() {
        "docx" | "dotx" => {
            let mut z = open()?;
            if let Some(d) = zip_text_full(&mut z, "word/document.xml") {
                sections.push(Section { title: String::new(), lines: texts(&d, "w:t", "</w:p>", 20_000) });
            }
        }
        "pptx" => {
            let mut z = open()?;
            for n in 1..=info.pages.unwrap_or(0) {
                if let Some(s) = zip_text(&mut z, &format!("ppt/slides/slide{n}.xml")) {
                    sections.push(Section { title: format!("第 {n} 张"), lines: texts(&s, "a:t", "</a:p>", 200) });
                }
            }
        }
        "xlsx" => {
            let mut z = open()?;
            let shared = shared_strings(&mut z, 200_000);
            let names: Vec<String> = zip_text(&mut z, "xl/workbook.xml")
                .map(|w| w.split("<sheet ").skip(1).map(|s| s.split("name=\"").nth(1).and_then(|x| x.split('"').next()).map(crate::xml::unescape).unwrap_or_default()).collect())
                .unwrap_or_default();
            for (i, name) in names.iter().enumerate() {
                let rows = sheet_rows_of(&mut z, &format!("xl/worksheets/sheet{}.xml", i + 1), &shared, 500, 30);
                sections.push(Section { title: if name.is_empty() { format!("工作表 {}", i + 1) } else { name.clone() }, lines: rows });
            }
        }
        _ => {}
    }
    Ok(FileDocument { info, sections })
}

/// 整个文件（Word 正文可能很长，最多读 32MB）
fn zip_text_full(z: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut f = z.by_name(name).ok()?;
    let mut s = String::new();
    (&mut f).take(32 << 20).read_to_string(&mut s).ok()?;
    Some(s)
}

pub fn preview(path: &Path) -> Result<FilePreview, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mut p = FilePreview { size: meta.len(), modified, title: stem.clone(), ..Default::default() };
    let open = || -> Result<zip::ZipArchive<std::fs::File>, String> {
        zip::ZipArchive::new(std::fs::File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    match ext.as_str() {
        "md" | "markdown" | "txt" => {
            p.kind = "md".into();
            let mut s = String::new();
            std::fs::File::open(path).map_err(|e| e.to_string())?.take(16 << 10).read_to_string(&mut s).ok();
            // 前端负责去掉 Markdown 符号；这里只按空行切出前几段
            p.lines = s.split("\n\n").map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).take(10).collect();
        }
        "docx" | "dotx" => {
            p.kind = "word".into();
            let mut z = open()?;
            if let Some(d) = zip_text(&mut z, "word/document.xml") {
                p.lines = texts(&d, "w:t", "</w:p>", 12);
            }
            if let Some(t) = core_title(&mut z) {
                p.title = t;
            }
            p.pages = zip_text(&mut z, "docProps/app.xml").and_then(|a| texts(&a, "Pages", "", 1).into_iter().next()).and_then(|n| n.parse().ok());
        }
        "pptx" => {
            p.kind = "ppt".into();
            let mut z = open()?;
            let n = (0..z.len()).filter(|&i| z.by_index(i).map(|f| { let nm = f.name(); nm.starts_with("ppt/slides/slide") && nm.ends_with(".xml") }).unwrap_or(false)).count();
            p.pages = Some(n as u32);
            if let Some(s) = zip_text(&mut z, "ppt/slides/slide1.xml") {
                p.lines = texts(&s, "a:t", "</a:p>", 10);
            }
            if let Some(t) = core_title(&mut z) {
                p.title = t;
            }
        }
        "xlsx" => {
            p.kind = "excel".into();
            let mut z = open()?;
            p.lines = sheet_rows(&mut z);
            p.pages = zip_text(&mut z, "xl/workbook.xml").map(|w| w.matches("<sheet ").count() as u32);
        }
        "pdf" => p.kind = "pdf".into(),
        "doc" | "rtf" => p.kind = "word".into(),
        "ppt" | "key" => p.kind = "ppt".into(),
        "xls" | "csv" | "numbers" => p.kind = "excel".into(),
        _ => p.kind = "other".into(),
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_paragraphs_and_skips_tabs() {
        let xml = r#"<w:body><w:p><w:r><w:t>东方之珠</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">用户走访</w:t></w:r></w:p><w:p><w:r><w:t>结论 &amp; 建议</w:t></w:r></w:p><w:p/></w:body>"#;
        assert_eq!(texts(xml, "w:t", "</w:p>", 10), vec!["东方之珠用户走访", "结论 & 建议"]);
    }

    #[test]
    fn real_files() {
        let d = tempfile::tempdir().unwrap();
        // 用 zip 拼一个最小的 docx
        let path = d.path().join("汇报.docx");
        {
            let f = std::fs::File::create(&path).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let o = zip::write::SimpleFileOptions::default();
            use std::io::Write;
            z.start_file("word/document.xml", o).unwrap();
            z.write_all(r#"<w:document><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>"#.as_bytes()).unwrap();
            z.start_file("docProps/core.xml", o).unwrap();
            z.write_all("<cp:coreProperties><dc:title>走访汇报</dc:title></cp:coreProperties>".as_bytes()).unwrap();
            z.finish().unwrap();
        }
        let p = preview(&path).unwrap();
        assert_eq!(p.kind, "word");
        assert_eq!(p.title, "走访汇报");
        assert_eq!(p.lines, vec!["第一段", "第二段"]);
        let doc = document(&path).unwrap();
        assert_eq!(doc.sections[0].lines, vec!["第一段", "第二段"]);
        // 最小的 xlsx：两张表
        let xl = d.path().join("表.xlsx");
        {
            let f = std::fs::File::create(&xl).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let o = zip::write::SimpleFileOptions::default();
            use std::io::Write;
            z.start_file("xl/workbook.xml", o).unwrap();
            z.write_all(r#"<workbook><sheets><sheet name="编码" sheetId="1"/><sheet name="汇总" sheetId="2"/></sheets></workbook>"#.as_bytes()).unwrap();
            z.start_file("xl/sharedStrings.xml", o).unwrap();
            z.write_all("<sst><si><t>编号</t></si><si><t>类别</t></si></sst>".as_bytes()).unwrap();
            z.start_file("xl/worksheets/sheet1.xml", o).unwrap();
            z.write_all(r#"<sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t>A</t></is></c></row></sheetData>"#.as_bytes()).unwrap();
            z.start_file("xl/worksheets/sheet2.xml", o).unwrap();
            z.write_all(r#"<sheetData><row><c r="A1"><v>42</v></c></row></sheetData>"#.as_bytes()).unwrap();
            z.finish().unwrap();
        }
        let x = document(&xl).unwrap();
        assert_eq!(x.sections.iter().map(|s| s.title.as_str()).collect::<Vec<_>>(), vec!["编码", "汇总"]);
        assert_eq!(x.sections[0].lines, vec!["编号\t类别", "1\tA"]);
        assert_eq!(x.sections[1].lines, vec!["42"]);
        let md = d.path().join("笔记.md");
        std::fs::write(&md, "# 标题\n\n第一段\n\n第二段").unwrap();
        assert_eq!(preview(&md).unwrap().lines, vec!["# 标题", "第一段", "第二段"]);
    }
}

#[cfg(test)]
mod real {
    /// 用真实文件试：HM_PREVIEW=文件路径 cargo test --lib preview_env -- --ignored --nocapture
    #[test]
    #[ignore]
    fn preview_env() {
        for p in std::env::var("HM_PREVIEW").unwrap_or_default().split(',').filter(|s| !s.is_empty()) {
            println!("{p}: {:?}", super::preview(std::path::Path::new(p)).unwrap());
        }
    }
}
