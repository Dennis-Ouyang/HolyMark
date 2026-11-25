//! 导出：调用 Pandoc（Word、PDF）和 Typst（PDF 排版）。
//!
//! 版式不靠 Pandoc 的命令行参数，而是写进两个文件，和 defaults 文件放在一起，
//! 都在文件夹的 `.holymark/export/` 下，命令行里也能直接用：
//! - Word：一份改写过样式的参考文档 `word-reference.docx`（字体、字号、行距、页边距、页眉页脚）
//! - PDF：一份 Typst 模板 `pdf-template.typst`
use crate::xml::{self, El, Node};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

/* ---------------- 运行命令行工具 ---------------- */

/// 运行 Pandoc、Typst 这类命令行工具。Windows 上默认会给每个子进程弹一个黑色的控制台窗口，
/// 发布版的应用本身没有控制台，所以每次查版本、导出都会闪出终端；加上 CREATE_NO_WINDOW 就不会了。
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/* ---------------- 找到 Pandoc 和 Typst ---------------- */

/// 先找应用里内置的，再找 Homebrew 和 PATH。从 Finder 启动的应用拿不到终端里的 PATH，所以常见目录单独列出来。
/// Windows 上可执行文件带 .exe 后缀。
pub fn find_tool(name: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let mut dirs: Vec<PathBuf> = vec![];
    // 开发时可以指定一个目录，优先用里面的版本
    if let Some(d) = std::env::var_os("HOLYMARK_TOOLS_DIR") {
        dirs.push(PathBuf::from(d));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            dirs.push(d.to_path_buf());
        }
    }
    #[cfg(not(windows))]
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(d));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.into_iter().map(|d| d.join(&file)).find(|p| p.is_file())
}

#[derive(Serialize, Clone, Debug)]
pub struct Tool {
    pub path: String,
    pub version: String,
    pub bundled: bool,
}

pub fn tool_info(name: &str) -> Option<Tool> {
    let p = find_tool(name)?;
    let out = command(&p).arg("--version").output().ok()?;
    let version = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").to_string();
    let bundled = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| p.starts_with(d))).unwrap_or(false);
    Some(Tool { path: p.to_string_lossy().to_string(), version, bundled })
}

/* ---------------- Word 参考文档 ---------------- */

#[derive(Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeaderFooter {
    pub text: String,
    /// left / center / right
    pub align: String,
}

#[derive(Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HeadingStyle {
    pub level: u8,
    pub latin: Option<String>,
    pub cjk: Option<String>,
    /// 半磅
    pub size: Option<u32>,
    pub bold: Option<bool>,
    /// left / center / right / both
    pub align: Option<String>,
    /// 缇（1/20 磅）
    pub before: Option<u32>,
    pub after: Option<u32>,
    pub black: bool,
}

/// 前端换算好的 Word 单位；None 表示不改，沿用参考文档
#[derive(Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocxStyle {
    /// 纸张宽高，缇
    pub page: Option<(u32, u32)>,
    /// 上、下、左、右，缇
    pub margins: [Option<u32>; 4],
    pub header: Option<HeaderFooter>,
    pub footer: Option<HeaderFooter>,
    pub title: String,
    pub latin: Option<String>,
    pub cjk: Option<String>,
    /// 半磅
    pub size: Option<u32>,
    /// (值, 规则)：auto 时 240 = 单倍；exact 时为缇
    pub line: Option<(u32, String)>,
    /// 百分之一字符：200 = 2 字符
    pub indent_chars: Option<u32>,
    pub before: Option<u32>,
    pub after: Option<u32>,
    /// left / center / right / both
    pub align: Option<String>,
    pub headings: Vec<HeadingStyle>,
}

const PPR: &[&str] = &[
    "w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr", "w:widowControl", "w:numPr", "w:suppressLineNumbers",
    "w:pBdr", "w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap", "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE",
    "w:autoSpaceDN", "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing", "w:mirrorIndents",
    "w:suppressOverlap", "w:jc", "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle",
    "w:rPr", "w:sectPr", "w:pPrChange",
];
const RPR: &[&str] = &[
    "w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps", "w:strike", "w:dstrike", "w:outline", "w:shadow",
    "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden", "w:color", "w:spacing", "w:w", "w:kern", "w:position",
    "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect", "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang",
    "w:eastAsianLayout", "w:specVanish", "w:oMath",
];
const STYLE: &[&str] = &[
    "w:name", "w:aliases", "w:basedOn", "w:next", "w:link", "w:autoRedefine", "w:hidden", "w:uiPriority", "w:semiHidden",
    "w:unhideWhenUsed", "w:qFormat", "w:locked", "w:personal", "w:personalCompose", "w:personalReply", "w:rsid", "w:pPr", "w:rPr",
    "w:tblPr", "w:trPr", "w:tcPr", "w:tblStylePr",
];
const SECT: &[&str] = &[
    "w:headerReference", "w:footerReference", "w:footnotePr", "w:endnotePr", "w:type", "w:pgSz", "w:pgMar", "w:paperSrc", "w:pgBorders",
    "w:lnNumType", "w:pgNumType", "w:cols", "w:formProt", "w:vAlign", "w:noEndnote", "w:titlePg", "w:textDirection", "w:bidi",
    "w:rtlGutter", "w:docGrid", "w:printerSettings", "w:sectPrChange",
];

/// 按样式 id 或样式名（不区分大小写）找段落样式；用户自己的参考文档里，标题样式的 id 可能是 “1” 这类本地化的值
fn find_style<'a>(root: &'a mut El, id: &str, name: &str) -> Option<&'a mut El> {
    let by_id = root.elements().position(|e| e.name == "w:style" && e.attr("w:styleId") == Some(id));
    let idx = by_id.or_else(|| {
        root.elements().position(|e| {
            e.name == "w:style" && e.child("w:name").and_then(|n| n.attr("w:val")).map_or(false, |v| v.eq_ignore_ascii_case(name))
        })
    })?;
    root.elements_mut().nth(idx)
}

fn style_mut<'a>(root: &'a mut El, id: &str, name: &str, based_on: &str) -> &'a mut El {
    if find_style(root, id, name).is_none() {
        let mut s = El::with("w:style", &[("w:type", "paragraph"), ("w:customStyle", "1"), ("w:styleId", id)]);
        s.children.push(Node::El(El::with("w:name", &[("w:val", name)])));
        s.children.push(Node::El(El::with("w:basedOn", &[("w:val", based_on)])));
        s.children.push(Node::El(El::with("w:qFormat", &[])));
        root.children.push(Node::El(s));
    }
    find_style(root, id, name).unwrap()
}

fn set_fonts(rpr: &mut El, latin: Option<&str>, cjk: Option<&str>) {
    if latin.is_none() && cjk.is_none() {
        return;
    }
    let f = rpr.ensure("w:rFonts", RPR);
    if let Some(l) = latin {
        for a in ["w:asciiTheme", "w:hAnsiTheme"] {
            f.remove_attr(a);
        }
        f.set("w:ascii", l);
        f.set("w:hAnsi", l);
    }
    if let Some(c) = cjk {
        f.remove_attr("w:eastAsiaTheme");
        f.set("w:eastAsia", c);
    }
}

fn set_size(rpr: &mut El, hp: u32) {
    rpr.ensure("w:sz", RPR).set("w:val", &hp.to_string());
    rpr.ensure("w:szCs", RPR).set("w:val", &hp.to_string());
}

fn set_indent(ppr: &mut El, chars: u32, size_hp: u32) {
    let ind = ppr.ensure("w:ind", PPR);
    ind.remove_attr("w:hanging");
    ind.remove_attr("w:hangingChars");
    ind.set("w:firstLineChars", &chars.to_string());
    // 不认 firstLineChars 的软件按绝对值缩进：字符数 × 字号
    ind.set("w:firstLine", &(chars * size_hp / 10).to_string());
}

pub fn patch_styles(src: &str, st: &DocxStyle) -> Result<String, String> {
    let mut doc = xml::parse(src)?;
    let root = &mut doc.root;
    let size = st.size.unwrap_or(21);

    // 全文默认：字体、字号、中文语言
    {
        let dd = root.ensure("w:docDefaults", &["w:docDefaults", "w:latentStyles", "w:style"]);
        let rpr = dd.ensure("w:rPrDefault", &["w:rPrDefault", "w:pPrDefault"]).ensure("w:rPr", &[]);
        set_fonts(rpr, st.latin.as_deref(), st.cjk.as_deref());
        if let Some(s) = st.size {
            set_size(rpr, s);
        }
        rpr.ensure("w:lang", RPR).set("w:eastAsia", "zh-CN");
    }
    // Normal 也写一份：有些参考文档在 Normal 里覆盖了默认字体
    {
        let normal = style_mut(root, "Normal", "Normal", "Normal");
        normal.remove_children("w:basedOn");
        if st.latin.is_some() || st.cjk.is_some() || st.size.is_some() {
            let rpr = normal.ensure("w:rPr", STYLE);
            set_fonts(rpr, st.latin.as_deref(), st.cjk.as_deref());
            if let Some(s) = st.size {
                set_size(rpr, s);
            }
        }
        if let Some((v, rule)) = &st.line {
            let sp = normal.ensure("w:pPr", STYLE).ensure("w:spacing", PPR);
            sp.set("w:line", &v.to_string());
            sp.set("w:lineRule", rule);
        }
    }
    // 正文段落
    {
        let body = style_mut(root, "BodyText", "Body Text", "Normal");
        let ppr = body.ensure("w:pPr", STYLE);
        if st.before.is_some() || st.after.is_some() {
            let sp = ppr.ensure("w:spacing", PPR);
            if let Some(b) = st.before {
                sp.set("w:before", &b.to_string());
                sp.remove_attr("w:beforeLines");
            }
            if let Some(a) = st.after {
                sp.set("w:after", &a.to_string());
                sp.remove_attr("w:afterLines");
            }
        }
        if let Some(c) = st.indent_chars {
            set_indent(ppr, c, size);
        }
        if let Some(j) = &st.align {
            ppr.ensure("w:jc", PPR).set("w:val", j);
        }
    }
    // 列表、引用、图片、题注、参考文献都基于正文，不要首行缩进
    if st.indent_chars.is_some() {
        for (id, name) in [
            ("Compact", "Compact"), ("BlockText", "Block Text"), ("Figure", "Figure"), ("CaptionedFigure", "Captioned Figure"),
            ("ImageCaption", "Image Caption"), ("TableCaption", "Table Caption"), ("Caption", "caption"), ("Bibliography", "Bibliography"),
        ] {
            if let Some(s) = find_style(root, id, name) {
                let ind = s.ensure("w:pPr", STYLE).ensure("w:ind", PPR);
                ind.set("w:firstLineChars", "0");
                ind.set("w:firstLine", "0");
            }
        }
    }
    // 标题
    for h in &st.headings {
        let id = format!("Heading{}", h.level);
        let s = style_mut(root, &id, &format!("heading {}", h.level), "Normal");
        {
            let ppr = s.ensure("w:pPr", STYLE);
            if h.before.is_some() || h.after.is_some() {
                let sp = ppr.ensure("w:spacing", PPR);
                if let Some(b) = h.before {
                    sp.set("w:before", &b.to_string());
                    sp.remove_attr("w:beforeLines");
                }
                if let Some(a) = h.after {
                    sp.set("w:after", &a.to_string());
                    sp.remove_attr("w:afterLines");
                }
            }
            if let Some(j) = &h.align {
                ppr.ensure("w:jc", PPR).set("w:val", j);
            }
            // 标题不缩进
            if st.indent_chars.is_some() {
                let ind = ppr.ensure("w:ind", PPR);
                ind.set("w:firstLineChars", "0");
                ind.set("w:firstLine", "0");
            }
        }
        let rpr = s.ensure("w:rPr", STYLE);
        set_fonts(rpr, h.latin.as_deref(), h.cjk.as_deref());
        if let Some(sz) = h.size {
            set_size(rpr, sz);
        }
        if let Some(b) = h.bold {
            let v = if b { "1" } else { "0" };
            rpr.ensure("w:b", RPR).set("w:val", v);
            rpr.ensure("w:bCs", RPR).set("w:val", v);
        }
        if h.black {
            let c = rpr.ensure("w:color", RPR);
            c.attrs.clear();
            c.set("w:val", "000000");
        }
    }
    Ok(xml::write(&doc))
}

/// 页眉页脚里的一段：{页码} {总页数} 变成 Word 域，{标题} 换成标题文字
fn hf_paragraph(hf: &HeaderFooter, title: &str) -> String {
    let jc = match hf.align.as_str() {
        "left" => "left",
        "right" => "right",
        _ => "center",
    };
    let mut runs = String::new();
    let rpr = "<w:rPr><w:sz w:val=\"18\"/><w:szCs w:val=\"18\"/></w:rPr>";
    let text = hf.text.replace("{标题}", title);
    let mut rest = text.as_str();
    let run_text = |t: &str| format!("<w:r>{}<w:t xml:space=\"preserve\">{}</w:t></w:r>", rpr, xml::escape(t));
    let field = |code: &str| {
        format!(
            "<w:r>{r}<w:fldChar w:fldCharType=\"begin\"/></w:r><w:r>{r}<w:instrText xml:space=\"preserve\"> {c} </w:instrText></w:r><w:r>{r}<w:fldChar w:fldCharType=\"separate\"/></w:r><w:r>{r}<w:t>1</w:t></w:r><w:r>{r}<w:fldChar w:fldCharType=\"end\"/></w:r>",
            r = rpr,
            c = code
        )
    };
    loop {
        let a = rest.find("{页码}");
        let b = rest.find("{总页数}");
        let next = match (a, b) {
            (Some(x), Some(y)) => Some(if x < y { (x, "{页码}", "PAGE") } else { (y, "{总页数}", "NUMPAGES") }),
            (Some(x), None) => Some((x, "{页码}", "PAGE")),
            (None, Some(y)) => Some((y, "{总页数}", "NUMPAGES")),
            _ => None,
        };
        match next {
            Some((i, tok, code)) => {
                if i > 0 {
                    runs.push_str(&run_text(&rest[..i]));
                }
                runs.push_str(&field(code));
                rest = &rest[i + tok.len()..];
            }
            None => {
                if !rest.is_empty() {
                    runs.push_str(&run_text(rest));
                }
                break;
            }
        }
    }
    format!("<w:p><w:pPr><w:jc w:val=\"{}\"/></w:pPr>{}</w:p>", jc, runs)
}

const NS: &str = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"";
const REL_HEADER: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const REL_FOOTER: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";

/// 改写参考文档：样式、纸张、页边距、页眉页脚。返回新的 docx 字节。
pub fn patch_reference(src: &[u8], st: &DocxStyle) -> Result<Vec<u8>, String> {
    let mut zin = zip::ZipArchive::new(std::io::Cursor::new(src)).map_err(|e| format!("参考文档不是有效的 Word 文件：{e}"))?;
    let mut files: Vec<(String, Vec<u8>)> = vec![];
    for i in 0..zin.len() {
        let mut f = zin.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let mut buf = vec![];
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        files.push((f.name().to_string(), buf));
    }
    let get = |files: &Vec<(String, Vec<u8>)>, name: &str| files.iter().find(|(n, _)| n == name).map(|(_, b)| String::from_utf8_lossy(b).to_string());
    let put = |files: &mut Vec<(String, Vec<u8>)>, name: &str, data: String| match files.iter_mut().find(|(n, _)| n == name) {
        Some(f) => f.1 = data.into_bytes(),
        None => files.push((name.to_string(), data.into_bytes())),
    };

    let styles = get(&files, "word/styles.xml").ok_or("参考文档里没有样式表")?;
    put(&mut files, "word/styles.xml", patch_styles(&styles, st)?);

    let mut types = get(&files, "[Content_Types].xml").ok_or("参考文档缺少 [Content_Types].xml")?;
    // .dotx 模板当文档用
    types = types.replace("wordprocessingml.template.main+xml", "wordprocessingml.document.main+xml");
    let mut rels = get(&files, "word/_rels/document.xml.rels").unwrap_or_else(|| {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>".into()
    });

    let docxml = get(&files, "word/document.xml").ok_or("参考文档里没有正文")?;
    let mut doc = xml::parse(&docxml)?;
    let body = doc.root.child_mut("w:body").ok_or("参考文档的正文格式不对")?;
    // 用最后一个 sectPr（整篇的页面设置）
    if !body.elements().any(|e| e.name == "w:sectPr") {
        body.children.push(Node::El(El::new("w:sectPr")));
    }
    let sect = body.elements_mut().filter(|e| e.name == "w:sectPr").last().unwrap();
    if let Some((w, h)) = st.page {
        let pg = sect.ensure("w:pgSz", SECT);
        pg.set("w:w", &w.to_string());
        pg.set("w:h", &h.to_string());
        if w > h {
            pg.set("w:orient", "landscape");
        } else {
            pg.remove_attr("w:orient");
        }
    }
    if st.margins.iter().any(|m| m.is_some()) {
        let mar = sect.ensure("w:pgMar", SECT);
        for (i, k) in ["w:top", "w:bottom", "w:left", "w:right"].iter().enumerate() {
            if let Some(v) = st.margins[i] {
                mar.set(k, &v.to_string());
            }
        }
        for (k, v) in [("w:header", "851"), ("w:footer", "992"), ("w:gutter", "0")] {
            if mar.attr(k).is_none() {
                mar.set(k, v);
            }
        }
        for k in ["w:top", "w:bottom", "w:left", "w:right"] {
            if mar.attr(k).is_none() {
                mar.set(k, if k == "w:top" || k == "w:bottom" { "1440" } else { "1800" });
            }
        }
    }
    for (kind, hf, tag, rel, part, rid) in [
        ("header", &st.header, "w:hdr", REL_HEADER, "headerHM.xml", "rIdHMHeader"),
        ("footer", &st.footer, "w:ftr", REL_FOOTER, "footerHM.xml", "rIdHMFooter"),
    ] {
        let Some(hf) = hf else { continue };
        // 换掉参考文档原有的这一类页眉（页脚）引用
        let refname = format!("w:{}Reference", kind);
        sect.remove_children(&refname);
        if hf.text.trim().is_empty() {
            continue;
        }
        let mut r = El::with(&refname, &[("w:type", "default"), ("r:id", rid)]);
        r.children.clear();
        let at = sect.children.iter().position(|n| matches!(n, Node::El(e) if !e.name.ends_with("Reference"))).unwrap_or(sect.children.len());
        sect.children.insert(at, Node::El(r));
        let xmlpart = format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><{tag} {NS}>{}</{tag}>", hf_paragraph(hf, &st.title));
        put(&mut files, &format!("word/{part}"), xmlpart);
        if !rels.contains(&format!("Id=\"{rid}\"")) {
            rels = rels.replace("</Relationships>", &format!("<Relationship Id=\"{rid}\" Type=\"{rel}\" Target=\"{part}\"/></Relationships>"));
        }
        let ct = format!("<Override PartName=\"/word/{part}\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml\"/>");
        if !types.contains(&format!("/word/{part}\"")) {
            types = types.replace("</Types>", &format!("{ct}</Types>"));
        }
    }
    // 根元素要声明 r: 命名空间，页眉页脚引用才有效
    if doc.root.attr("xmlns:r").is_none() {
        doc.root.attrs.push(("xmlns:r".into(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships".into()));
    }
    put(&mut files, "word/document.xml", xml::write(&doc));
    put(&mut files, "word/_rels/document.xml.rels", rels);
    put(&mut files, "[Content_Types].xml", types);

    let mut out = std::io::Cursor::new(Vec::new());
    {
        let mut zw = zip::ZipWriter::new(&mut out);
        let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        // [Content_Types].xml 放在第一个
        files.sort_by_key(|(n, _)| n != "[Content_Types].xml");
        for (n, b) in &files {
            zw.start_file(n.as_str(), opt).map_err(|e| e.to_string())?;
            zw.write_all(b).map_err(|e| e.to_string())?;
        }
        zw.finish().map_err(|e| e.to_string())?;
    }
    Ok(out.into_inner())
}

/* ---------------- 从参考文档读样式，填进导出选项 ---------------- */

/// 读出来的值用界面上的单位：毫米、厘米、磅、字符
#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RefHeading {
    pub font: Option<String>,
    pub size: Option<String>,
    pub bold: Option<bool>,
    pub align: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RefStyles {
    pub page_mm: Option<(String, String)>,
    pub margins_cm: [Option<String>; 4],
    pub cjk: Option<String>,
    pub latin: Option<String>,
    pub size: Option<String>,
    /// ("multi", "1.5") 或 ("fixed", "20")
    pub line: Option<(String, String)>,
    pub indent: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
    pub align: Option<String>,
    pub headings: Vec<RefHeading>,
}

fn num(v: f64) -> String {
    let s = format!("{:.2}", v);
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// 主题字体：样式里常写 w:eastAsiaTheme="minorEastAsia" 而不是具体字体名，真正的名字在 theme1.xml 里
#[derive(Default, Debug)]
pub struct ThemeFonts {
    major_latin: Option<String>,
    major_ea: Option<String>,
    minor_latin: Option<String>,
    minor_ea: Option<String>,
}

pub fn read_theme(theme: &str) -> ThemeFonts {
    let Ok(doc) = xml::parse(theme) else { return ThemeFonts::default() };
    let scheme = doc.root.find(&|e| e.name == "a:fontScheme");
    let pick = |kind: &str| -> (Option<String>, Option<String>) {
        let Some(f) = scheme.and_then(|s| s.child(kind)) else { return (None, None) };
        let tf = |e: Option<&El>| e.and_then(|x| x.attr("typeface")).map(xml::unescape).filter(|v| !v.is_empty());
        let latin = tf(f.child("a:latin"));
        // a:ea 常常是空的，简体中文的字体写在 <a:font script="Hans"> 里
        let ea = tf(f.child("a:ea")).or_else(|| tf(f.elements().find(|e| e.name == "a:font" && e.attr("script") == Some("Hans"))));
        (latin, ea)
    };
    let (major_latin, major_ea) = pick("a:majorFont");
    let (minor_latin, minor_ea) = pick("a:minorFont");
    ThemeFonts { major_latin, major_ea, minor_latin, minor_ea }
}

impl ThemeFonts {
    fn resolve(&self, theme: &str) -> Option<String> {
        match theme {
            "majorEastAsia" => self.major_ea.clone(),
            "minorEastAsia" => self.minor_ea.clone(),
            "majorHAnsi" | "majorAscii" => self.major_latin.clone(),
            "minorHAnsi" | "minorAscii" => self.minor_latin.clone(),
            _ => None,
        }
    }
}

/// 一个样式自己写明的字符格式；后读到的覆盖先读到的，所以要从最底层的样式往上读
#[derive(Default, Clone, Debug)]
struct Run {
    latin: Option<String>,
    cjk: Option<String>,
    size: Option<String>,
    bold: Option<bool>,
}

fn read_rpr(rpr: Option<&El>, theme: &ThemeFonts, r: &mut Run) {
    let Some(rpr) = rpr else { return };
    if let Some(f) = rpr.child("w:rFonts") {
        // Word 里主题字体优先于直接写的字体名
        if let Some(v) = f.attr("w:eastAsiaTheme").and_then(|t| theme.resolve(t)).or_else(|| f.attr("w:eastAsia").map(xml::unescape)) {
            r.cjk = Some(v);
        }
        if let Some(v) = f.attr("w:asciiTheme").and_then(|t| theme.resolve(t)).or_else(|| f.attr("w:ascii").map(xml::unescape)) {
            r.latin = Some(v);
        }
    }
    if let Some(v) = rpr.child("w:sz").and_then(|e| e.attr("w:val")).and_then(|v| v.parse::<f64>().ok()) {
        r.size = Some(num(v / 2.0));
    }
    if let Some(b) = rpr.child("w:b") {
        r.bold = Some(!matches!(b.attr("w:val"), Some("0") | Some("false")));
    }
}

fn read_spacing(ppr: Option<&El>, before: &mut Option<String>, after: &mut Option<String>) {
    let Some(sp) = ppr.and_then(|p| p.child("w:spacing")) else { return };
    if let Some(v) = sp.attr("w:before").and_then(|v| v.parse::<f64>().ok()) {
        *before = Some(num(v / 20.0));
    }
    if let Some(v) = sp.attr("w:after").and_then(|v| v.parse::<f64>().ok()) {
        *after = Some(num(v / 20.0));
    }
}

fn jc_to_ui(v: &str) -> Option<String> {
    Some(match v {
        "both" | "distribute" => "justify",
        "left" | "start" => "left",
        "center" => "center",
        "right" | "end" => "right",
        _ => return None,
    }
    .to_string())
}

/// 从最底层的基础样式到这个样式本身（沿 w:basedOn 往上找，最多 12 层，防止循环）
fn style_chain<'a>(root: &'a El, s: &'a El) -> Vec<&'a El> {
    let by_id = |id: &str| root.elements().find(|e| e.name == "w:style" && e.attr("w:styleId") == Some(id));
    let mut out = vec![s];
    let mut cur = s;
    while out.len() < 12 {
        let Some(base) = cur.child("w:basedOn").and_then(|b| b.attr("w:val")).and_then(by_id) else { break };
        if out.iter().any(|x| std::ptr::eq(*x, base)) {
            break;
        }
        out.push(base);
        cur = base;
    }
    out.reverse();
    out
}

pub fn read_styles(styles: &str, document: Option<&str>) -> Result<RefStyles, String> {
    read_styles_with_theme(styles, document, &ThemeFonts::default())
}

pub fn read_styles_with_theme(styles: &str, document: Option<&str>, theme: &ThemeFonts) -> Result<RefStyles, String> {
    let doc = xml::parse(styles)?;
    let root = &doc.root;
    let mut r = RefStyles::default();
    let by = |id: &str, name: &str| {
        root.elements().find(|e| e.name == "w:style" && e.attr("w:styleId") == Some(id)).or_else(|| {
            root.elements().find(|e| e.name == "w:style" && e.child("w:name").and_then(|n| n.attr("w:val")).map_or(false, |v| v.eq_ignore_ascii_case(name)))
        })
    };
    // 全文默认 → Normal → Body Text（Pandoc 正文段落用 Body Text，它通常基于 Normal）
    let mut base = Run::default();
    if let Some(dd) = root.child("w:docDefaults") {
        read_rpr(dd.child("w:rPrDefault").and_then(|x| x.child("w:rPr")), theme, &mut base);
    }
    let body_chain = by("BodyText", "Body Text").or_else(|| by("Normal", "Normal")).map(|s| style_chain(root, s)).unwrap_or_default();
    let mut body = base.clone();
    for s in &body_chain {
        read_rpr(s.child("w:rPr"), theme, &mut body);
        let ppr = s.child("w:pPr");
        read_spacing(ppr, &mut r.before, &mut r.after);
        if let Some(sp) = ppr.and_then(|p| p.child("w:spacing")) {
            if let Some(v) = sp.attr("w:line").and_then(|v| v.parse::<f64>().ok()) {
                r.line = Some(match sp.attr("w:lineRule") {
                    Some("exact") | Some("atLeast") => ("fixed".into(), num(v / 20.0)),
                    _ => ("multi".into(), num(v / 240.0)),
                });
            }
        }
        if let Some(ind) = ppr.and_then(|p| p.child("w:ind")) {
            if let Some(v) = ind.attr("w:firstLineChars").and_then(|v| v.parse::<f64>().ok()) {
                r.indent = Some(num(v / 100.0));
            } else if ind.attr("w:hanging").is_some() || ind.attr("w:hangingChars").is_some() {
                r.indent = Some("0".into());
            }
        }
        if let Some(j) = ppr.and_then(|p| p.child("w:jc")).and_then(|j| j.attr("w:val")) {
            r.align = jc_to_ui(j);
        }
    }
    r.latin = body.latin.clone();
    r.cjk = body.cjk.clone();
    r.size = body.size.clone();
    // 标题：各级标题常常是「标题 2 基于 标题 1」，没写的属性要从上一级继承过来才是 Word 里看到的样子
    for lv in 1..=3 {
        let mut h = RefHeading::default();
        if let Some(s) = by(&format!("Heading{lv}"), &format!("heading {lv}")) {
            let mut run = base.clone();
            for st in style_chain(root, s) {
                read_rpr(st.child("w:rPr"), theme, &mut run);
                read_spacing(st.child("w:pPr"), &mut h.before, &mut h.after);
                if let Some(j) = st.child("w:pPr").and_then(|p| p.child("w:jc")).and_then(|j| j.attr("w:val")) {
                    h.align = jc_to_ui(j);
                }
            }
            // 和正文一样的字体不算标题自己的设置（界面上显示「同正文」）
            let font = run.cjk.clone().or(run.latin.clone());
            h.font = if font.is_some() && font == body.cjk.clone().or(body.latin.clone()) { None } else { font };
            h.size = run.size;
            h.bold = run.bold;
        }
        r.headings.push(h);
    }
    if let Some(d) = document {
        let d = xml::parse(d)?;
        if let Some(sect) = d.root.child("w:body").and_then(|b| b.elements().filter(|e| e.name == "w:sectPr").last()) {
            if let Some(pg) = sect.child("w:pgSz") {
                if let (Some(w), Some(h)) = (pg.attr("w:w").and_then(|v| v.parse::<f64>().ok()), pg.attr("w:h").and_then(|v| v.parse::<f64>().ok())) {
                    r.page_mm = Some((num((w / 56.6929).round()), num((h / 56.6929).round())));
                }
            }
            if let Some(m) = sect.child("w:pgMar") {
                for (i, k) in ["w:top", "w:bottom", "w:left", "w:right"].iter().enumerate() {
                    r.margins_cm[i] = m.attr(k).and_then(|v| v.parse::<f64>().ok()).map(|v| num(v / 567.0));
                }
            }
        }
    }
    Ok(r)
}

pub fn read_reference(path: &Path) -> Result<RefStyles, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| format!("不是有效的 Word 文件：{e}"))?;
    let mut read = |name: &str| -> Option<String> {
        let mut f = z.by_name(name).ok()?;
        let mut s = String::new();
        f.read_to_string(&mut s).ok()?;
        Some(s)
    };
    let styles = read("word/styles.xml").ok_or("这个文件里没有样式表")?;
    let document = read("word/document.xml");
    let theme = read("word/theme/theme1.xml").map(|t| read_theme(&t)).unwrap_or_default();
    read_styles_with_theme(&styles, document.as_deref(), &theme)
}

/* ---------------- 导出 ---------------- */

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub name: String,
    /// base64
    pub data: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    /// docx / pdf
    pub format: String,
    /// 已经处理过的 Markdown（批注、编号、图片路径、图表）
    pub markdown: String,
    pub output: String,
    /// 文件夹里的 .holymark/export
    pub defaults_dir: String,
    pub defaults_name: String,
    pub defaults_yaml: String,
    pub reference_doc: Option<String>,
    pub docx_style: Option<DocxStyle>,
    pub typst_template: Option<String>,
    pub assets: Vec<Asset>,
    pub extra_args: Vec<String>,
}

#[derive(Serialize, Debug)]
pub struct ExportResult {
    pub output: String,
    pub warnings: String,
}

fn temp_dir() -> Result<PathBuf, String> {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let d = std::env::temp_dir().join(format!("holymark-export-{}-{}", std::process::id(), nanos));
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// 去掉对用户没有意义的提示：Pandoc 没有中文界面词的翻译文件，每次都会提醒
fn clean_warnings(s: &str) -> String {
    let mut out = vec![];
    let mut skip_next = false;
    for l in s.lines() {
        if skip_next && l.starts_with("  ") {
            continue;
        }
        skip_next = false;
        if l.contains("Could not load translations") {
            skip_next = true;
            continue;
        }
        if l.contains("has no translation defined") || l.trim().is_empty() {
            continue;
        }
        out.push(l);
    }
    out.join("\n")
}

/// 从 Finder 启动的应用没有 LANG，Pandoc 会按 ASCII 处理文件名，中文路径直接报错
fn utf8_env(cmd: &mut Command) {
    #[cfg(target_os = "macos")]
    let loc = "en_US.UTF-8";
    #[cfg(not(target_os = "macos"))]
    let loc = "C.UTF-8";
    cmd.env("LANG", loc).env("LC_ALL", loc);
}

/// Pandoc 自带的默认参考文档
fn pandoc_default_reference(pandoc: &Path, dir: &Path) -> Result<Vec<u8>, String> {
    let p = dir.join("pandoc-default.docx");
    let mut cmd = command(pandoc);
    utf8_env(&mut cmd);
    let out = cmd.args(["-o"]).arg(&p).args(["--print-default-data-file", "reference.docx"]).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    std::fs::read(&p).map_err(|e| e.to_string())
}

/// 导出的几个阶段，前端据此显示进度：style（写版式与配置）→ pandoc（转换）→ typst（PDF 排版）→ write（写入目标文件）
pub fn run(job: ExportJob, progress: &dyn Fn(&str)) -> Result<ExportResult, String> {
    use base64::Engine;
    let pandoc = find_tool("pandoc").ok_or("没有找到 Pandoc")?;
    let ddir = PathBuf::from(&job.defaults_dir);
    std::fs::create_dir_all(&ddir).map_err(|e| format!("无法创建 {}：{e}", ddir.display()))?;
    let tmp = temp_dir()?;
    let result = (|| -> Result<ExportResult, String> {
        // 1. 参考文档或模板，和 defaults 文件放在一起
        progress("style");
        if job.format == "docx" {
            let src = match &job.reference_doc {
                Some(p) if !p.is_empty() => std::fs::read(p).map_err(|e| format!("读不到参考文档 {p}：{e}"))?,
                _ => pandoc_default_reference(&pandoc, &tmp)?,
            };
            let st = job.docx_style.clone().unwrap_or_default();
            std::fs::write(ddir.join("word-reference.docx"), patch_reference(&src, &st)?).map_err(|e| e.to_string())?;
        }
        if let Some(t) = &job.typst_template {
            std::fs::write(ddir.join("pdf-template.typst"), t).map_err(|e| e.to_string())?;
        }
        let defaults = ddir.join(&job.defaults_name);
        std::fs::write(&defaults, &job.defaults_yaml).map_err(|e| e.to_string())?;

        // 2. 图表等临时图片
        for a in &job.assets {
            let bytes = base64::engine::general_purpose::STANDARD.decode(a.data.as_bytes()).map_err(|e| e.to_string())?;
            std::fs::write(tmp.join(&a.name), bytes).map_err(|e| e.to_string())?;
        }
        // 图表图片已经写在临时目录里；本地图片也复制进来。引用都改成相对文件名，Pandoc 和 Typst 都在临时目录里运行
        let md = localize_images(&job.markdown.replace("hm-asset:", ""), &tmp);
        let input = tmp.join("input.md");
        std::fs::write(&input, md).map_err(|e| e.to_string())?;

        // 3. 先导出到临时文件，成功后再替换目标，避免导出失败把旧文件弄坏
        let ext = Path::new(&job.output).extension().and_then(|e| e.to_str()).unwrap_or("out").to_string();
        let staged = tmp.join(format!("output.{ext}"));
        // PDF 分两步：Pandoc 生成 Typst 源文件，再由 Typst 排版。
        // 让 Pandoc 自己调 Typst 时，给它完整路径它会误判输出格式；两步走报错也更清楚
        let pdf = job.format == "pdf";
        progress("pandoc");
        let pandoc_out = if pdf { tmp.join("output.typ") } else { staged.clone() };
        let mut cmd = command(&pandoc);
        utf8_env(&mut cmd);
        cmd.arg("-d").arg(&defaults).arg(&input).arg("-o").arg(&pandoc_out);
        cmd.args(&job.extra_args);
        // Pandoc 把中间文件写在当前目录，放到临时目录里，不弄脏用户的文件夹
        cmd.current_dir(&tmp);
        let out = cmd.output().map_err(|e| format!("无法运行 Pandoc：{e}"))?;
        let mut warnings = clean_warnings(&String::from_utf8_lossy(&out.stderr));
        if !out.status.success() {
            return Err(if warnings.is_empty() { "Pandoc 导出失败".into() } else { warnings });
        }
        if pdf {
            progress("typst");
            let typst = find_tool("typst").ok_or("没有找到 Typst")?;
            let mut t = command(&typst);
            utf8_env(&mut t);
            // 图片都在临时目录里（相对路径），Typst 默认以输入文件所在的目录为根，正好
            t.arg("compile").arg(&pandoc_out).arg(&staged).current_dir(&tmp);
            let out = t.output().map_err(|e| format!("无法运行 Typst：{e}"))?;
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if !out.status.success() {
                return Err(if err.is_empty() { "Typst 排版失败".into() } else { err });
            }
            if !err.is_empty() {
                warnings = [warnings, err].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join("\n");
            }
        }
        progress("write");
        std::fs::copy(&staged, &job.output).map_err(|e| format!("无法写入 {}：{e}", job.output))?;
        Ok(ExportResult { output: job.output.clone(), warnings })
    })();
    if std::env::var_os("HM_KEEP_EXPORT_TMP").is_none() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    result
}

/// 交给 Pandoc 的 Markdown 里，本地图片写成 `<hm-file:绝对路径>`：复制进临时目录，引用换成相对文件名。
/// 同一张图只复制一次；复制失败（比如文件不存在）就留下原路径，让 Pandoc / Typst 报出是哪张图。
fn localize_images(md: &str, tmp: &Path) -> String {
    const MARK: &str = "hm-file:";
    let mut out = String::with_capacity(md.len());
    let mut copied: std::collections::HashMap<String, String> = Default::default();
    let mut rest = md;
    while let Some(i) = rest.find(MARK) {
        out.push_str(&rest[..i]);
        let after = &rest[i + MARK.len()..];
        let end = after.find('>').unwrap_or(after.len());
        let src = &after[..end];
        let name = match copied.get(src) {
            Some(n) => n.clone(),
            None => {
                let ext = Path::new(src).extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
                let name = format!("hm-image-{}{ext}", copied.len() + 1);
                let n = if std::fs::copy(src, tmp.join(&name)).is_ok() { name } else { src.to_string() };
                copied.insert(src.to_string(), n.clone());
                n
            }
        };
        out.push_str(&name);
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// 用系统默认的程序打开（导出完成后「打开文件」）
pub fn open_path(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let r = Command::new("open").arg(path).spawn();
    // explorer 打开文件时交给默认程序；它本身是图形程序，不会弹控制台
    #[cfg(target_os = "windows")]
    let r = Command::new("explorer").arg(path.replace('/', "\\")).spawn();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let r = Command::new("xdg-open").arg(path).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// 在 Finder 里显示
pub fn reveal(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let r = Command::new("open").args(["-R", path]).spawn();
    #[cfg(target_os = "windows")]
    let r = Command::new("explorer").arg(format!("/select,{}", path.replace('/', "\\"))).spawn();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let r = Command::new("xdg-open").arg(Path::new(path).parent().unwrap_or(Path::new("/"))).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="180" w:after="180"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:customStyle="1" w:styleId="Compact"><w:name w:val="Compact"/><w:basedOn w:val="BodyText"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:color w:val="0F4761" w:themeColor="accent1"/><w:sz w:val="40"/></w:rPr></w:style>
</w:styles>"#;

    fn style() -> DocxStyle {
        DocxStyle {
            latin: Some("Times New Roman".into()),
            cjk: Some("宋体".into()),
            size: Some(24),
            line: Some((360, "auto".into())),
            indent_chars: Some(200),
            before: Some(0),
            after: Some(0),
            align: Some("both".into()),
            headings: vec![HeadingStyle { level: 1, latin: Some("黑体".into()), cjk: Some("黑体".into()), size: Some(32), bold: Some(true), align: Some("center".into()), black: true, ..Default::default() }],
            ..Default::default()
        }
    }

    #[test]
    fn patches_styles_in_schema_order() {
        let out = patch_styles(STYLES, &style()).unwrap();
        assert!(out.contains(r#"<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>"#), "{out}");
        assert!(out.contains(r#"<w:spacing w:before="0" w:after="0"/><w:ind w:firstLineChars="200" w:firstLine="480"/><w:jc w:val="both"/>"#), "{out}");
        assert!(out.contains(r#"<w:spacing w:line="360" w:lineRule="auto"/>"#));
        // 标题：间距、对齐在 outlineLvl 之前；字体在颜色之前；颜色变黑
        assert!(out.contains(r#"<w:keepNext/><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>"#), "{out}");
        assert!(out.contains(r#"<w:rFonts w:ascii="黑体" w:hAnsi="黑体" w:eastAsia="黑体"/><w:b w:val="1"/><w:bCs w:val="1"/><w:color w:val="000000"/><w:sz w:val="32"/>"#), "{out}");
        // 列表不缩进
        assert!(out.contains(r#"<w:style w:type="paragraph" w:customStyle="1" w:styleId="Compact"><w:name w:val="Compact"/><w:basedOn w:val="BodyText"/><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr></w:style>"#), "{out}");
        // 读回来应当一致
        let r = read_styles(&out, None).unwrap();
        assert_eq!(r.cjk.as_deref(), Some("宋体"));
        assert_eq!(r.latin.as_deref(), Some("Times New Roman"));
        assert_eq!(r.size.as_deref(), Some("12"));
        assert_eq!(r.line, Some(("multi".into(), "1.5".into())));
        assert_eq!(r.indent.as_deref(), Some("2"));
        assert_eq!(r.align.as_deref(), Some("justify"));
        assert_eq!(r.headings[0].size.as_deref(), Some("16"));
        assert_eq!(r.headings[0].bold, Some(true));
        assert_eq!(r.headings[0].align.as_deref(), Some("center"));
    }

    #[test]
    fn reads_inherited_heading_styles_and_theme_fonts() {
        let styles = r#"<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200"/></w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/><w:basedOn w:val="1"/><w:pPr><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>"#;
        let theme = read_theme(r#"<a:theme xmlns:a="x"><a:themeElements><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:font script="Hans" typeface="等线 Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:font script="Jpan" typeface="游明朝"/><a:font script="Hans" typeface="等线"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>"#);
        let r = read_styles_with_theme(styles, None, &theme).unwrap();
        // 正文：没有 Body Text 时读 Normal；字体来自主题
        assert_eq!(r.cjk.as_deref(), Some("等线"));
        assert_eq!(r.latin.as_deref(), Some("Calibri"));
        assert_eq!(r.size.as_deref(), Some("12"));
        assert_eq!(r.line, Some(("multi".into(), "1.5".into())));
        assert_eq!(r.indent.as_deref(), Some("2"));
        // 二级标题基于一级：字体、加粗继承，字号和对齐用自己的
        assert_eq!(r.headings[0].font.as_deref(), Some("黑体"));
        assert_eq!(r.headings[1].font.as_deref(), Some("黑体"));
        assert_eq!(r.headings[1].bold, Some(true));
        assert_eq!(r.headings[1].size.as_deref(), Some("14"));
        assert_eq!(r.headings[1].align.as_deref(), Some("left"));
        assert_eq!(r.headings[2], RefHeading::default());
    }

    #[test]
    fn empty_style_changes_nothing_but_language() {
        let out = patch_styles(STYLES, &DocxStyle::default()).unwrap();
        assert!(out.contains(r#"<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:eastAsia="zh-CN"/>"#), "{out}");
        assert!(out.contains(r#"<w:color w:val="0F4761" w:themeColor="accent1"/>"#));
    }

    #[test]
    fn header_footer_fields() {
        let p = hf_paragraph(&HeaderFooter { text: "{标题} · 第 {页码} 页 / 共 {总页数} 页".into(), align: "right".into() }, "研究设计");
        assert!(p.starts_with(r#"<w:p><w:pPr><w:jc w:val="right"/></w:pPr>"#));
        assert!(p.contains("研究设计 · 第 </w:t>"));
        assert!(p.contains(" PAGE </w:instrText>"));
        assert!(p.contains(" NUMPAGES </w:instrText>"));
        assert!(p.contains("> 页</w:t>"));
    }

    #[test]
    fn localize_images_copies_once_and_keeps_missing() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("图 1.png");
        std::fs::write(&src, b"png").unwrap();
        let tmp = d.path().join("tmp");
        std::fs::create_dir(&tmp).unwrap();
        let s = src.to_string_lossy();
        let md = format!("![a](<hm-file:{s}>)\n\n![b](<hm-file:{s}>)\n\n![c](<hm-file:/没有/这张.png>)\n\n![m](mermaid-1.png)");
        let out = localize_images(&md, &tmp);
        assert_eq!(out, "![a](<hm-image-1.png>)\n\n![b](<hm-image-1.png>)\n\n![c](</没有/这张.png>)\n\n![m](mermaid-1.png)");
        assert_eq!(std::fs::read(tmp.join("hm-image-1.png")).unwrap(), b"png");
    }

    /// 端到端：HM_EXPORT_JOB 指向一个导出任务的 JSON，用真的 Pandoc / Typst 跑一遍
    #[test]
    #[ignore]
    fn e2e_from_env() {
        let Ok(p) = std::env::var("HM_EXPORT_JOB") else { return };
        let job: ExportJob = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
        let r = run(job, &|s| println!("stage {s}")).unwrap();
        println!("written {} warnings:\n{}", r.output, r.warnings);
    }
}
