//! Explicit, staged recovery; all writes remain transactional and preserve originals.
use super::database::{count, meta};
use super::entities::{get, put, rebuild, validate_entity};
use super::queries::query_ids;
use super::{err, ids, path_key, text, CatalogState, Result};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct MaintenanceState {
    pending: Mutex<HashMap<String, Plan>>,
    cursor: Mutex<usize>,
}
enum Plan {
    Restore {
        path: PathBuf,
    },
    Folder {
        album: Value,
        files: Vec<crate::importing::MaintenanceFile>,
        directory: String,
    },
    Media {
        original: Value,
        path: PathBuf,
        revision: String,
    },
}
fn stamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}

fn invalidate_file_metadata(media: &mut Value, width: u32, height: u32) {
    media["width"] = json!(width);
    media["height"] = json!(height);
    for field in ["metadataRevision", "duration", "codec", "exif", "poster"] {
        media.as_object_mut().unwrap().remove(field);
    }
}

pub(super) fn validate_backup(path: &Path) -> Result<Connection> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    c.execute_batch("PRAGMA trusted_schema=OFF;").map_err(err)?;
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    if version != 1 {
        return Err("备份版本不兼容，当前图库未修改".into());
    }
    let valid: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(err)?;
    if valid != "ok" {
        return Err("备份数据库损坏，当前图库未修改".into());
    }
    if c.prepare("PRAGMA foreign_key_check")
        .map_err(err)?
        .exists([])
        .map_err(err)?
    {
        return Err("备份关联不完整，当前图库未修改".into());
    }
    let unexpected: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view'))",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if unexpected {
        return Err("备份包含不受支持的数据库对象".into());
    }
    for (table, columns) in [
        (
            "entities",
            vec![
                "kind",
                "id",
                "data",
                "name",
                "source",
                "favorite",
                "media_kind",
                "bytes",
                "updated",
            ],
        ),
        (
            "refs",
            vec![
                "owner_kind",
                "owner",
                "target_kind",
                "target",
                "role",
                "position",
            ],
        ),
        (
            "summaries",
            vec!["album", "data", "search", "images", "videos"],
        ),
        ("recent", vec!["album", "media", "at"]),
        ("authorized", vec!["path"]),
        ("meta", vec!["key", "value"]),
    ] {
        let actual: Vec<String> = c
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(err)?
            .query_map([], |r| r.get(1))
            .map_err(err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(err)?;
        if actual != columns {
            return Err("备份结构不兼容，当前图库未修改".into());
        }
    }
    let bad: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM entities WHERE NOT json_valid(data)) OR EXISTS(SELECT 1 FROM summaries WHERE NOT json_valid(data)) OR EXISTS(SELECT 1 FROM meta WHERE NOT json_valid(value))", [], |r| r.get(0)).map_err(err)?;
    if bad
        || meta(&c, "initialized", json!(false))? != true
        || !meta(&c, "settings", json!(null))?.is_object()
    {
        return Err("备份资料无效，当前图库未修改".into());
    }
    // JSON validity alone accepts scalars, mismatched IDs and invalid media.
    // Stream the same entity rules used by writes before replacing any data.
    let mut entries = c.prepare("SELECT kind,id,data,source,name,media_kind FROM entities").map_err(err)?;
    let mut rows = entries.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let kind: String = row.get(0).map_err(err)?;
        let id: String = row.get(1).map_err(err)?;
        let raw: String = row.get(2).map_err(err)?;
        let source: String = row.get(3).map_err(err)?;
        let name: String = row.get(4).map_err(err)?;
        let media_kind: String = row.get(5).map_err(err)?;
        let value: Value = serde_json::from_str(&raw).map_err(err)?;
        validate_entity(&kind, &value)
            .map_err(|_| "备份记录类型或资料无效，当前图库未修改".to_owned())?;
        let expected_source = path_key(text(&value, if kind == "media" { "sourcePath" } else { "sourceDirectory" }));
        if text(&value, "id") != id || source != expected_source
            || text(&value, "name") != name || text(&value, "kind") != media_kind
        {
            return Err("备份记录标识或来源不一致，当前图库未修改".into());
        }
    }
    drop(rows);
    drop(entries);
    // Check references explicitly as well: a same-column backup can omit its
    // foreign-key declarations, making PRAGMA foreign_key_check insufficient.
    let invalid_refs: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM refs r
         LEFT JOIN entities owner ON owner.kind=r.owner_kind AND owner.id=r.owner
         LEFT JOIN entities target ON target.kind=r.target_kind AND target.id=r.target
         WHERE owner.id IS NULL OR target.id IS NULL OR r.position<0 OR NOT (
           (r.role='content' AND r.owner_kind='albums' AND r.target_kind='media') OR
           (r.role='models' AND r.owner_kind='albums' AND r.target_kind='models') OR
           (r.role='photos' AND r.owner_kind='models' AND r.target_kind='media' AND target.media_kind='image') OR
           (r.role='tags' AND r.owner_kind IN ('albums','media') AND r.target_kind='tags') OR
           (r.role='group' AND r.owner_kind='tags' AND r.target_kind='groups')))",
        [], |r| r.get(0),
    ).map_err(err)?;
    let invalid_summaries: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM summaries s LEFT JOIN entities e ON e.kind='albums' AND e.id=s.album
         WHERE e.id IS NULL OR json_type(s.data)<>'object' OR s.images<0 OR s.videos<0)",
        [], |r| r.get(0),
    ).map_err(err)?;
    if invalid_refs || invalid_summaries {
        return Err("备份关联或汇总资料无效，当前图库未修改".into());
    }
    Ok(c)
}
pub(super) fn restore_from(c: &mut Connection, path: &Path) -> Result<()> {
    let _verified = validate_backup(path)?;
    c.execute(
        "ATTACH DATABASE ? AS restore_source",
        [path.to_string_lossy().as_ref()],
    )
    .map_err(err)?;
    let result = (|| {
        let tx = c.transaction().map_err(err)?;
        tx.execute_batch("DELETE FROM refs; DELETE FROM entities; DELETE FROM summaries; DELETE FROM recent; DELETE FROM authorized; DELETE FROM meta;
            INSERT INTO entities SELECT * FROM restore_source.entities;
            INSERT INTO refs SELECT * FROM restore_source.refs;
            INSERT INTO summaries SELECT * FROM restore_source.summaries;
            INSERT INTO recent SELECT * FROM restore_source.recent;
            INSERT INTO meta SELECT * FROM restore_source.meta;
            INSERT INTO authorized SELECT path FROM restore_source.authorized WHERE path IN (SELECT source FROM entities WHERE kind='media');").map_err(err)?;
        tx.commit().map_err(err)
    })();
    let detached = c.execute("DETACH DATABASE restore_source", []).map_err(err);
    result?;
    detached?;
    Ok(())
}
#[tauri::command]
pub async fn prepare_catalog_restore(app: tauri::AppHandle) -> Result<Option<Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app.dialog().file().set_title("选择 aure 图库备份").add_filter("SQLite backup", &["sqlite3"]).blocking_pick_file() else { return Ok(None); };
        let source = file.into_path().map_err(err)?;
        let backup = validate_backup(&source)?;
        let token = stamp();
        let dir = app.path().app_data_dir().map_err(err)?.join("restore-staging");
        std::fs::create_dir_all(&dir).map_err(err)?;
        let path = dir.join(format!("{token}.sqlite3"));
        backup.backup(rusqlite::MAIN_DB, &path, None).map_err(err)?;
        let result = json!({"token":token,"name":source.file_name().unwrap_or_default().to_string_lossy(),"albums":count(&backup,"albums")?,"media":count(&backup,"media")?,"models":count(&backup,"models")?});
        app.state::<MaintenanceState>().pending.lock().map_err(err)?.insert(token, Plan::Restore { path });
        Ok(Some(result))
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn cancel_catalog_maintenance(app: tauri::AppHandle, token: String) -> Result<()> {
    let plans = app.state::<MaintenanceState>();
    let mut pending = plans.pending.lock().map_err(err)?;
    cancel_pending(&mut pending, &token)
}

fn cancel_pending(pending: &mut HashMap<String, Plan>, token: &str) -> Result<()> {
    if let Some(Plan::Restore { path }) = pending.get(token) {
        match std::fs::remove_file(path) {
            Ok(()) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(err(error)),
        }
    }
    // Preserve the token when a staged backup is temporarily occupied so a
    // later cancellation can retry; already missing files are idempotent.
    pending.remove(token);
    Ok(())
}
#[tauri::command]
pub async fn confirm_catalog_restore(app: tauri::AppHandle, token: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        if !crate::video::idle(&app) {
            return Err("请先关闭视频播放或预览，再恢复图库".into());
        }
        let plans = app.state::<MaintenanceState>();
        let pending = plans.pending.lock().map_err(err)?;
        let Some(Plan::Restore { path }) = pending.get(&token) else {
            return Err("备份预览已失效，请重新选择".into());
        };
        let state = app.state::<CatalogState>();
        let mut c = state.connection.lock().map_err(err)?;
        let dir = app.path().app_data_dir().map_err(err)?;
        c.backup(
            rusqlite::MAIN_DB,
            dir.join(format!("before-restore-{}.sqlite3", stamp())),
            None,
        )
        .map_err(err)?;
        restore_from(&mut c, path)?;
        state.selected.lock().map_err(err)?.clear();
        drop(c);
        drop(pending);
        if let Some(Plan::Restore { path }) = plans.pending.lock().map_err(err)?.remove(&token) {
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    })
    .await
    .map_err(err)?
}

// Missing references stay in place; newly found files are appended. Explicit
// relocation matches a missing original only by its filename, type and size.
pub(super) fn refresh_folder(
    c: &mut Connection,
    original: &Value,
    files: &[crate::importing::MaintenanceFile],
    directory: &str,
    apply: bool,
) -> Result<Value> {
    let id = text(original, "id");
    let latest = get(c, "albums", id, true)?.ok_or("写真集已不存在")?;
    if latest != *original {
        return Err("写真资料已更新，请重新扫描核对".into());
    }
    let conflict: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM entities WHERE kind='albums' AND source=? AND id<>?)",
            rusqlite::params![path_key(directory), id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if conflict {
        return Err("这个目录已属于另一套写真，不能覆盖".into());
    }
    let mut album = latest.clone();
    let content = ids(&album, "mediaIds");
    let old: Vec<Value> = content
        .iter()
        .filter_map(|mid| get(c, "media", mid, true).transpose())
        .collect::<Result<_>>()?;
    let mut claimed = HashSet::new();
    let mut edits = vec![];
    let mut moved = 0;
    let mut changed = 0;
    let mut missing = 0;
    let mut added = 0;
    for item in old {
        let source = path_key(text(&item, "sourcePath"));
        let matched = files
            .iter()
            .find(|f| path_key(&f.path) == source)
            .or_else(|| {
                if path_key(directory) == path_key(text(original, "sourceDirectory"))
                    || Path::new(text(&item, "sourcePath")).exists()
                {
                    None
                } else {
                    files.iter().find(|f| {
                        f.name.to_lowercase() == text(&item, "name").to_lowercase()
                            && f.kind == text(&item, "kind")
                            && Some(f.size) == item["size"].as_u64()
                    })
                }
            });
        if let Some(file) = matched {
            claimed.insert(path_key(&file.path));
            let mut next = item.clone();
            if source != path_key(&file.path) {
                moved += 1;
                next["sourcePath"] = json!(file.path);
                next["src"] = json!(format!(
                    "http://jingji.localhost/media/{}",
                    percent_encoding::utf8_percent_encode(
                        text(&item, "id"),
                        percent_encoding::NON_ALPHANUMERIC
                    )
                ));
            }
            let revised = item["sourceRevision"]
                .as_str()
                .or_else(|| item["metadataRevision"].as_str())
                .is_some_and(|r| r != file.revision);
            let contents_changed = item["size"] != file.size || revised;
            if contents_changed {
                changed += 1;
            }
            if contents_changed || source != path_key(&file.path) {
                // A replacement invalidates every derived field, including the
                // poster used by album previews; refresh header dimensions now.
                invalidate_file_metadata(&mut next, file.width, file.height);
            }
            next["size"] = json!(file.size);
            next["sourceRevision"] = json!(file.revision);
            if file.width > 0 && item["width"].as_u64().unwrap_or(0) == 0 {
                next["width"] = json!(file.width);
                next["height"] = json!(file.height);
            }
            if next != item {
                edits.push(next);
            }
        } else {
            missing += 1;
        }
    }
    let mut media_ids = content;
    for file in files
        .iter()
        .filter(|f| !claimed.contains(&path_key(&f.path)))
    {
        let existing: Option<String> = c
            .query_row(
                "SELECT id FROM entities WHERE kind='media' AND source=?",
                [path_key(&file.path)],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let mid = existing.unwrap_or_else(|| {
            use sha2::{Digest, Sha256};
            format!(
                "file-{:x}",
                Sha256::digest(format!("{}:{}", path_key(&file.path), stamp()))
            )
        });
        if !media_ids.contains(&mid) {
            media_ids.push(mid.clone());
            added += 1;
        }
        if get(c, "media", &mid, false)?.is_none() {
            edits.push(json!({"id":mid,"kind":file.kind,"name":file.name,"sourcePath":file.path,"sourceRevision":file.revision,"src":format!("http://jingji.localhost/media/{}",percent_encoding::utf8_percent_encode(&mid,percent_encoding::NON_ALPHANUMERIC)),"width":file.width,"height":file.height,"size":file.size,"tags":[],"favorite":false,"liked":false,"rating":0}));
        }
    }
    album["mediaIds"] = json!(media_ids);
    album["sourceDirectory"] = json!(directory);
    let result = json!({"albumId":id,"name":text(&album,"name"),"directory":directory,"added":added,"moved":moved,"changed":changed,"missing":missing,"updated":!edits.is_empty() || album != latest});
    if apply && (!edits.is_empty() || album != latest) {
        let tx = c.transaction().map_err(err)?;
        for media in &edits {
            let conflict:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM entities WHERE kind='media' AND source=? AND id<>?)",rusqlite::params![path_key(text(media,"sourcePath")),text(media,"id")],|r|r.get(0)).map_err(err)?;
            if conflict {
                return Err("替换文件已登记为另一项媒体，请先处理重复引用".into());
            }
            put(&tx, "media", media)?;
            tx.execute(
                "INSERT OR IGNORE INTO authorized VALUES(?)",
                [path_key(text(media, "sourcePath"))],
            )
            .map_err(err)?;
            for aid in super::entities::affected(&tx, "media", text(media, "id"))? {
                rebuild(&tx, &aid)?;
            }
        }
        if album != latest || !edits.is_empty() {
            album["updatedAt"] = json!(tx
                .query_row("SELECT date('now')", [], |r| r.get::<_, String>(0))
                .map_err(err)?);
            put(&tx, "albums", &album)?;
        }
        rebuild(&tx, id)?;
        tx.commit().map_err(err)?;
    }
    Ok(result)
}
#[tauri::command]
pub async fn prepare_folder_refresh(
    app: tauri::AppHandle,
    album_id: String,
    relocate: Option<bool>,
) -> Result<Option<Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        let album = {
            let state = app.state::<CatalogState>();
            let c = state.connection.lock().map_err(err)?;
            get(&c, "albums", &album_id, true)?.ok_or("写真集已不存在")?
        };
        let directory = if relocate == Some(true) {
            let Some(file) = app
                .dialog()
                .file()
                .set_title("选择写真现在所在的文件夹")
                .blocking_pick_folder()
            else {
                return Ok(None);
            };
            file.into_path()
                .map_err(err)?
                .canonicalize()
                .map_err(err)?
                .to_string_lossy()
                .into_owned()
        } else {
            text(&album, "sourceDirectory").to_owned()
        };
        if directory.is_empty() {
            return Err("这个写真集没有登记来源文件夹".into());
        }
        let files = crate::importing::scan_existing_folder(Path::new(&directory))?;
        let state = app.state::<CatalogState>();
        let mut c = state.connection.lock().map_err(err)?;
        let mut result = refresh_folder(&mut c, &album, &files, &directory, false)?;
        drop(c);
        let token = stamp();
        result["token"] = json!(token);
        app.state::<MaintenanceState>()
            .pending
            .lock()
            .map_err(err)?
            .insert(
                token,
                Plan::Folder {
                    album,
                    files,
                    directory,
                },
            );
        Ok(Some(result))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn confirm_folder_refresh(app: tauri::AppHandle, token: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let plans = app.state::<MaintenanceState>();
        let pending = plans.pending.lock().map_err(err)?;
        let Some(Plan::Folder {
            album,
            files,
            directory,
        }) = pending.get(&token)
        else {
            return Err("扫描预览已失效，请重新扫描".into());
        };
        let current = crate::importing::scan_existing_folder(Path::new(directory))?;
        if serde_json::to_value(&current).map_err(err)?
            != serde_json::to_value(files).map_err(err)?
        {
            return Err("目录内容已改变，请重新扫描核对".into());
        }
        let state = app.state::<CatalogState>();
        let mut c = state.connection.lock().map_err(err)?;
        c.backup(
            rusqlite::MAIN_DB,
            app.path()
                .app_data_dir()
                .map_err(err)?
                .join(format!("before-folder-refresh-{}.sqlite3", stamp())),
            None,
        )
        .map_err(err)?;
        refresh_folder(&mut c, album, files, directory, true)?;
        drop(c);
        drop(pending);
        plans.pending.lock().map_err(err)?.remove(&token);
        Ok(())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn catalog_sync_folders(app: tauri::AppHandle) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<CatalogState>();
        let albums={let c=state.connection.lock().map_err(err)?;
            if meta(&c,"settings",json!({}))?["syncImportedFolders"]!=true {return Ok(json!({"changed":0,"issues":0}));}
            let plans=app.state::<MaintenanceState>();let mut cursor=plans.cursor.lock().map_err(err)?;
            let rows=query_ids(&c,"SELECT id FROM entities WHERE kind='albums' AND source<>'' ORDER BY id LIMIT 32 OFFSET ?", &[&(*cursor as i64)])?;
            *cursor=if rows.len()<32 {0}else{*cursor+32};
            rows.iter().filter_map(|id|get(&c,"albums",id,true).transpose()).collect::<Result<Vec<_>>>()?
        };
        let mut changed=0;let mut issues=0;
        for album in albums {
            let directory=text(&album,"sourceDirectory");
            let result=(|| {
                let files=crate::importing::scan_existing_folder(Path::new(directory))?;
                let canonical=Path::new(directory).canonicalize().map_err(err)?;
                if path_key(&canonical.to_string_lossy())!=path_key(directory) {return Err("目录权限已失效".into());}
                let mut c=state.connection.lock().map_err(err)?;
                // Recheck the opt-in under the write lock.
                if meta(&c,"settings",json!({}))?["syncImportedFolders"]!=true {return Ok(false);}
                let result=refresh_folder(&mut c,&album,&files,directory,true)?;
                Ok::<bool,String>(result["updated"]==true)
            })();
            match result {Ok(true)=>changed+=1,Ok(false)=>{},Err(_)=>issues+=1}
        }
        Ok(json!({"changed":changed,"issues":issues}))
    }).await.map_err(err)?
}

#[tauri::command]
pub async fn prepare_media_relink(app: tauri::AppHandle, id: String) -> Result<Option<Value>> {
    tauri::async_runtime::spawn_blocking(move||{
        let original={let state=app.state::<CatalogState>();let c=state.connection.lock().map_err(err)?;get(&c,"media",&id,true)?.ok_or("媒体已不存在")?};
        let Some(file)=app.dialog().file().set_title("选择这项媒体现在所在的文件").blocking_pick_file() else {return Ok(None);};
        let path=file.into_path().map_err(err)?.canonicalize().map_err(err)?;
        if crate::importing::media_kind(&path)!=Some(text(&original,"kind")) {return Err("请选择相同类型的媒体文件".into());}
        let revision=crate::video::key(&path)?;
        let token=stamp();
        let result=json!({"token":token,"name":path.file_name().unwrap_or_default().to_string_lossy(),"previousName":text(&original,"name"),"path":path.to_string_lossy()});
        app.state::<MaintenanceState>().pending.lock().map_err(err)?.insert(token,Plan::Media{original,path,revision});
        Ok(Some(result))
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn confirm_media_relink(app: tauri::AppHandle, token: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let plans = app.state::<MaintenanceState>();
        let pending = plans.pending.lock().map_err(err)?;
        let Some(Plan::Media {
            original,
            path,
            revision,
        }) = pending.get(&token)
        else {
            return Err("文件预览已失效，请重新选择".into());
        };
        if crate::video::key(path)? != *revision {
            return Err("所选文件已改变，请重新选择".into());
        }
        let state = app.state::<CatalogState>();
        let mut c = state.connection.lock().map_err(err)?;
        let id = text(original, "id");
        if get(&c, "media", id, true)?.as_ref() != Some(original) {
            return Err("媒体资料已更新，请重新选择文件".into());
        }
        let conflict: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM entities WHERE kind='media' AND source=? AND id<>?)",
                rusqlite::params![path_key(&path.to_string_lossy()), id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if conflict {
            return Err("这个文件已登记为另一项媒体，不能重复关联".into());
        }
        let mut media = original.clone();
        media["sourcePath"] = json!(path.to_string_lossy());
        media["sourceRevision"] = json!(revision);
        media["name"] = json!(path.file_name().unwrap_or_default().to_string_lossy());
        media["size"] = json!(std::fs::metadata(path).map_err(err)?.len());
        media["src"] = json!(format!(
            "http://jingji.localhost/media/{}",
            percent_encoding::utf8_percent_encode(id, percent_encoding::NON_ALPHANUMERIC)
        ));
        let (w, h) = image::image_dimensions(path).unwrap_or_default();
        invalidate_file_metadata(&mut media, w, h);
        c.backup(
            rusqlite::MAIN_DB,
            app.path()
                .app_data_dir()
                .map_err(err)?
                .join(format!("before-media-relink-{}.sqlite3", stamp())),
            None,
        )
        .map_err(err)?;
        let tx = c.transaction().map_err(err)?;
        put(&tx, "media", &media)?;
        tx.execute(
            "INSERT OR IGNORE INTO authorized VALUES(?)",
            [path_key(&path.to_string_lossy())],
        )
        .map_err(err)?;
        for aid in super::entities::affected(&tx, "media", id)? {
            rebuild(&tx, &aid)?;
        }
        tx.commit().map_err(err)?;
        drop(c);
        drop(pending);
        plans.pending.lock().map_err(err)?.remove(&token);
        Ok(())
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_restore_cleanup_is_idempotent_and_retryable() {
        let root = std::env::temp_dir().join(format!("aure-cancel-{}-{}", std::process::id(), stamp()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("staged.sqlite3");
        let token = "restore".to_owned();
        let mut pending = HashMap::new();
        // A directory at the target produces a deterministic removal failure
        // on every platform without depending on operating-system file locks.
        std::fs::create_dir(&path).unwrap();
        pending.insert(token.clone(), Plan::Restore { path: path.clone() });
        assert!(cancel_pending(&mut pending, &token).is_err());
        assert!(pending.contains_key(&token));
        std::fs::remove_dir(&path).unwrap();
        std::fs::write(&path, b"disposable staging").unwrap();
        cancel_pending(&mut pending, &token).unwrap();
        assert!(!pending.contains_key(&token));
        assert!(!path.exists());
        cancel_pending(&mut pending, &token).unwrap();
        pending.insert(token.clone(), Plan::Restore { path });
        cancel_pending(&mut pending, &token).unwrap();
        assert!(!pending.contains_key(&token));
        std::fs::remove_dir(root).unwrap();
    }
}
