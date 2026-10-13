use super::database::values;
use super::{err, ids, path_key, text, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;

pub(super) fn references(
    conn: &Connection,
    kind: &str,
    id: &str,
    role: &str,
) -> Result<Vec<String>> {
    let sql = if kind == "albums" && role == "content" {
        "SELECT r.target FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind=? AND r.owner=? AND r.role=? ORDER BY (e.media_kind='video'),r.position"
    } else {
        "SELECT target FROM refs WHERE owner_kind=? AND owner=? AND role=? ORDER BY position"
    };
    let mut s = conn.prepare_cached(sql).map_err(err)?;
    let rows = s
        .query_map(params![kind, id, role], |r| r.get(0))
        .map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}
pub(super) fn replace_refs(
    conn: &Connection,
    kind: &str,
    id: &str,
    role: &str,
    target_kind: &str,
    targets: &[String],
) -> Result<()> {
    conn.prepare_cached("DELETE FROM refs WHERE owner_kind=? AND owner=? AND role=?")
        .map_err(err)?
        .execute(params![kind, id, role])
        .map_err(err)?;
    let mut insert = conn
        .prepare_cached("INSERT OR IGNORE INTO refs VALUES(?,?,?,?,?,?)")
        .map_err(err)?;
    for (i, target) in targets.iter().enumerate() {
        insert
            .execute(params![kind, id, target_kind, target, role, i as i64])
            .map_err(|_| format!("引用已不存在：{target}"))?;
    }
    Ok(())
}
pub(super) fn get(conn: &Connection, kind: &str, id: &str, full: bool) -> Result<Option<Value>> {
    let mut result = values(
        conn,
        "SELECT data FROM entities WHERE kind=? AND id=?",
        &[&kind, &id],
    )?
    .pop();
    if let Some(v) = &mut result {
        if kind == "albums" {
            v["mediaIds"] = json!(if full {
                references(conn, kind, id, "content")?
            } else {
                vec![]
            });
        }
        if kind == "models" {
            v["photoIds"] = json!(if full {
                references(conn, kind, id, "photos")?
            } else {
                vec![]
            });
        }
        if ["albums", "media"].contains(&kind) {
            v["tags"] = json!(references(conn, kind, id, "tags")?);
        }
        if kind == "albums" {
            v["modelIds"] = json!(references(conn, kind, id, "models")?);
            let s = values(conn, "SELECT data FROM summaries WHERE album=?", &[&id])?.pop();
            if let Some(s) = s {
                v["_summary"] = s;
            }
            if let Some(mid) = v["coverMediaId"].as_str().map(str::to_owned) {
                if let Some(m) = get(conn, "media", &mid, false)? {
                    v["cover"] = m["src"].clone();
                }
            } else {
                resolve_field(conn, v, "cover")?;
            }
        }
        if kind == "media" && v["sourcePath"].is_string() {
            v["src"] = json!(format!(
                "http://jingji.localhost/media/{}",
                percent_encoding::utf8_percent_encode(id, percent_encoding::NON_ALPHANUMERIC)
            ));
        }
        if kind == "models" {
            resolve_field(conn, v, "avatar")?;
            resolve_field(conn, v, "background")?;
            v["albumCount"] = json!(conn.query_row("SELECT count(*) FROM refs WHERE target_kind='models' AND target=? AND role='models'",[id],|r|r.get::<_,i64>(0)).map_err(err)?);
        }
    }
    Ok(result)
}
pub(super) fn resolve_field(conn: &Connection, v: &mut Value, field: &str) -> Result<()> {
    let src = text(v, field).to_owned();
    // Legacy URLs are only lookup keys; never used as authorization.
    let id: Option<String> = conn
        .query_row(
            "SELECT id FROM entities WHERE kind='media' AND json_extract(data,'$.src')=? LIMIT 1",
            [src],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(id) = id {
        if let Some(m) = get(conn, "media", &id, false)? {
            v[field] = m["src"].clone();
        }
    }
    Ok(())
}
pub(super) fn validate_entity(kind: &str, value: &Value) -> Result<()> {
    if !["groups", "tags", "media", "models", "albums"].contains(&kind)
        || !value.is_object()
    {
        return Err("记录类型或格式错误".into());
    }
    let id = text(value, "id");
    if id.is_empty() {
        return Err("记录缺少稳定标识".into());
    }
    if kind != "media" && text(value, "name").trim().is_empty() {
        return Err("名称不能为空".into());
    }
    if kind == "media"
        && (!matches!(text(value, "kind"), "image" | "video")
            || value["rating"]
                .as_i64()
                .is_none_or(|n| !(0..=5).contains(&n)))
    {
        return Err("媒体类型或评分无效".into());
    }
    Ok(())
}
pub(super) fn put(conn: &Connection, kind: &str, value: &Value) -> Result<()> {
    validate_entity(kind, value)?;
    let id = text(value, "id");
    let mut data = value.clone();
    let object = data.as_object_mut().ok_or("记录格式错误")?;
    for key in [
        "_summary",
        "albumCount",
        "mediaIds",
        "photoIds",
        "modelIds",
        "tags",
    ] {
        object.remove(key);
    }
    if ["tags", "groups"].contains(&kind) { /* These have no reference fields. */ }
    conn.prepare_cached("INSERT INTO entities VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,name=excluded.name,source=excluded.source,favorite=excluded.favorite,media_kind=excluded.media_kind,bytes=excluded.bytes,updated=excluded.updated").map_err(err)?.execute(
        params![kind,id,data.to_string(),text(value,"name"),path_key(if kind=="media" {text(value,"sourcePath")} else {text(value,"sourceDirectory")}), value["favorite"].as_bool().unwrap_or(false),text(value,"kind"),value["size"].as_i64().unwrap_or(0),text(value,"updatedAt")]).map_err(err)?;
    if kind == "albums" {
        replace_refs(conn, kind, id, "content", "media", &ids(value, "mediaIds"))?;
        replace_refs(conn, kind, id, "models", "models", &ids(value, "modelIds"))?;
    }
    if kind == "models" {
        for mid in ids(value, "photoIds") {
            let image = conn
                .query_row(
                    "SELECT media_kind='image' FROM entities WHERE kind='media' AND id=?",
                    [mid],
                    |r| r.get::<_, bool>(0),
                )
                .optional()
                .map_err(err)?
                .unwrap_or(false);
            if !image {
                return Err("档案照片必须是已登记的图片".into());
            }
        }
        replace_refs(conn, kind, id, "photos", "media", &ids(value, "photoIds"))?;
    }
    if kind == "tags" {
        replace_refs(
            conn,
            kind,
            id,
            "group",
            "groups",
            &[text(value, "groupId").to_owned()],
        )?;
    }
    if ["albums", "media"].contains(&kind) {
        replace_refs(conn, kind, id, "tags", "tags", &ids(value, "tags"))?;
    }
    Ok(())
}
pub(super) fn rebuild(conn: &Connection, id: &str) -> Result<()> {
    let Some(a) = get(conn, "albums", id, false)? else {
        return Ok(());
    };
    let mut tags: HashSet<String> = ids(&a, "tags").into_iter().collect();
    let mut images = 0u64;
    let mut videos = 0u64;
    let mut bytes = 0u64;
    let mut previews = Vec::new();
    let mut s=conn.prepare("SELECT e.data FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.role='content' ORDER BY r.position").map_err(err)?;
    let rows = s.query_map([id], |r| r.get::<_, String>(0)).map_err(err)?;
    // Streaming one album's media only; never deserialize the whole library.
    for row in rows {
        let m: Value = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
        let mid = text(&m, "id");
        if text(&m, "kind") == "image" {
            images += 1;
        } else {
            videos += 1;
        }
        bytes += m["size"].as_u64().unwrap_or(0);
        tags.extend(references(conn, "media", mid, "tags")?);
        if previews.len() < 4
            && m["src"] != a["cover"]
            && m["id"] != a["coverMediaId"]
            && (text(&m, "kind") == "image" || m["poster"].is_string())
        {
            let image = get(conn, "media", mid, false)?.unwrap();
            let src = if text(&m, "kind") == "image" {
                image["src"].clone()
            } else {
                image["poster"].clone()
            };
            if !previews.contains(&src) {
                previews.push(src);
            }
        }
    }
    let mut search = vec![
        text(&a, "name").to_owned(),
        text(&a, "number").to_owned(),
        text(&a, "subtitle").to_owned(),
        text(&a, "description").to_owned(),
    ];
    for tag in &tags {
        if let Some(t) = get(conn, "tags", tag, false)? {
            search.push(text(&t, "name").to_owned());
        }
    }
    for model in ids(&a, "modelIds") {
        if let Some(m) = get(conn, "models", &model, false)? {
            search.push(text(&m, "name").to_owned());
        }
    }
    let search = search.join(" ").to_lowercase();
    let summary = json!({"images":images,"videos":videos,"bytes":bytes,"tags":tags,"previews":previews,"searchText":search});
    conn.execute("INSERT INTO summaries VALUES(?,?,?,?,?) ON CONFLICT(album) DO UPDATE SET data=excluded.data,search=excluded.search,images=excluded.images,videos=excluded.videos", params![id,summary.to_string(),search,images as i64,videos as i64]).map_err(err)?;
    Ok(())
}
pub(super) fn affected(conn: &Connection, kind: &str, id: &str) -> Result<Vec<String>> {
    let mut s=conn.prepare("SELECT DISTINCT owner FROM refs WHERE owner_kind='albums' AND target_kind=? AND target=?").map_err(err)?;
    let rows = s.query_map(params![kind, id], |r| r.get(0)).map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}
