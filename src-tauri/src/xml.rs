//! 极简 XML 树：只为改写 docx 里的 styles.xml、document.xml 这类文件。
//! 解析后原样保留文本、注释、声明和属性的写法，序列化回去与原文等价。
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    El(El),
    /// 文本、注释、处理指令等，原样保留
    Raw(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct El {
    pub name: String,
    /// 属性值保留转义后的原始写法
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
}

impl El {
    pub fn new(name: &str) -> El {
        El { name: name.into(), attrs: vec![], children: vec![] }
    }
    pub fn with(name: &str, attrs: &[(&str, &str)]) -> El {
        let mut e = El::new(name);
        for (k, v) in attrs {
            e.set(k, v);
        }
        e
    }
    pub fn attr(&self, k: &str) -> Option<&str> {
        self.attrs.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str())
    }
    /// 设置属性；值会被转义
    pub fn set(&mut self, k: &str, v: &str) {
        let v = escape(v);
        match self.attrs.iter_mut().find(|(a, _)| a == k) {
            Some(p) => p.1 = v,
            None => self.attrs.push((k.into(), v)),
        }
    }
    pub fn remove_attr(&mut self, k: &str) {
        self.attrs.retain(|(a, _)| a != k);
    }
    pub fn elements(&self) -> impl Iterator<Item = &El> {
        self.children.iter().filter_map(|n| if let Node::El(e) = n { Some(e) } else { None })
    }
    pub fn elements_mut(&mut self) -> impl Iterator<Item = &mut El> {
        self.children.iter_mut().filter_map(|n| if let Node::El(e) = n { Some(e) } else { None })
    }
    pub fn child(&self, name: &str) -> Option<&El> {
        self.elements().find(|e| e.name == name)
    }
    pub fn child_mut(&mut self, name: &str) -> Option<&mut El> {
        self.elements_mut().find(|e| e.name == name)
    }
    pub fn remove_children(&mut self, name: &str) {
        self.children.retain(|n| !matches!(n, Node::El(e) if e.name == name));
    }
    /// 取子元素，没有就按 order 给出的先后顺序插到合适的位置
    pub fn ensure(&mut self, name: &str, order: &[&str]) -> &mut El {
        if self.child(name).is_none() {
            let rank = |n: &str| order.iter().position(|o| *o == n);
            let me = rank(name);
            let at = match me {
                Some(r) => self
                    .children
                    .iter()
                    .position(|n| matches!(n, Node::El(e) if rank(&e.name).map_or(false, |x| x > r)))
                    .unwrap_or(self.children.len()),
                None => self.children.len(),
            };
            self.children.insert(at, Node::El(El::new(name)));
        }
        self.child_mut(name).unwrap()
    }
    /// 深度优先找第一个满足条件的元素
    pub fn find_mut(&mut self, f: &dyn Fn(&El) -> bool) -> Option<&mut El> {
        if f(self) {
            return Some(self);
        }
        for c in self.elements_mut() {
            if let Some(x) = c.find_mut(f) {
                return Some(x);
            }
        }
        None
    }
    pub fn find(&self, f: &dyn Fn(&El) -> bool) -> Option<&El> {
        if f(self) {
            return Some(self);
        }
        self.elements().find_map(|c| c.find(f))
    }
    /// 元素里所有文本（不解码实体，够用来读字体名、数字）
    pub fn text(&self) -> String {
        let mut s = String::new();
        for c in &self.children {
            match c {
                Node::Raw(r) if !r.starts_with('<') => s.push_str(r),
                Node::El(e) => s.push_str(&e.text()),
                _ => {}
            }
        }
        s
    }
}

pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}
pub fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// 文档：根元素前后的声明、注释原样保留
pub struct Doc {
    pub before: Vec<Node>,
    pub root: El,
    pub after: Vec<Node>,
}

pub fn parse(src: &str) -> Result<Doc, String> {
    let mut p = Parser { s: src, i: 0 };
    let mut before = vec![];
    loop {
        p.skip_ws_into(&mut before);
        if p.peek_str("<?") || p.peek_str("<!") {
            before.push(Node::Raw(p.raw_special()?));
        } else {
            break;
        }
    }
    let root = p.element()?;
    let after = vec![Node::Raw(p.s[p.i..].to_string())];
    Ok(Doc { before, root, after })
}

pub fn write(doc: &Doc) -> String {
    let mut out = String::new();
    for n in &doc.before {
        write_node(n, &mut out);
    }
    write_el(&doc.root, &mut out);
    for n in &doc.after {
        write_node(n, &mut out);
    }
    out
}

pub fn write_el(e: &El, out: &mut String) {
    out.push('<');
    out.push_str(&e.name);
    for (k, v) in &e.attrs {
        out.push_str(&format!(" {}=\"{}\"", k, v));
    }
    if e.children.is_empty() {
        out.push_str("/>");
        return;
    }
    out.push('>');
    for c in &e.children {
        write_node(c, out);
    }
    out.push_str(&format!("</{}>", e.name));
}

fn write_node(n: &Node, out: &mut String) {
    match n {
        Node::Raw(r) => out.push_str(r),
        Node::El(e) => write_el(e, out),
    }
}

struct Parser<'a> {
    s: &'a str,
    i: usize,
}

impl<'a> Parser<'a> {
    fn rest(&self) -> &'a str {
        &self.s[self.i..]
    }
    fn peek_str(&self, t: &str) -> bool {
        self.rest().starts_with(t)
    }
    fn skip_ws_into(&mut self, out: &mut Vec<Node>) {
        let r = self.rest();
        let n = r.len() - r.trim_start().len();
        if n > 0 {
            out.push(Node::Raw(r[..n].to_string()));
            self.i += n;
        }
    }
    fn raw_special(&mut self) -> Result<String, String> {
        let r = self.rest();
        let end = if r.starts_with("<!--") {
            r.find("-->").map(|x| x + 3)
        } else if r.starts_with("<![CDATA[") {
            r.find("]]>").map(|x| x + 3)
        } else if r.starts_with("<?") {
            r.find("?>").map(|x| x + 2)
        } else {
            r.find('>').map(|x| x + 1)
        }
        .ok_or("XML 不完整")?;
        self.i += end;
        Ok(r[..end].to_string())
    }
    fn element(&mut self) -> Result<El, String> {
        if !self.peek_str("<") {
            return Err(format!("位置 {} 处应为元素", self.i));
        }
        self.i += 1;
        let name = self.name();
        let mut e = El::new(&name);
        loop {
            self.ws();
            if self.peek_str("/>") {
                self.i += 2;
                return Ok(e);
            }
            if self.peek_str(">") {
                self.i += 1;
                break;
            }
            let k = self.name();
            if k.is_empty() {
                return Err(format!("位置 {} 处属性格式不对", self.i));
            }
            self.ws();
            if !self.peek_str("=") {
                return Err("属性缺少 =".into());
            }
            self.i += 1;
            self.ws();
            let q = self.rest().chars().next().ok_or("XML 不完整")?;
            if q != '"' && q != '\'' {
                return Err("属性值缺少引号".into());
            }
            self.i += 1;
            let end = self.rest().find(q).ok_or("属性值没有结束")?;
            let v = &self.rest()[..end];
            // 统一用双引号输出
            let v = if q == '\'' { v.replace('"', "&quot;") } else { v.to_string() };
            e.attrs.push((k, v));
            self.i += end + 1;
        }
        loop {
            let r = self.rest();
            if r.is_empty() {
                return Err(format!("元素 {} 没有结束", e.name));
            }
            if r.starts_with("</") {
                let end = r.find('>').ok_or("结束标签不完整")?;
                self.i += end + 1;
                return Ok(e);
            }
            if r.starts_with("<!") || r.starts_with("<?") {
                let raw = self.raw_special()?;
                e.children.push(Node::Raw(raw));
                continue;
            }
            if r.starts_with('<') {
                let c = self.element()?;
                e.children.push(Node::El(c));
                continue;
            }
            let end = r.find('<').unwrap_or(r.len());
            e.children.push(Node::Raw(r[..end].to_string()));
            self.i += end;
        }
    }
    fn name(&mut self) -> String {
        let r = self.rest();
        let end = r.find(|c: char| c.is_whitespace() || c == '>' || c == '/' || c == '=').unwrap_or(r.len());
        self.i += end;
        r[..end].to_string()
    }
    fn ws(&mut self) {
        let r = self.rest();
        self.i += r.len() - r.trim_start().len();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let src = "<?xml version=\"1.0\"?>\n<a x=\"1\" y='2'>\n  <!-- c --><b/>t&amp;x<c k=\"v\">in</c>\n</a>\n";
        let d = parse(src).unwrap();
        assert_eq!(write(&d), src.replace("y='2'", "y=\"2\""));
    }

    #[test]
    fn ensure_respects_order() {
        let mut e = parse("<p><a/><c/></p>").unwrap().root;
        e.ensure("b", &["a", "b", "c"]);
        e.ensure("d", &["a", "b", "c", "d"]);
        let mut s = String::new();
        write_el(&e, &mut s);
        assert_eq!(s, "<p><a/><b/><c/><d/></p>");
    }
}
