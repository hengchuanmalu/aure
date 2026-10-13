use super::database::{count, meta, values};
use super::entities::{get, resolve_field};
use super::{err, ids, text, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;

pub(super) fn recent(conn: &Connection) -> Result<Vec<Value>> {
    values(conn,"SELECT json_object('albumId',album,'mediaId',media,'at',at) FROM recent ORDER BY at DESC LIMIT 40",&[])
}
pub(super) fn base(conn: &Connection, include_models: bool) -> Result<Value> {
    let mut models = if include_models {
        values(
            conn,
            "SELECT data FROM entities WHERE kind='models' ORDER BY name,id",
            &[],
        )?
    } else {
        vec![]
    };
    for m in &mut models {
        m["photoIds"] = json!([]);
        m["fields"] = json!([]);
        m["links"] = json!([]);
        m["bio"] = json!("");
        m["albumCount"]=json!(conn.query_row("SELECT count(*) FROM refs WHERE target_kind='models' AND target=? AND role='models'",[text(m,"id")],|r|r.get::<_,i64>(0)).map_err(err)?);
        resolve_field(conn, m, "avatar")?;
    }
    Ok(json!({"version":1,"albums":[],"media":[],"models":models,
        "tags":values(conn,"SELECT data FROM entities WHERE kind='tags' ORDER BY rowid",&[])?,
        "groups":values(conn,"SELECT data FROM entities WHERE kind='groups' ORDER BY rowid",&[])?,
        "settings":meta(conn,"settings",json!({"reducedMotion":false}))?,
        "importRules":meta(conn,"importRules",json!([]))?,"recent":recent(conn)?}))
}
pub(super) fn query_ids(
    conn: &Connection,
    sql: &str,
    args: &[&dyn rusqlite::ToSql],
) -> Result<Vec<String>> {
    let mut s = conn.prepare_cached(sql).map_err(err)?;
    let rows = s.query_map(args, |r| r.get(0)).map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}
pub(super) fn album_query(
    conn: &Connection,
    q: &Value,
    limit: i64,
    offset: i64,
) -> Result<(Vec<String>, i64)> {
    let needle = text(q, "q").trim().to_lowercase();
    let model = text(q, "model");
    let kind = text(q, "kind");
    let favorite = q["favorite"].as_bool().unwrap_or(false);
    let tag_json = json!(ids(q, "tags")).to_string();
    let selected_json = if q.get("ids").is_some() {
        json!(ids(q, "ids")).to_string()
    } else {
        String::new()
    };
    let condition=" FROM entities e JOIN summaries s ON s.album=e.id WHERE e.kind='albums' AND instr(s.search,?)>0
        AND (?='' OR EXISTS(SELECT 1 FROM refs WHERE owner_kind='albums' AND owner=e.id AND role='models' AND target=?))
        AND (?=0 OR e.favorite=1) AND (? NOT IN ('image','video') OR (?='image' AND s.images>0) OR (?='video' AND s.videos>0))
        AND NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS(SELECT 1 FROM json_each(s.data,'$.tags') present WHERE present.value=wanted.value))
        AND (?='' OR e.id IN (SELECT value FROM json_each(?)))";
    let args: &[&dyn rusqlite::ToSql] = &[
        &needle,
        &model,
        &model,
        &favorite,
        &kind,
        &kind,
        &kind,
        &tag_json,
        &selected_json,
        &selected_json,
    ];
    let total = conn
        .query_row(&format!("SELECT count(*){condition}"), args, |r| r.get(0))
        .map_err(err)?;
    let field = match text(q, "sort") {
        "name" => "e.name COLLATE NOCASE",
        "created" => "json_extract(e.data,'$.createdAt')",
        _ => "e.updated",
    };
    let direction = match text(q, "order") {
        "asc" => "ASC",
        "desc" => "DESC",
        _ if text(q, "sort") == "name" => "ASC",
        _ => "DESC",
    };
    let order = format!("{field} {direction},e.id");
    let mut paged = args.to_vec();
    paged.push(&limit);
    paged.push(&offset);
    let rows = query_ids(
        conn,
        &format!("SELECT e.id{condition} ORDER BY {order} LIMIT ? OFFSET ?"),
        &paged,
    )?;
    Ok((rows, total))
}
pub(super) fn media_query(
    conn: &Connection,
    q: &Value,
    limit: i64,
    offset: i64,
) -> Result<(Vec<String>, i64)> {
    let album = text(q, "album");
    let model = text(q, "profile");
    let kind = text(q, "kind");
    let favorite = q["favorite"].as_bool().unwrap_or(false);
    let (join, condition, order) = if !album.is_empty() {
        (
            "JOIN refs r ON r.target_kind='media' AND r.target=e.id",
            "AND r.owner_kind='albums' AND r.owner=? AND r.role='content'",
            "(e.media_kind='video'),r.position",
        )
    } else if !model.is_empty() {
        (
            "JOIN refs r ON r.target_kind='media' AND r.target=e.id",
            "AND r.owner_kind='models' AND r.owner=? AND r.role='photos'",
            "r.position",
        )
    } else {
        ("", "AND ?=''", "e.id")
    };
    let owner = if !album.is_empty() { album } else { model };
    let from=format!(" FROM entities e {join} WHERE e.kind='media' {condition} AND (?='' OR ?='all' OR e.media_kind=?) AND (?=0 OR e.favorite=1)");
    let args: &[&dyn rusqlite::ToSql] = &[&owner, &kind, &kind, &kind, &favorite];
    let total = conn
        .query_row(&format!("SELECT count(*){from}"), args, |r| r.get(0))
        .map_err(err)?;
    let mut paged = args.to_vec();
    paged.push(&limit);
    paged.push(&offset);
    Ok((
        query_ids(
            conn,
            &format!("SELECT e.id{from} ORDER BY {order} LIMIT ? OFFSET ?"),
            &paged,
        )?,
        total,
    ))
}
pub(super) fn collect_media(
    conn: &Connection,
    db: &mut Value,
    media_ids: Vec<String>,
) -> Result<()> {
    let mut seen: HashSet<String> = db["media"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| text(v, "id").to_owned())
        .collect();
    for id in media_ids {
        if seen.insert(id.clone()) {
            if let Some(m) = get(conn, "media", &id, false)? {
                db["media"].as_array_mut().unwrap().push(m);
            }
        }
    }
    Ok(())
}
pub fn view(conn: &Connection, q: &Value) -> Result<Value> {
    let route = text(q, "route");
    let mut db = base(conn, !matches!(route, "viewer" | "tags" | "settings"))?;
    let page = q["page"].as_i64().unwrap_or(0).max(0);
    let limit = q["limit"].as_i64().unwrap_or(96).clamp(1, 96);
    let offset = page.saturating_mul(limit);
    let mut result = json!({"db":null,"page":page,"limit":limit,"total":0,"mediaTotal":0,"albumTotal":count(conn,"albums")?,"modelTotal":count(conn,"models")?,"mediaCount":count(conn,"media")?});
    let mut album_ids = vec![];
    match route {
        "library" => {
            let (rows, total) = album_query(conn, q, limit, offset)?;
            album_ids = rows;
            result["total"] = json!(total);
            if q["tagSidebar"].as_bool().unwrap_or(false) {
                result["tagAlbumCounts"] = json!({});
                let mut statement = conn.prepare("SELECT tag.value, count(*) FROM summaries s, json_each(s.data, '$.tags') tag GROUP BY tag.value").map_err(err)?;
                let rows = statement
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                    })
                    .map_err(err)?;
                for row in rows {
                    let (id, count) = row.map_err(err)?;
                    result["tagAlbumCounts"][id] = json!(count);
                }
            }
        }
        "album" => {
            if let Some(a) = get(conn, "albums", text(q, "id"), false)? {
                db["albums"].as_array_mut().unwrap().push(a);
            }
            // The header starts at the complete album's first photo/video,
            // without transferring its entire sequence on every page read.
            for kind in ["image", "video"] {
                let first = query_ids(conn,
                    "SELECT r.target FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target WHERE r.owner_kind='albums' AND r.owner=? AND r.role='content' AND e.media_kind=? ORDER BY r.position LIMIT 1",
                    &[&text(q, "id"), &kind])?.pop();
                if let Some(id) = first {
                    result["firstMediaId"] = json!(id);
                    break;
                }
            }
            let mut mq = q.clone();
            mq["album"] = q["id"].clone();
            let (rows, total) = media_query(conn, &mq, limit, offset)?;
            result["visibleMediaIds"] = json!(rows);
            collect_media(conn, &mut db, rows)?;
            result["total"] = json!(total);
            result["mediaTotal"] = json!(total);
        }
        "favorites" => {
            let mut fq = q.clone();
            fq["favorite"] = json!(true);
            let (rows, total) = album_query(conn, &fq, limit, offset)?;
            album_ids = rows;
            result["total"] = json!(total);
            let (rows, total) = media_query(conn, &fq, limit, offset)?;
            result["visibleMediaIds"] = json!(rows);
            collect_media(conn, &mut db, rows)?;
            result["mediaTotal"] = json!(total);
        }
        "recent" => {
            album_ids = recent(conn)?
                .iter()
                .map(|r| text(r, "albumId").to_owned())
                .collect();
            result["total"] = json!(album_ids.len());
        }
        "model" => {
            let id = text(q, "id");
            if let Some(m) = get(conn, "models", id, false)? {
                db["models"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|x| text(x, "id") != id);
                db["models"].as_array_mut().unwrap().push(m);
            }
            let (rows, total) = album_query(conn, &json!({"model":id}), limit, offset)?;
            album_ids = rows;
            result["total"] = json!(total);
            // This page presents profile details and associated albums. Profile
            // photos are read explicitly by their editor/viewer, not paged here.
            let total = conn.query_row(
                "SELECT count(*) FROM refs WHERE owner_kind='models' AND owner=? AND role='photos'",
                [id], |row| row.get::<_, i64>(0),
            ).map_err(err)?;
            result["mediaTotal"] = json!(total);
        }
        "viewer" => {
            let id = text(q, "id");
            let owner = text(q, "owner");
            let mq = if owner == "favorites" {
                json!({"favorite":true})
            } else if let Some(profile) = owner.strip_prefix("profile-") {
                json!({"profile":profile})
            } else {
                json!({"album":owner,"kind":text(q,"kind")})
            };
            // Count the same ordering used by media_query; no full sequence crosses IPC.
            let position = if owner == "favorites" {
                conn.query_row(
                    "SELECT count(*) FROM entities WHERE kind='media' AND favorite=1 AND id<?",
                    [id],
                    |r| r.get::<_, i64>(0),
                )
                .map_err(err)?
            } else {
                let (owner_kind, oid, role) = if let Some(p) = owner.strip_prefix("profile-") {
                    ("models", p, "photos")
                } else {
                    ("albums", owner, "content")
                };
                let before = if owner_kind == "albums" {
                    "((e.media_kind='video'),r.position) < ((anchor_media.media_kind='video'),anchor.position)"
                } else {
                    "r.position < anchor.position"
                };
                let sql = format!("SELECT count(*) FROM refs r JOIN entities e ON e.kind='media' AND e.id=r.target JOIN refs anchor ON anchor.owner_kind=r.owner_kind AND anchor.owner=r.owner AND anchor.role=r.role AND anchor.target=? JOIN entities anchor_media ON anchor_media.kind='media' AND anchor_media.id=anchor.target WHERE r.owner_kind=? AND r.owner=? AND r.role=? AND (?='' OR ?='all' OR e.media_kind=?) AND {before}");
                conn.query_row(
                    &sql,
                    params![
                        id,
                        owner_kind,
                        oid,
                        role,
                        text(&mq, "kind"),
                        text(&mq, "kind"),
                        text(&mq, "kind")
                    ],
                    |r| r.get::<_, i64>(0),
                )
                .map_err(err)?
            };
            let (rows, total) = media_query(conn, &mq, 3, (position - 1).max(0))?;
            let at = rows.iter().position(|x| x == id);
            result["viewer"] = if owner == "favorites" {
                let previous=query_ids(conn,"SELECT id FROM entities WHERE kind='media' AND favorite=1 AND id<? ORDER BY id DESC LIMIT 1",&[&id])?.pop();
                let next=query_ids(conn,"SELECT id FROM entities WHERE kind='media' AND favorite=1 AND id>? ORDER BY id LIMIT 1",&[&id])?.pop();
                let anchor = get(conn, "media", id, false)?.is_some_and(|m| m["favorite"] == false);
                json!({"index":position,"total":total+if anchor {1}else{0},"previous":previous,"next":next})
            } else {
                json!({"index":position,"total":total,"previous":at.and_then(|i|i.checked_sub(1)).and_then(|i|rows.get(i)),"next":at.and_then(|i|rows.get(i+1))})
            };
            collect_media(conn, &mut db, vec![id.to_owned()])?;
            if let Some(a) = get(conn, "albums", owner, false)? {
                db["albums"].as_array_mut().unwrap().push(a);
            }
        }
        "tags" => {
            result["tagAlbumCounts"] = json!({});
            result["tagMediaCounts"] = json!({});
            for t in db["tags"].as_array().unwrap() {
                let id = text(t, "id");
                for (kind, field) in [("albums", "tagAlbumCounts"), ("media", "tagMediaCounts")] {
                    let n=conn.query_row("SELECT count(*) FROM refs WHERE target_kind='tags' AND target=? AND owner_kind=? AND role='tags'",params![id,kind],|r|r.get::<_,i64>(0)).map_err(err)?;
                    result[field][id] = json!(n);
                }
            }
        }
        "home" => {
            let (rows, total) = album_query(conn, q, 24, 0)?;
            album_ids = rows;
            result["total"] = json!(total);
            let (favorites, _) = album_query(conn, &json!({"favorite":true}), 8, 0)?;
            album_ids.extend(favorites);
            album_ids.extend(
                recent(conn)?
                    .iter()
                    .take(8)
                    .map(|r| text(r, "albumId").to_owned()),
            );
            let mut seen = HashSet::new();
            album_ids.retain(|id| seen.insert(id.clone()));
        }
        _ => {}
    }
    for id in album_ids {
        if let Some(a) = get(conn, "albums", &id, false)? {
            db["albums"].as_array_mut().unwrap().push(a);
        }
    }
    // Resolve only the visible covers/preview resources into the small Photo lookup index.
    let mut sources: HashSet<String> = HashSet::new();
    for a in db["albums"].as_array().unwrap() {
        sources.insert(text(a, "cover").to_owned());
        sources.extend(ids(&a["_summary"], "previews"));
    }
    for m in db["models"].as_array().unwrap().iter().take(24) {
        sources.insert(text(m, "avatar").to_owned());
        sources.insert(text(m, "background").to_owned());
    }
    let mut resource_ids = Vec::new();
    for src in sources {
        let id = if let Some(id) = src.strip_prefix("http://jingji.localhost/media/") {
            Some(
                percent_encoding::percent_decode_str(id)
                    .decode_utf8_lossy()
                    .into_owned(),
            )
        } else {
            conn.query_row("SELECT id FROM entities WHERE kind='media' AND json_extract(data,'$.src')=? LIMIT 1",[src],|r|r.get::<_,String>(0)).optional().map_err(err)?
        };
        if let Some(id) = id {
            resource_ids.push(id);
        }
    }
    collect_media(conn, &mut db, resource_ids)?;
    result["db"] = db;
    Ok(result)
}
