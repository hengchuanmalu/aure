use super::entities::get;
use super::{err, path_key, CatalogState, Result};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub fn authorized(app: &tauri::AppHandle, path: &Path) -> bool {
    let key = path_key(&path.to_string_lossy());
    let state = app.state::<CatalogState>();
    if state.selected.lock().is_ok_and(|s| s.contains(&key)) {
        return true;
    }
    state.connection.lock().is_ok_and(|c| {
        c.query_row(
            "SELECT EXISTS(SELECT 1 FROM authorized WHERE path=?)",
            [key],
            |r| r.get::<_, bool>(0),
        )
        .unwrap_or(false)
    })
}
pub fn select(app: &tauri::AppHandle, paths: impl Iterator<Item = String>) -> Result<()> {
    let selected: HashSet<String> = paths.map(|p| path_key(&p)).collect();
    let state = app.state::<CatalogState>();
    // A failed later selection must not revoke media access from an unsaved editor draft.
    // These exact, explicitly selected paths remain read-only for this app session.
    state.selected.lock().map_err(err)?.extend(selected.clone());
    // Reselecting an existing directory also restores its exact registered file permissions.
    let mut c = state.connection.lock().map_err(err)?;
    let tx = c.transaction().map_err(err)?;
    for path in selected {
        tx.execute("INSERT OR IGNORE INTO authorized SELECT source FROM entities WHERE kind='media' AND source=?",[path]).map_err(err)?;
    }
    tx.commit().map_err(err)
}
pub fn prepare_profile_image(app: &tauri::AppHandle, path: &Path) -> Result<Value> {
    use sha2::{Digest, Sha256};
    let path = path
        .canonicalize()
        .map_err(|e| format!("无法读取图片：{e}"))?;
    let (width, height) =
        image::image_dimensions(&path).map_err(|e| format!("图片格式无效或不受支持：{e}"))?;
    let info = std::fs::metadata(&path).map_err(err)?;
    if !info.is_file() || info.len() > 64 * 1024 * 1024 {
        return Err("请选择不超过 64 MB 的图片文件".into());
    }
    let key = path_key(&path.to_string_lossy());
    let existing = {
        let state = app.state::<CatalogState>();
        let conn = state.connection.lock().map_err(err)?;
        let id: Option<String> = conn
            .query_row(
                "SELECT id FROM entities WHERE kind='media' AND source=?",
                [&key],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        id.map(|id| get(&conn, "media", &id, true))
            .transpose()?
            .flatten()
    };
    select(app, std::iter::once(path.to_string_lossy().into_owned()))?;
    if let Some(item) = existing {
        return Ok(item);
    }
    let id = format!("profile-image-{:x}", Sha256::digest(key.as_bytes()));
    Ok(
        json!({"id":id,"kind":"image","src":format!("http://jingji.localhost/media/{id}"),
        "sourcePath":path.to_string_lossy(),"name":path.file_name().unwrap_or_default().to_string_lossy(),
        "width":width,"height":height,"size":info.len(),"tags":[],"favorite":false,"liked":false,"rating":0}),
    )
}
pub fn media_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf> {
    let state = app.state::<CatalogState>();
    let conn = state.connection.lock().map_err(err)?;
    let path = conn
        .query_row(
            "SELECT json_extract(data,'$.sourcePath') FROM entities WHERE kind='media' AND id=?",
            [id],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(err)?
        .ok_or("媒体已不存在")?;
    Ok(PathBuf::from(path))
}
pub fn authorized_video_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf> {
    let state = app.state::<CatalogState>();
    let c = state.connection.lock().map_err(err)?;
    let source: String = c.query_row("SELECT json_extract(e.data,'$.sourcePath') FROM entities e JOIN authorized a ON a.path=e.source WHERE e.kind='media' AND e.media_kind='video' AND e.id=?",[id],|r|r.get(0)).map_err(|_|"视频不存在或未获文件授权".to_owned())?;
    let path = PathBuf::from(&source);
    if path
        .canonicalize()
        .ok()
        .is_none_or(|p| path_key(&p.to_string_lossy()) != path_key(&source))
    {
        return Err("视频文件授权已失效".into());
    }
    Ok(path)
}
