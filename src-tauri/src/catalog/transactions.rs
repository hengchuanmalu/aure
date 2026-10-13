use super::database::set_meta;
use super::entities::{affected, get, put, rebuild};
use super::queries::query_ids;
use super::{err, ids, path_key, text, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};
use std::collections::HashSet;

pub(super) fn import_snapshot(tx: &Transaction, db: &Value) -> Result<()> {
    import_snapshot_progress(tx, db, |_, _, _| {})
}
pub(super) fn import_snapshot_progress(
    tx: &Transaction,
    db: &Value,
    progress: impl Fn(&str, usize, usize),
) -> Result<()> {
    if db["version"] != 1 {
        return Err("旧库版本不兼容，原始备份已保留".into());
    }
    if !db["settings"].is_object() || !db["recent"].is_array() {
        return Err("旧库设置或历史格式错误，原始备份已保留".into());
    }
    for kind in ["groups", "tags", "media", "models", "albums"] {
        let entries = db[kind].as_array().ok_or("旧库数据格式错误")?;
        for (i, entry) in entries.iter().enumerate() {
            put(tx, kind, entry)?;
            if i % 1000 == 0 {
                progress(kind, i, entries.len());
            }
        }
        progress(kind, entries.len(), entries.len());
    }
    set_meta(tx, "settings", &db["settings"])?;
    set_meta(
        tx,
        "importRules",
        &db.get("importRules").cloned().unwrap_or(json!([])),
    )?;
    for r in db["recent"].as_array().into_iter().flatten().take(40) {
        save_recent(tx, Some(r))?;
    }
    let albums = query_ids(tx, "SELECT id FROM entities WHERE kind='albums'", &[])?;
    for (i, id) in albums.iter().enumerate() {
        rebuild(tx, id)?;
        if i % 100 == 0 {
            progress("summaries", i, albums.len());
        }
    }
    set_meta(tx, "initialized", &json!(true))?;
    Ok(())
}
pub(super) fn save_recent(conn: &Connection, entry: Option<&Value>) -> Result<()> {
    if let Some(r) = entry {
        if get(conn, "albums", text(r, "albumId"), false)?.is_none() {
            return Ok(());
        }
        conn.execute("INSERT INTO recent VALUES(?,?,?) ON CONFLICT(album) DO UPDATE SET media=excluded.media,at=excluded.at",params![text(r,"albumId"),r["mediaId"].as_str(),text(r,"at")]).map_err(err)?;
        conn.execute("DELETE FROM recent WHERE album NOT IN (SELECT album FROM recent ORDER BY at DESC LIMIT 40)",[]).map_err(err)?;
    } else {
        conn.execute("DELETE FROM recent", []).map_err(err)?;
    }
    Ok(())
}
pub(super) fn patch(conn: &Connection, patch: &Value) -> Result<()> {
    let mut dirty = HashSet::new();
    for kind in ["groups", "tags", "models", "media", "albums"] {
        for change in patch[kind].as_array().into_iter().flatten() {
            let id = text(change, "id");
            dirty.extend(affected(conn, kind, id)?);
            let existing = get(conn, kind, id, true)?;
            let mut value = existing.unwrap_or_else(|| change.clone());
            for (key, v) in change.as_object().ok_or("修改格式错误")? {
                if ![
                    "id",
                    "sourcePath",
                    "sourceDirectory",
                    "src",
                    "mediaIds",
                    "modelIds",
                    "photoIds",
                    "_summary",
                ]
                .contains(&key.as_str())
                {
                    value[key] = v.clone();
                }
            }
            put(conn, kind, &value)?;
            if kind == "albums" {
                dirty.insert(id.to_owned());
            }
            if kind == "tags" {
                // Media tags also contribute to album search summaries.
                let media=query_ids(conn,"SELECT owner FROM refs WHERE owner_kind='media' AND target_kind='tags' AND target=?",&[&id])?;
                for mid in media {
                    dirty.extend(affected(conn, "media", &mid)?);
                }
            }
        }
    }
    if !patch["settings"].is_null() {
        set_meta(conn, "settings", &patch["settings"])?;
    }
    for id in dirty {
        rebuild(conn, &id)?;
    }
    Ok(())
}
pub(super) fn operation(conn: &Connection, op: &Value) -> Result<()> {
    let mut dirty = HashSet::new();
    match text(op, "type") {
        "setAlbumCover" => {
            let album_id = text(op, "albumId");
            let media_id = text(op, "mediaId");
            let album_exists = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM entities WHERE kind='albums' AND id=?)",
                    [album_id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(err)?;
            if !album_exists {
                return Err("写真集已不存在".into());
            }
            let Some(media) = get(conn, "media", media_id, false)? else {
                return Err("请选择一张照片作为封面".into());
            };
            if text(&media, "kind") != "image" {
                return Err("请选择一张照片作为封面".into());
            }
            let belongs = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM refs WHERE owner_kind='albums' AND owner=? AND target_kind='media' AND target=? AND role='content')",
                params![album_id, media_id], |row| row.get::<_, bool>(0),
            ).map_err(err)?;
            if !belongs {
                return Err("所选照片不属于这个写真集".into());
            }
            // Update only cover fields; the viewer contains a finite media window.
            conn.execute(
                "UPDATE entities SET data=json_set(json_remove(data,'$.coverCrop'),'$.coverMediaId',?1,'$.cover',?2,'$.updatedAt',date('now')), updated=date('now') WHERE kind='albums' AND id=?3",
                params![media_id, text(&media, "src"), album_id],
            ).map_err(err)?;
            conn.execute(
                "UPDATE entities SET data=json_set(data,'$.importMetadata.fields.coverMediaId.source','manual','$.importMetadata.fields.coverMediaId.evidence',json('[]'),'$.importMetadata.fields.coverMediaId.value',?1) WHERE kind='albums' AND id=?2 AND json_type(data,'$.importMetadata.fields.coverMediaId')='object'",
                params![media_id, album_id],
            ).map_err(err)?;
            dirty.insert(album_id.to_owned());
        }
        "saveAlbum" => {
            put(conn, "albums", &op["album"])?;
            dirty.insert(text(&op["album"], "id").to_owned());
        }
        "saveModel" => {
            let mut model = op["model"].clone();
            for (key, field, name) in [
                ("avatarImage", "avatar", "头像"),
                ("backgroundImage", "background", "背景"),
            ] {
                if let Some(image) = op.get(key).filter(|v| !v.is_null()) {
                    if text(image, "kind") != "image" || text(image, "src") != text(&model, field) {
                        return Err(format!("{name}图片与草稿不一致"));
                    }
                    let existing: Option<String> = conn
                        .query_row(
                            "SELECT id FROM entities WHERE kind='media' AND source=?",
                            [path_key(text(image, "sourcePath"))],
                            |r| r.get(0),
                        )
                        .optional()
                        .map_err(err)?;
                    let media_id = match existing {
                        Some(id) => id,
                        None => {
                            put(conn, "media", image)?;
                            text(image, "id").to_owned()
                        }
                    };
                    model[field] = json!(format!(
                        "http://jingji.localhost/media/{}",
                        percent_encoding::utf8_percent_encode(
                            &media_id,
                            percent_encoding::NON_ALPHANUMERIC
                        )
                    ));
                }
            }
            let m = &model;
            let id = text(m, "id");
            for l in m["links"].as_array().into_iter().flatten() {
                let url = text(l, "url");
                if !url.is_empty() && !url.starts_with("https://") && !url.starts_with("http://") {
                    return Err("社交链接格式不正确".into());
                }
            }
            dirty.extend(affected(conn, "models", id)?);
            put(conn, "models", m)?;
            conn.execute(
                "DELETE FROM refs WHERE target_kind='models' AND target=? AND role='models'",
                [id],
            )
            .map_err(err)?;
            for album in ids(op, "albumIds") {
                let pos=conn.query_row("SELECT COALESCE(MAX(position)+1,0) FROM refs WHERE owner_kind='albums' AND owner=? AND role='models'",[&album],|r|r.get::<_,i64>(0)).map_err(err)?;
                conn.execute(
                    "INSERT INTO refs VALUES('albums',?,'models',?,'models',?)",
                    params![album, id, pos],
                )
                .map_err(err)?;
                dirty.insert(album);
            }
        }
        "removeAlbum" => {
            let id = text(op, "id");
            conn.execute("DELETE FROM entities WHERE kind='albums' AND id=?", [id])
                .map_err(err)?;
            conn.execute("DELETE FROM summaries WHERE album=?", [id])
                .map_err(err)?;
            conn.execute("DELETE FROM recent WHERE album=?", [id])
                .map_err(err)?;
        }
        "addMediaTags" => {
            for id in ids(op, "mediaIds") {
                let Some(mut m) = get(conn, "media", &id, true)? else {
                    return Err("所选媒体已不存在".into());
                };
                let mut tags = ids(&m, "tags");
                for tag in ids(op, "tagIds") {
                    if !tags.contains(&tag) {
                        tags.push(tag);
                    }
                }
                m["tags"] = json!(tags);
                put(conn, "media", &m)?;
                dirty.extend(affected(conn, "media", &id)?);
            }
        }
        "addAlbumTags" => {
            let mut media = HashSet::new();
            for id in ids(op, "albumIds") {
                let Some(mut album) = get(conn, "albums", &id, true)? else {
                    return Err("所选写真集已不存在".into());
                };
                let mut tags = ids(&album, "tags");
                for tag in ids(op, "tagIds") { if !tags.contains(&tag) { tags.push(tag); } }
                album["tags"] = json!(tags);
                if op["includeMedia"].as_bool().unwrap_or(false) { media.extend(ids(&album, "mediaIds")); }
                put(conn, "albums", &album)?;
                dirty.insert(id);
            }
            for id in media {
                let mut item = get(conn, "media", &id, true)?.ok_or("所选媒体已不存在")?;
                let mut tags = ids(&item, "tags");
                for tag in ids(op, "tagIds") { if !tags.contains(&tag) { tags.push(tag); } }
                item["tags"] = json!(tags);
                put(conn, "media", &item)?;
                dirty.extend(affected(conn, "media", &id)?);
            }
        }
        "removeTag" => {
            let id = text(op, "id");
            if op["group"].as_bool().unwrap_or(false) {
                let tags = query_ids(conn,"SELECT id FROM entities WHERE kind='tags' AND json_extract(data,'$.groupId')=?",&[&id])?;
                if !tags.is_empty() {
                    let existing: Option<String> = conn.query_row("SELECT id FROM entities WHERE kind='groups' AND name='未分组' AND id<>? ORDER BY id LIMIT 1", [id], |r| r.get(0)).optional().map_err(err)?;
                    let group = if let Some(existing) = existing { existing } else {
                        let mut suffix = 0;
                        let mut target = format!("ungrouped-{id}");
                        while get(conn, "groups", &target, false)?.is_some() {
                            suffix += 1;
                            target = format!("ungrouped-{id}-{suffix}");
                        }
                        put(conn, "groups", &json!({"id":target,"name":"未分组"}))?;
                        target
                    };
                    for tag in tags {
                        let mut value = get(conn, "tags", &tag, true)?.ok_or("标签已不存在")?;
                        value["groupId"] = json!(group);
                        put(conn, "tags", &value)?;
                    }
                }
                conn.execute("DELETE FROM entities WHERE kind='groups' AND id=?", [id]).map_err(err)?;
                return Ok(());
            }
            let tags = if op["group"].as_bool().unwrap_or(false) {
                query_ids(conn,"SELECT id FROM entities WHERE kind='tags' AND json_extract(data,'$.groupId')=?",&[&id])?
            } else {
                vec![id.to_owned()]
            };
            for tag in tags {
                dirty.extend(affected(conn, "tags", &tag)?);
                for mid in query_ids(conn,"SELECT owner FROM refs WHERE owner_kind='media' AND target_kind='tags' AND target=?",&[&tag])? {dirty.extend(affected(conn,"media",&mid)?);}
                conn.execute("DELETE FROM entities WHERE kind='tags' AND id=?", [tag])
                    .map_err(err)?;
            }
            if op["group"].as_bool().unwrap_or(false) {
                conn.execute("DELETE FROM entities WHERE kind='groups' AND id=?", [id])
                    .map_err(err)?;
            }
        }
        "importPrepared" => {
            let directory = text(&op["album"], "sourceDirectory");
            if directory.is_empty() {
                return Err("导入缺少来源文件夹".into());
            }
            if conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM entities WHERE kind='albums' AND source=?)",
                    [path_key(directory)],
                    |r| r.get::<_, bool>(0),
                )
                .map_err(err)?
            {
                return Err("该文件夹已导入，请编辑已有写真集".into());
            }
            for kind in ["groups", "tags"] {
                for item in op[kind].as_array().into_iter().flatten() {
                    put(conn, kind, item)?;
                }
            }
            for m in op["media"].as_array().ok_or("导入媒体缺失")? {
                if get(conn, "media", text(m, "id"), false)?.is_none() {
                    put(conn, "media", m)?;
                }
            }
            for m in op["models"].as_array().into_iter().flatten() {
                put(conn, "models", m)?;
            }
            put(conn, "albums", &op["album"])?;
            set_meta(conn, "importRules", &op["importRules"])?;
            dirty.insert(text(&op["album"], "id").to_owned());
        }
        _ => return Err("未知业务操作".into()),
    }
    for id in dirty {
        rebuild(conn, &id)?;
    }
    Ok(())
}
