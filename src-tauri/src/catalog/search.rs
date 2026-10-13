//! Read-only metadata search. Ranking tiers follow match-sorter 8.3.0 (MIT),
//! adapted to Rust so the complete catalog never crosses the IPC boundary.
use super::entities::get;
use super::{err, ids, text, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::cmp::Ordering;

fn normalize(value: &str) -> String {
    value.chars().map(|c| match c as u32 {
        0x3000 => ' ',
        0xff01..=0xff5e => char::from_u32(c as u32 - 0xfee0).unwrap(),
        _ => c,
    }).collect::<String>().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}
fn loose(term: &str) -> bool {
    !term.chars().all(|c| c.is_ascii_digit()) && term.chars().count() >= if term.is_ascii() { 3 } else { 2 }
}
fn rank(value: &str, term: &str) -> f64 {
    if value == term { return 7.; }
    if value.starts_with(term) { return 5.; }
    if value.contains(&format!(" {term}")) { return 4.; }
    if value.contains(term) { return 3.; }
    if !loose(term) { return 0.; }
    // UTF-16 positions mirror the browser library's character comparison.
    let value: Vec<u16> = value.encode_utf16().collect();
    let term: Vec<u16> = term.encode_utf16().collect();
    let initials: Vec<u16> = value.iter().enumerate().filter_map(|(i, &c)| {
        (c != 32 && c != 45 && (i == 0 || value[i - 1] == 32 || value[i - 1] == 45)).then_some(c)
    }).collect();
    if initials.windows(term.len()).any(|window| window == term) { return 2.; }
    let mut next = 0;
    let mut first = 0;
    for (i, c) in term.iter().enumerate() {
        let Some(found) = value[next..].iter().position(|v| v == c) else { return 0.; };
        next += found + 1;
        if i == 0 { first = next; }
    }
    1. + 1. / (next - first) as f64
}
struct Candidate {
    kind: String,
    id: String,
    name: String,
    scores: Vec<(f64, usize)>,
}
fn compare(a: &Candidate, b: &Candidate) -> Ordering {
    for ((ar, ak), (br, bk)) in a.scores.iter().zip(&b.scores) {
        let order = br.total_cmp(ar).then(ak.cmp(bk));
        if order != Ordering::Equal { return order; }
    }
    a.kind.cmp(&b.kind).then_with(|| a.name.encode_utf16().cmp(b.name.encode_utf16())).then_with(|| a.id.encode_utf16().cmp(b.id.encode_utf16()))
}
pub(super) fn suggestions(conn: &Connection, query: &str) -> Result<Vec<Value>> {
    let query = normalize(&query.chars().take(120).collect::<String>());
    let terms: Vec<&str> = query.split_whitespace().collect();
    if terms.is_empty() { return Ok(vec![]); }
    // Only search entity metadata and maintained album summaries, never media rows.
    let mut statement = conn.prepare("SELECT e.kind,e.id,e.name,
        COALESCE(json_extract(e.data,'$.number'),''),
        COALESCE(json_extract(e.data,'$.alias'),''),COALESCE(s.search,'')
        FROM entities e LEFT JOIN summaries s ON e.kind='albums' AND s.album=e.id
        WHERE e.kind IN ('albums','models','tags')").map_err(err)?;
    let rows = statement.query_map([], |row| Ok((
        row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
        row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?
    ))).map_err(err)?;
    // Eight best records per type are sufficient for the final balanced top eight.
    let mut buckets: [Vec<Candidate>; 3] = std::array::from_fn(|_| vec![]);
    for row in rows {
        let (kind, id, name, number, alias, related) = row.map_err(err)?;
        let primary = [normalize(&name), normalize(if kind == "models" { &alias } else { &number })];
        let related = normalize(&related);
        let mut scores = vec![];
        for term in &terms {
            let mut score = (rank(&primary[0], term), 0);
            let number_score = rank(&primary[1], term);
            if number_score > score.0 { score = (number_score, 1); }
            if !related.is_empty() && related.contains(term) && score.0 < 2. { score = (2., 2); }
            if score.0 == 0. { break; }
            scores.push(score);
        }
        if scores.len() != terms.len() { continue; }
        let bucket = match kind.as_str() { "albums" => 0, "models" => 1, _ => 2 };
        buckets[bucket].push(Candidate { kind, id, name, scores });
        buckets[bucket].sort_by(compare);
        buckets[bucket].truncate(8);
    }
    let mut ranked: Vec<Candidate> = buckets.into_iter().flatten().collect();
    ranked.sort_by(compare);
    let mut quota = [4, 2, 2];
    let mut selected = vec![];
    for (i, item) in ranked.iter().enumerate() {
        let bucket = match item.kind.as_str() { "albums" => 0, "models" => 1, _ => 2 };
        if quota[bucket] > 0 { selected.push(i); quota[bucket] -= 1; }
    }
    for i in 0..ranked.len() {
        if selected.len() >= 8 { break; }
        if !selected.contains(&i) { selected.push(i); }
    }
    selected.sort_unstable();
    let mut results = vec![];
    for i in selected {
        let item = &ranked[i];
        let Some(entity) = get(conn, &item.kind, &item.id, false)? else { continue; };
        let mut detail = vec![];
        let (kind, thumbnail) = match item.kind.as_str() {
            "albums" => {
                if !text(&entity, "number").is_empty() { detail.push(text(&entity, "number").to_owned()); }
                for id in ids(&entity, "modelIds") {
                    if let Some(model) = get(conn, "models", &id, false)? { detail.push(text(&model, "name").to_owned()); }
                }
                for id in ids(&entity["_summary"], "tags") {
                    if let Some(tag) = get(conn, "tags", &id, false)? { detail.push(text(&tag, "name").to_owned()); }
                }
                ("album", text(&entity, "cover"))
            }
            "models" => {
                detail.push(if text(&entity, "alias").is_empty() { format!("{} 本写真", entity["albumCount"].as_i64().unwrap_or(0)) } else { text(&entity, "alias").to_owned() });
                ("model", text(&entity, "avatar"))
            }
            _ => {
                let group = get(conn, "groups", text(&entity, "groupId"), false)?;
                detail.push(group.as_ref().map(|g| text(g, "name")).unwrap_or("标签").to_owned());
                ("tag", "")
            }
        };
        results.push(json!({"kind":kind,"id":item.id,"name":item.name,"detail":detail.join(" · "),"thumbnail":thumbnail}));
    }
    Ok(results)
}
