//! Read file headers on demand; failures never prevent browsing or rewrite originals.
use crate::catalog::{authorized, media_path, path_key, CatalogState};
use serde_json::{json, Value};
use std::{
    io::{BufReader, Read},
    path::Path,
    sync::{atomic::AtomicBool, Arc},
};
use tauri::Manager;

pub struct MetadataState(Arc<tokio::sync::Semaphore>);
impl Default for MetadataState {
    fn default() -> Self {
        Self(Arc::new(tokio::sync::Semaphore::new(2)))
    }
}

pub(crate) fn shutdown(app: &tauri::AppHandle) {
    app.state::<MetadataState>().0.close();
}

pub(crate) fn read(path: &Path, kind: &str, temp: &Path) -> Result<Value, String> {
    let mut result = json!({});
    if kind == "image" {
        if let Ok((w, h)) = image::image_dimensions(path) {
            result["width"] = json!(w);
            result["height"] = json!(h);
        }
        if let Ok(file) = std::fs::File::open(path) {
            // The parser reads headers/Exif only; do not decode the full bitmap.
            if let Ok(exif) = exif::Reader::new()
                .read_from_container(&mut BufReader::new(file.take(32 * 1024 * 1024)))
            {
                let mut fields = serde_json::Map::new();
                for (tag, label) in [
                    (exif::Tag::DateTimeOriginal, "拍摄时间"),
                    (exif::Tag::Make, "相机品牌"),
                    (exif::Tag::Model, "相机型号"),
                    (exif::Tag::LensModel, "镜头"),
                    (exif::Tag::FocalLength, "焦距"),
                    (exif::Tag::FNumber, "光圈"),
                    (exif::Tag::ExposureTime, "曝光时间"),
                    (exif::Tag::PhotographicSensitivity, "ISO"),
                ] {
                    if let Some(field) = exif.get_field(tag, exif::In::PRIMARY) {
                        fields.insert(
                            label.into(),
                            json!(field.display_value().with_unit(&exif).to_string()),
                        );
                    }
                }
                if let Some(field) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
                    if matches!(field.value.get_uint(0), Some(5..=8)) {
                        let w = result["width"].clone();
                        result["width"] = result["height"].clone();
                        result["height"] = w;
                    }
                }
                result["exif"] = Value::Object(fields);
            } else {
                result["exif"] = json!({});
            }
        }
        if result["width"].as_u64().unwrap_or(0) > 0 {
            return Ok(result);
        }
    }
    let info = crate::video::probe(path, temp, &AtomicBool::new(false))?;
    let stream = info["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"))
        .ok_or("没有可读取的媒体信息")?;
    result["width"] = stream["width"].clone();
    result["height"] = stream["height"].clone();
    if kind == "video" {
        if let Some(duration) = info["format"]["duration"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|s| s.is_finite() && *s >= 0.0)
        {
            result["duration"] = json!(duration);
        }
        result["codec"] = stream["codec_name"].clone();
    }
    Ok(result)
}
#[tauri::command]
pub async fn read_media_metadata(
    app: tauri::AppHandle,
    id: String,
    force: Option<bool>,
) -> Result<Value, String> {
    let task = crate::native_tasks::start()?;
    let permit = app
        .state::<MetadataState>()
        .0
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _task = task;
        let _permit = permit;
        crate::native_tasks::check_cancelled()?;
        let path = media_path(&app, &id)?;
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        if path_key(&canonical.to_string_lossy()) != path_key(&path.to_string_lossy())
            || !authorized(&app, &canonical)
        {
            return Err("媒体访问权限已失效".into());
        }
        let revision = crate::video::key(&canonical)?;
        let state = app.state::<CatalogState>();
        let kind = {
            let c = state.connection.lock().map_err(|e| e.to_string())?;
            let raw: String = c
                .query_row(
                    "SELECT data FROM entities WHERE kind='media' AND id=?",
                    [&id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            let data: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if force != Some(true) && data["metadataRevision"] == revision {
                return Ok(data);
            }
            data["kind"].as_str().ok_or("媒体类型无效")?.to_owned()
        };
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let temp = dir.join(format!(
                "metadata-{}-{}.json",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));
        let mut metadata = read(&canonical, &kind, &temp)?;
        crate::native_tasks::check_cancelled()?;
        if crate::video::key(&canonical)? != revision {
            return Err("原件已改变，请重试".into());
        }
        metadata["metadataRevision"] = json!(revision);
        let c = state.connection.lock().map_err(|e| e.to_string())?;
        // Verify that a concurrently restored/relocated record still owns this file.
        let source: String = c
            .query_row(
                "SELECT source FROM entities WHERE kind='media' AND id=?",
                [&id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if source != path_key(&canonical.to_string_lossy()) {
            return Err("媒体来源已更新，请重试".into());
        }
        c.execute(
            "UPDATE entities SET data=json_patch(data,?) WHERE kind='media' AND id=?",
            rusqlite::params![metadata.to_string(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(metadata)
    })
    .await
    .map_err(|e| e.to_string())?
}
