use super::authorization::{authorized, media_path};
use super::database::{count, meta};
use super::entities::{affected, get};
use super::protocol::image_revision;
use super::queries::{album_query, base, collect_media, media_query, query_ids, recent, view};
use super::transactions::{
    import_snapshot, import_snapshot_progress, operation, patch, save_recent,
};
use super::{err, path_key, text, CatalogState, Result};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{Emitter, Manager};

async fn run<T: Send + 'static>(
    app: tauri::AppHandle,
    f: impl FnOnce(&mut Connection) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CatalogState>();
        let mut c = state.connection.lock().map_err(err)?;
        f(&mut c)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn catalog_suggestions(app: tauri::AppHandle, query: String) -> Result<Vec<Value>> {
    run(app, move |c| super::search::suggestions(c, &query)).await
}
#[tauri::command]
pub async fn catalog_initialize(app: tauri::AppHandle, legacy: Option<String>) -> Result<bool> {
    run(app.clone(), move |c| {
        if meta(c, "initialized", json!(false))? == true {
            return Ok(false);
        }
        let Some(raw) = legacy else {
            return Ok(true);
        };
        let dir = app.path().app_data_dir().map_err(err)?;
        // Keep the exact legacy text. Never overwrite an earlier recovery copy.
        use std::io::Write;
        if !dir.join("legacy-v1.json").exists() {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(dir.join("legacy-v1.json"))
                .map_err(err)?;
            file.write_all(raw.as_bytes()).map_err(err)?;
            file.sync_all().map_err(err)?;
        }
        let db: Value = serde_json::from_str(&raw).map_err(err)?;
        let tx = c.transaction().map_err(err)?;
        import_snapshot_progress(&tx, &db, |phase, done, total| {
            let _ = app.emit(
                "catalog-migration-progress",
                json!({"phase":phase,"done":done,"total":total}),
            );
        })?;
        for m in db["media"].as_array().into_iter().flatten() {
            if let Some(path) = m["sourcePath"].as_str() {
                if let Ok(canonical) = PathBuf::from(path).canonicalize() {
                    if app.asset_protocol_scope().is_allowed(&canonical) {
                        tx.execute(
                            "INSERT OR IGNORE INTO authorized VALUES(?)",
                            [path_key(&canonical.to_string_lossy())],
                        )
                        .map_err(err)?;
                    }
                }
            }
        }
        tx.commit().map_err(err)?;
        Ok(true)
    })
    .await
}
#[tauri::command]
pub async fn catalog_view(app: tauri::AppHandle, query: Value) -> Result<Value> {
    run(app, move |c| {
        let mut result = view(c, &query)?;
        if text(&query, "route") == "home" {
            let mut revisions = serde_json::Map::new();
            for album in result["db"]["albums"].as_array().into_iter().flatten().take(5) {
                let src = text(album, "cover");
                let Some(encoded) = src.strip_prefix("http://jingji.localhost/media/") else { continue; };
                let id = percent_encoding::percent_decode_str(encoded).decode_utf8_lossy();
                let source: Option<String> = c.query_row("SELECT json_extract(e.data,'$.sourcePath') FROM entities e JOIN authorized a ON a.path=e.source WHERE e.kind='media' AND e.id=?", [id.as_ref()], |r| r.get(0)).optional().map_err(err)?;
                let Some(source) = source else { continue; };
                let path = PathBuf::from(source);
                let Ok(canonical) = path.canonicalize() else { continue; };
                if path_key(&canonical.to_string_lossy()) != path_key(&path.to_string_lossy()) { continue; }
                if let Ok(metadata) = std::fs::metadata(&canonical) {
                    if let Ok(revision) = image_revision(&canonical, &metadata) { revisions.insert(src.into(), json!(revision)); }
                }
            }
            result["coverRevisions"] = Value::Object(revisions);
        }
        Ok(result)
    }).await
}
#[tauri::command]
pub async fn catalog_recent(app: tauri::AppHandle, entry: Option<Value>) -> Result<Vec<Value>> {
    run(app, move |c| {
        let tx = c.transaction().map_err(err)?;
        save_recent(&tx, entry.as_ref())?;
        tx.commit().map_err(err)?;
        recent(c)
    })
    .await
}
#[tauri::command]
pub async fn catalog_restore_recent(app: tauri::AppHandle, entries: Vec<Value>) -> Result<()> {
    run(app, move |c| {
        let tx = c.transaction().map_err(err)?;
        save_recent(&tx, None)?;
        for entry in entries.iter().take(40) {
            save_recent(&tx, Some(entry))?;
        }
        tx.commit().map_err(err)
    })
    .await
}
#[tauri::command]
pub async fn catalog_patch(app: tauri::AppHandle, changes: Value) -> Result<()> {
    run(app, move |c| {
        let tx = c.transaction().map_err(err)?;
        patch(&tx, &changes)?;
        tx.commit().map_err(err)
    })
    .await
}
#[tauri::command]
pub async fn catalog_operation(app: tauri::AppHandle, op: Value) -> Result<()> {
    let selected = app
        .state::<CatalogState>()
        .selected
        .lock()
        .map_err(err)?
        .clone();
    run(app, move |c| {
        let tx = c.transaction().map_err(err)?;
        if text(&op, "type") == "importPrepared" || text(&op, "type") == "saveModel" {
            let media = if text(&op, "type") == "importPrepared" {
                op["media"]
                    .as_array()
                    .ok_or("导入媒体缺失")?
                    .iter()
                    .collect::<Vec<_>>()
            } else {
                ["avatarImage", "backgroundImage"]
                    .iter()
                    .filter_map(|key| op.get(*key).filter(|v| !v.is_null()))
                    .collect::<Vec<_>>()
            };
            for m in media {
                let path = text(m, "sourcePath");
                let key = path_key(path);
                let known = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM authorized WHERE path=?)",
                        [&key],
                        |r| r.get::<_, bool>(0),
                    )
                    .map_err(err)?;
                if !selected.contains(&key) && !known {
                    return Err("媒体未经文件选择授权".into());
                }
                tx.execute("INSERT OR IGNORE INTO authorized VALUES(?)", [key])
                    .map_err(err)?;
            }
        }
        operation(&tx, &op)?;
        tx.commit().map_err(err)
    })
    .await
}
#[tauri::command]
pub async fn catalog_entity(
    app: tauri::AppHandle,
    kind: String,
    id: String,
) -> Result<Option<Value>> {
    run(app, move |c| get(c, &kind, &id, true)).await
}
#[tauri::command]
pub async fn catalog_candidates(
    app: tauri::AppHandle,
    kind: String,
    page: i64,
    query: Value,
) -> Result<Value> {
    run(app,move|c|{
        let (rows,total)=match kind.as_str() {
            "media"=>media_query(c,&query,48,page.max(0)*48)?,
            "albums"=>album_query(c,&query,48,page.max(0)*48)?,
            "models"=>{let n=count(c,"models")?;(query_ids(c,"SELECT id FROM entities WHERE kind='models' ORDER BY name,id LIMIT 48 OFFSET ?",&[&(page.max(0)*48)])?,n)},
            _=>return Err("未知候选类型".into())
        };
        let items:Vec<Value>=rows.iter().filter_map(|id|get(c,&kind,id,false).transpose()).collect::<Result<_>>()?;
        Ok(json!({"items":items,"total":total}))
    }).await
}
#[tauri::command]
pub async fn catalog_import_context(
    app: tauri::AppHandle,
    paths: Vec<String>,
    directory: String,
    directories: Option<Vec<String>>,
) -> Result<Value> {
    run(app, move |c| {
        let mut db = base(c, true)?;
        if let Some(directories) = directories {
            for directory in directories {
                let id = c
                    .query_row(
                        "SELECT id FROM entities WHERE kind='albums' AND source=?",
                        [path_key(&directory)],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(err)?;
                if let Some(id) = id {
                    if let Some(album) = get(c, "albums", &id, true)? {
                        db["albums"]
                            .as_array_mut()
                            .ok_or("图库格式错误")?
                            .push(album);
                    }
                }
            }
        }
        if let Some(id) = c.query_row(
            "SELECT id FROM entities WHERE kind='albums' AND source=?",
            [path_key(&directory)],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(err)?
        {
            if let Some(album) = get(c, "albums", &id, true)? {
                db["albums"].as_array_mut().ok_or("图库格式错误")?.push(album);
            }
        }
        let mut rows = vec![];
        for path in paths {
            if let Some(id) = c
                .query_row(
                    "SELECT id FROM entities WHERE kind='media' AND source=?",
                    [path_key(&path)],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .map_err(err)?
            {
                rows.push(id);
            }
        }
        collect_media(c, &mut db, rows)?;
        Ok(db)
    })
    .await
}
#[tauri::command]
pub async fn catalog_model_albums(app: tauri::AppHandle, id: String) -> Result<Vec<String>> {
    run(app, move |c| affected(c, "models", &id)).await
}
#[tauri::command]
pub async fn catalog_backup(app: tauri::AppHandle) -> Result<bool> {
    use tauri_plugin_dialog::DialogExt;
    let picker = app.clone();
    let Some(path) = tauri::async_runtime::spawn_blocking(move || {
        picker
            .dialog()
            .file()
            .set_file_name("aure-catalog-backup.sqlite3")
            .add_filter("SQLite backup", &["sqlite3"])
            .blocking_save_file()
    })
    .await
    .map_err(err)?
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(err)?;
    run(app, move |c| {
        let key = path_key(&path.to_string_lossy());
        if c.path().is_some_and(|p| path_key(p) == key)
            || c.query_row(
                "SELECT EXISTS(SELECT 1 FROM entities WHERE kind='media' AND source=?)",
                [key],
                |r| r.get::<_, bool>(0),
            )
            .map_err(err)?
        {
            return Err("备份不能覆盖当前图库或媒体原件".into());
        }
        c.backup(rusqlite::MAIN_DB, &path, None).map_err(err)?;
        Ok(true)
    })
    .await
}
#[tauri::command]
pub async fn catalog_reset(app: tauri::AppHandle, seed: Value) -> Result<()> {
    run(app.clone(),move|c|{
        let dir=app.path().app_data_dir().map_err(err)?;
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(err)?.as_nanos();
        c.backup(rusqlite::MAIN_DB,dir.join(format!("before-reset-{stamp}.sqlite3")),None).map_err(err)?;
        let tx=c.transaction().map_err(err)?;
        tx.execute_batch("DELETE FROM refs; DELETE FROM entities; DELETE FROM summaries; DELETE FROM recent; DELETE FROM authorized; DELETE FROM meta;").map_err(err)?;
        import_snapshot(&tx,&seed)?;tx.commit().map_err(err)
    }).await
}

#[tauri::command]
pub async fn original_cover_revision(app: tauri::AppHandle, id: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = media_path(&app, &id)?;
        let canonical = path.canonicalize().map_err(err)?;
        if path_key(&canonical.to_string_lossy()) != path_key(&path.to_string_lossy())
            || !authorized(&app, &canonical)
        {
            return Err("图片访问权限已失效".into());
        }
        let metadata = std::fs::metadata(&canonical).map_err(err)?;
        image_revision(&canonical, &metadata)
    })
    .await
    .map_err(err)?
}
