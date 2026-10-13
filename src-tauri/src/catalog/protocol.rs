use super::{err, path_key, CatalogState, Result};
use rusqlite::OptionalExtension;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub(super) fn image_revision(path: &Path, metadata: &std::fs::Metadata) -> Result<String> {
    use sha2::{Digest, Sha256};
    let modified = metadata
        .modified()
        .map_err(err)?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(err)?
        .as_nanos();
    Ok(format!(
        "W/\"{:x}\"",
        Sha256::digest(
            format!(
                "{}:{}:{modified}",
                path_key(&path.to_string_lossy()),
                metadata.len()
            )
            .as_bytes()
        )
    ))
}

pub(super) fn image_not_modified(headers: &tauri::http::HeaderMap, revision: &str) -> bool {
    headers
        .get("if-none-match")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.split(',').any(|tag| {
                tag.trim() == "*"
                    || tag.trim().trim_start_matches("W/") == revision.trim_start_matches("W/")
            })
        })
}

pub fn resource(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    if request.uri().path().starts_with("/thumbnail/") {
        return crate::thumbnails::resource(app, request);
    }
    use std::io::{Read, Seek, SeekFrom};
    let fail = |code: u16| {
        tauri::http::Response::builder()
            .status(code)
            .header("Cache-Control", "no-store")
            .body(vec![])
            .unwrap()
    };
    if request.method() != tauri::http::Method::GET && request.method() != tauri::http::Method::HEAD
    {
        return fail(405);
    }
    let playback = request
        .uri()
        .path()
        .strip_prefix("/playback/")
        .and_then(|p| p.split_once('/'));
    let Some(id) = playback
        .map(|p| p.0)
        .or_else(|| request.uri().path().strip_prefix("/media/"))
    else {
        return fail(404);
    };
    let id = percent_encoding::percent_decode_str(id).decode_utf8_lossy();
    let state = app.state::<CatalogState>();
    let source=match state.connection.lock() {
        Ok(c)=>c.query_row("SELECT json_extract(e.data,'$.sourcePath'),e.media_kind FROM entities e JOIN authorized a ON a.path=e.source WHERE e.kind='media' AND e.id=?",[id.as_ref()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional().ok().flatten(),
        Err(_)=>None
    };
    let Some((source, kind)) = source else {
        return fail(403);
    };
    let mut path = PathBuf::from(&source);
    // A replaced symlink must not escape the registered canonical file.
    if path
        .canonicalize()
        .ok()
        .is_none_or(|p| path_key(&p.to_string_lossy()) != path_key(&source))
    {
        return fail(403);
    }
    if let Some((_, revision)) = playback {
        if kind != "video" {
            return fail(403);
        }
        path = match crate::video::cached_path(app, &path, revision) {
            Ok(p) => p,
            Err(_) => return fail(404),
        };
        if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return fail(403);
        }
    }
    let Ok(mut file) = std::fs::File::open(&path) else {
        return fail(404);
    };
    let Ok(info) = file.metadata() else {
        return fail(404);
    };
    let len = info.len();
    if len == 0 {
        return fail(422);
    }
    let range = request.headers().get("range").and_then(|v| v.to_str().ok());
    if kind == "image" && range.is_none() && len > 64 * 1024 * 1024 {
        return fail(413);
    }
    // Authorization, canonical path and file metadata are checked before reusing
    // a cached image. Videos retain the existing bounded range/no-store policy.
    let revision = if kind == "image" && range.is_none() {
        image_revision(&path, &info).ok()
    } else {
        None
    };
    if let Some(tag) = &revision {
        if image_not_modified(request.headers(), tag) {
            return tauri::http::Response::builder()
                .status(304)
                .header("ETag", tag)
                .header("Cache-Control", "private, no-cache")
                .body(vec![])
                .unwrap();
        }
    }
    let (start, end, partial) = if let Some(range) = range {
        let Some((a, b)) = range.strip_prefix("bytes=").and_then(|s| s.split_once('-')) else {
            return fail(416);
        };
        if b.contains(',') {
            return fail(416);
        }
        let (start, end) = if a.is_empty() {
            let Ok(n) = b.parse::<u64>() else {
                return fail(416);
            };
            (len.saturating_sub(n), len - 1)
        } else {
            let Ok(start) = a.parse::<u64>() else {
                return fail(416);
            };
            let end = if b.is_empty() {
                len - 1
            } else {
                let Ok(end) = b.parse::<u64>() else {
                    return fail(416);
                };
                end.min(len - 1)
            };
            (start, end)
        };
        if start >= len || end < start {
            return fail(416);
        }
        (
            start,
            end.min(start.saturating_add(4 * 1024 * 1024 - 1)),
            true,
        )
    } else if kind == "video" {
        (0, (len - 1).min(1024 * 1024 - 1), true)
    } else {
        if len > 64 * 1024 * 1024 {
            return fail(413);
        }
        (0, len - 1, false)
    };
    let mut bytes = Vec::new();
    if request.method() != tauri::http::Method::HEAD
        && (file.seek(SeekFrom::Start(start)).is_err()
            || file.take(end - start + 1).read_to_end(&mut bytes).is_err())
    {
        return fail(500);
    }
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "wmv" | "asf" => "video/x-ms-asf",
        "flv" | "f4v" => "video/x-flv",
        "ts" | "mts" | "m2ts" | "m2t" => "video/mp2t",
        "mpg" | "mpeg" | "mpe" | "m2v" | "vob" => "video/mpeg",
        "3gp" | "3g2" => "video/3gpp",
        "ogv" | "ogg" => "video/ogg",
        _ => "application/octet-stream",
    };
    let mut response = tauri::http::Response::builder()
        .status(if partial { 206 } else { 200 })
        .header("Content-Type", mime)
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", (end - start + 1).to_string())
        .header(
            "Cache-Control",
            if revision.is_some() {
                "private, no-cache"
            } else {
                "no-store"
            },
        );
    if let Some(tag) = revision {
        response = response.header("ETag", tag);
    }
    if partial {
        response = response.header("Content-Range", format!("bytes {start}-{end}/{len}"));
    }
    response.body(bytes).unwrap()
}
