use image::{ImageDecoder, ImageReader};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::BufWriter,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};
use tauri::Manager;

const MAX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_FILES: usize = 100_000;
const EDGE: u32 = 512;

pub struct ThumbnailState {
    permits: Arc<tokio::sync::Semaphore>,
    maintenance: Arc<Mutex<Maintenance>>,
}
#[derive(Default)]
struct Maintenance {
    initialized: bool,
    writes: u32,
    running: bool,
    last_attempt: Option<Instant>,
}
impl Maintenance {
    fn request(&mut self, created: bool, now: Instant) -> bool {
        if created { self.writes = self.writes.saturating_add(1); }
        if self.running || self.last_attempt.is_some_and(|last| now.duration_since(last) < Duration::from_secs(60)) {
            return false;
        }
        if self.initialized && self.writes < 32 { return false; }
        self.running = true;
        self.last_attempt = Some(now);
        true
    }
}
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

impl Default for ThumbnailState {
    fn default() -> Self {
        Self {
            permits: Arc::new(tokio::sync::Semaphore::new(2)),
            maintenance: Arc::new(Mutex::new(Maintenance::default())),
        }
    }
}
pub fn initialize(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_cache_dir()?.join("thumbnails-v1");
    fs::create_dir_all(&dir)?;
    Ok(())
}

pub(crate) fn shutdown(app: &tauri::AppHandle) {
    app.state::<ThumbnailState>().permits.close();
}

// Expose only an opaque cache fingerprint. WebView requests never supply a disk path,
// and thumbnail access does not depend on legacy asset-protocol grants.
fn cached_path(dir: &Path, key: &str) -> Result<PathBuf, String> {
    if key.len() != 64
        || !key
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("无效的缩略图标识".into());
    }
    let path = dir.join(format!("{key}.jpg"));
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("缩略图不是普通文件".into());
    }
    // Keep the logical cache path: Windows packaged-app redirection may resolve
    // an existing file and its directory to different physical namespaces.
    // The exact hex-only filename and rejected links already prevent traversal.
    Ok(path)
}

pub fn resource(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let response = |status, body: Vec<u8>| {
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", "image/jpeg")
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "no-cache")
            .body(body)
            .unwrap()
    };
    if request.method() != tauri::http::Method::GET && request.method() != tauri::http::Method::HEAD
    {
        return response(405, vec![]);
    }
    let Some(key) = request.uri().path().strip_prefix("/thumbnail/") else {
        return response(404, vec![]);
    };
    let Ok(dir) = app.path().app_cache_dir() else {
        return response(500, vec![]);
    };
    let Ok(path) = cached_path(&dir.join("thumbnails-v1"), key) else {
        return response(404, vec![]);
    };
    let Ok(bytes) = fs::read(path) else {
        return response(404, vec![]);
    };
    let len = bytes.len();
    let mut result = response(
        200,
        if request.method() == tauri::http::Method::HEAD {
            vec![]
        } else {
            bytes
        },
    );
    result.headers_mut().insert("Content-Length", len.into());
    result
}

fn cache_key(path: &Path, metadata: &fs::Metadata, edge: u32) -> Result<String, String> {
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    Ok(format!(
        "{:x}",
        Sha256::digest(
            format!("{}:{edge}:{}:{}:{modified}", if edge == EDGE { "v1" } else { "preview-v1-q92" }, path.display(), metadata.len()).as_bytes()
        )
    ))
}

// Only this dedicated directory is ever pruned. Original paths never enter this list.
fn prune(dir: &Path, byte_limit: u64, file_limit: usize, keep_recent: Duration) -> Result<(), String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if meta.is_file()
            && !meta.file_type().is_symlink()
            && path.extension().is_some_and(|e| e == "jpg")
        {
            entries.push((
                meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                meta.len(),
                path,
            ));
        }
    }
    let mut bytes: u64 = entries.iter().map(|e| e.1).sum();
    let mut count = entries.len();
    if bytes <= byte_limit && count <= file_limit { return Ok(()); }
    entries.sort_unstable_by_key(|e| e.0);
    for (modified, size, path) in entries {
        if bytes <= byte_limit && count <= file_limit {
            break;
        }
        // A returned URL must survive long enough for the WebView to fetch it.
        // The disk budget is soft while recently generated/used files are protected.
        if modified.elapsed().unwrap_or_default() < keep_recent { continue; }
        if !keep_recent.is_zero() {
            // A cache hit may have refreshed mtime since the directory snapshot.
            match fs::symlink_metadata(&path) {
                Ok(meta) if !meta.is_file() || meta.file_type().is_symlink()
                    || meta.modified().ok().and_then(|time| time.elapsed().ok())
                        .is_none_or(|age| age < keep_recent) => continue,
                Ok(_) => {},
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            }
        }
        match fs::remove_file(path) {
            Ok(()) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error.to_string()),
        }
        bytes = bytes.saturating_sub(size);
        count -= 1;
    }
    Ok(())
}

fn schedule_maintenance(state: &ThumbnailState, dir: PathBuf, created: bool) {
    let Ok(mut maintenance) = state.maintenance.lock() else { return; };
    if !maintenance.request(created, Instant::now()) { return; }
    let writes = maintenance.writes;
    drop(maintenance);
    let shared = state.maintenance.clone();
    // Directory traversal never sits between a ready thumbnail and its response.
    // Only one scan runs; writes made during it remain due for the next scan.
    tauri::async_runtime::spawn_blocking(move || {
        let result = prune(&dir, MAX_BYTES, MAX_FILES, Duration::from_secs(60));
        if let Ok(mut maintenance) = shared.lock() {
            maintenance.running = false;
            if result.is_ok() {
                maintenance.initialized = true;
                maintenance.writes = maintenance.writes.saturating_sub(writes);
            }
        }
        if let Err(error) = result { eprintln!("Thumbnail cache maintenance failed: {error}"); }
    });
}

// MJPEG can downsample during decoding. Keep the full-resolution allocation
// limit, and use the existing local FFmpeg for oversized JPEGs only.
fn large_jpeg_preview(source: &Path, dir: &Path, key: &str, edge: u32, longest: u32) -> Result<image::DynamicImage, String> {
    let lowres = (1..=3).filter(|shift| longest / (1 << shift) >= edge).max().unwrap_or(1);
    let temporary = dir.join(format!("{key}-{}-{}.decode.png", std::process::id(), TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
    let tool = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
        .map(|p| p.join("Microsoft/WinGet/Links/ffmpeg.exe"))
        .filter(|p| p.is_file()).unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let mut command = Command::new(tool);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let result = (|| {
        command.args(["-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe", "-threads", "1", "-lowres", &lowres.to_string(), "-noautorotate", "-i"])
            .arg(source).args(["-map", "0:v:0", "-frames:v", "1", "-an", "-vf", &format!("scale={edge}:{edge}:force_original_aspect_ratio=decrease"), "-threads", "1", "-f", "image2", "-c:v", "png"])
            .arg(&temporary).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        crate::native_tasks::run_tool(&mut command, &std::sync::atomic::AtomicBool::new(false), Duration::from_secs(20), "未找到 FFmpeg，无法生成超大 JPEG 的缩略图")?;
        let mut reader = ImageReader::open(&temporary).map_err(|e| e.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(edge);
        limits.max_image_height = Some(edge);
        limits.max_alloc = Some(64 * 1024 * 1024);
        reader.limits(limits);
        reader.decode().map_err(|e| e.to_string())
    })();
    let _ = fs::remove_file(temporary);
    result
}

fn generate(source: &Path, dir: &Path, edge: u32) -> Result<(PathBuf, bool), String> {
    crate::native_tasks::check_cancelled()?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let metadata = fs::metadata(source).map_err(|e| format!("原图不可用：{e}"))?;
    let key = cache_key(source, &metadata, edge)?;
    let target = dir.join(format!("{key}.jpg"));
    if target.is_file() {
        // Approximate LRU, touching hits at most once a minute.
        if fs::metadata(&target)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|d| d.as_secs() > 60)
        {
            if let Ok(file) = fs::OpenOptions::new().write(true).open(&target) {
                let _ = file.set_times(fs::FileTimes::new().set_modified(SystemTime::now()));
            }
        }
        return Ok((target, false));
    }
    let image = if source.extension().is_some_and(|e| e.eq_ignore_ascii_case("avif")) {
        avif_preview(source, dir, &key, edge)?
    } else {
    let mut reader = ImageReader::open(source)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let format = reader.format();
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("无法生成此格式的缩略图：{e}"))?;
    let oversized = decoder.total_bytes() > 192 * 1024 * 1024;
    if oversized && format != Some(image::ImageFormat::Jpeg) {
        return Err("图片解码尺寸超过缩略图内存限制".into());
    }
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut decoded = if oversized {
        let (width, height) = decoder.dimensions();
        drop(decoder);
        large_jpeg_preview(source, dir, &key, edge, width.max(height))?
    } else {
        image::DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?
    };
    decoded.apply_orientation(orientation);
    decoded
    };
    let small = if edge == EDGE { image.thumbnail(edge, edge) } else {
        image.resize(edge.min(image.width()), edge.min(image.height()), image::imageops::FilterType::Lanczos3)
    };
    drop(image);
    let temporary = dir.join(format!(
        "{key}-{}-{}.tmp",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        crate::native_tasks::check_cancelled()?;
        let file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(file);
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, if edge == EDGE { 82 } else { 92 })
            .encode_image(&small.to_rgb8())
            .map_err(|e| e.to_string())?;
        use std::io::Write;
        writer.flush().map_err(|e| e.to_string())?;
        drop(writer);
        // Do not publish stale work if an external tool changed the source during decoding.
        if cache_key(source, &fs::metadata(source).map_err(|e| e.to_string())?, edge)? != key {
            return Err("原图已改变，请重试".into());
        }
        if let Err(error) = fs::rename(&temporary, &target) {
            // A duplicate caller may have published the same fingerprint first.
            if !target.is_file() {
                return Err(error.to_string());
            }
            let _ = fs::remove_file(&temporary);
        }
        Ok((target, true))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn avif_preview(source: &Path, dir: &Path, key: &str, edge: u32) -> Result<image::DynamicImage, String> {
    use std::sync::atomic::AtomicBool;
    let probe_temp=dir.join(format!("{key}-{}.probe.json", TEMP_SEQUENCE.fetch_add(1,Ordering::Relaxed)));
    let info=crate::video::probe(source,&probe_temp,&AtomicBool::new(false))?;
    let stream=info["streams"].as_array().and_then(|s|s.first()).ok_or("AVIF 图片信息无效")?;
    let width=stream["width"].as_u64().unwrap_or(0); let height=stream["height"].as_u64().unwrap_or(0);
    if width==0 || height==0 || width>16384 || height>16384 || width.saturating_mul(height)>32*1024*1024 {return Err("AVIF 图片尺寸超过缩略图限制".into());}
    let temporary=dir.join(format!("{key}-{}.decode.png", TEMP_SEQUENCE.fetch_add(1,Ordering::Relaxed)));
    let result=(||{
        let filter=format!("scale='min({edge},iw)':'min({edge},ih)':force_original_aspect_ratio=decrease");
        let mut process=crate::video::command("ffmpeg");
        process.args(["-v","error","-nostdin","-y","-protocol_whitelist","file,pipe","-threads","2","-i"]).arg(source)
            .args(["-map","0:v:0","-frames:v","1","-an","-vf",&filter,"-threads","1","-f","image2","-c:v","png"]).arg(&temporary).stdout(Stdio::null());
        crate::native_tasks::run_tool(&mut process,&AtomicBool::new(false),Duration::from_secs(20),"未找到 FFmpeg，无法生成 AVIF 缩略图")?;
        let mut reader=ImageReader::open(&temporary).map_err(|e|e.to_string())?;
        let mut limits=image::Limits::default(); limits.max_alloc=Some(64*1024*1024); limits.max_image_width=Some(edge); limits.max_image_height=Some(edge);
        reader.limits(limits); reader.decode().map_err(|e|e.to_string())
    })();
    let _=fs::remove_file(temporary); result
}

#[tauri::command]
pub async fn image_thumbnail(app: tauri::AppHandle, source: String, edge: Option<u32>) -> Result<String, String> {
    let task = crate::native_tasks::start()?;
    let edge = edge.unwrap_or(EDGE);
    if ![512, 1024, 2048, 3072].contains(&edge) { return Err("无效的预览尺寸".into()); }
    let state = app.state::<ThumbnailState>();
    let permit = state
        .permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _task = task;
        let _permit = permit;
        crate::native_tasks::check_cancelled()?;
        let video = source.strip_prefix("video:").map(|descriptor| {
            let (id, percent) = descriptor.rsplit_once(':').ok_or("视频封面参数无效")?;
            let id = percent_encoding::percent_decode_str(id).decode_utf8().map_err(|e| e.to_string())?.into_owned();
            let percent = percent.parse::<u8>().map_err(|e| e.to_string())?;
            if ![10, 50, 90].contains(&percent) { return Err("视频封面位置无效".to_owned()); }
            Ok::<_, String>((id, percent))
        }).transpose()?;
        let source = (if let Some((id, _)) = &video {
            crate::catalog::authorized_video_path(&app, id)?
        } else if let Some(id) = source.strip_prefix("media:") {
            crate::catalog::media_path(&app, id)?
        } else {
            PathBuf::from(source)
        })
        .canonicalize()
        .map_err(|e| e.to_string())?;
        if !crate::catalog::authorized(&app, &source) {
            return Err("此文件未经目录选择授权".into());
        }
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("thumbnails-v1");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let state = app.state::<ThumbnailState>();
        // Do not hold the maintenance lock while decoding: two workers can progress.
        let (path, created) = if let Some((_, percent)) = video {
            crate::video::poster(&source, &dir, percent)?
        } else { generate(&source, &dir, edge)? };
        schedule_maintenance(&state, dir, created);
        let key = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("缩略图标识无效")?;
        Ok(format!("http://jingji.localhost/thumbnail/{key}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maintenance_coalesces_throttles_and_retries_without_losing_writes() {
        let mut state = Maintenance::default();
        let now = Instant::now();
        assert!(state.request(false, now));
        for _ in 0..40 { assert!(!state.request(true, now)); }
        state.running = false;
        assert!(!state.request(false, now + Duration::from_secs(59)));
        // A failed first scan retries after the cooldown.
        assert!(state.request(false, now + Duration::from_secs(60)));
        state.running = false;
        state.initialized = true;
        state.writes = 0;
        assert!(!state.request(false, now + Duration::from_secs(120)));
        for _ in 0..31 { assert!(!state.request(true, now + Duration::from_secs(120))); }
        assert!(state.request(true, now + Duration::from_secs(120)));
    }

    #[test]
    fn pruning_protects_recent_responses_and_ignores_temporary_files() {
        let dir = std::env::temp_dir().join(format!("aure-prune-recent-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.jpg");
        let recent = dir.join("recent.jpg");
        let temporary = dir.join("pending.tmp");
        fs::write(&old, b"old").unwrap();
        fs::OpenOptions::new().write(true).open(&old).unwrap()
            .set_times(fs::FileTimes::new().set_modified(SystemTime::UNIX_EPOCH)).unwrap();
        fs::write(&recent, b"recent").unwrap();
        fs::write(&temporary, b"temporary").unwrap();
        prune(&dir, 0, 0, Duration::from_secs(60)).unwrap();
        assert!(!old.exists());
        assert!(recent.exists());
        assert!(temporary.exists());
        prune(&dir, 0, 0, Duration::ZERO).unwrap();
        assert!(!recent.exists());
        assert!(temporary.exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn oversized_jpeg_uses_reduced_decode_preserves_orientation_and_original() {
        let root = std::env::temp_dir().join(format!("aure-large-jpeg-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("original.jpg");
        let status = Command::new("ffmpeg").args(["-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=red:s=8200x8300", "-frames:v", "1", "-threads", "1"])
            .arg(&source).status().expect("FFmpeg is required for oversized JPEG support");
        assert!(status.success());
        // APP1 / EXIF orientation 6: clockwise 90 degrees. FFmpeg must leave
        // orientation to our shared thumbnail path, which applies it once.
        let jpeg = fs::read(&source).unwrap();
        let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut original = jpeg[..2].to_vec();
        original.extend_from_slice(&[0xff, 0xe1]);
        original.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        original.extend_from_slice(exif);
        original.extend_from_slice(&jpeg[2..]);
        fs::write(&source, &original).unwrap();
        let decoder = ImageReader::open(&source).unwrap().into_decoder().unwrap();
        assert!(decoder.total_bytes() > 192 * 1024 * 1024);
        let dir = root.join("cache");
        for edge in [512, 3072] {
            let (thumbnail, created) = generate(&source, &dir, edge).unwrap();
            assert!(created);
            let (width, height) = image::image_dimensions(&thumbnail).unwrap();
            assert_eq!(width, edge);
            assert!(height < width);
            assert_eq!((thumbnail, false), generate(&source, &dir, edge).unwrap());
        }
        assert_eq!(original, fs::read(&source).unwrap());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn serves_only_plain_cache_files_with_exact_fingerprints() {
        let dir = std::env::temp_dir().join(format!("aure-thumb-path-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let key = "a".repeat(64);
        let file = dir.join(format!("{key}.jpg"));
        fs::write(&file, b"thumbnail").unwrap();
        assert_eq!(cached_path(&dir, &key).unwrap(), file);
        for invalid in [
            "../original",
            "C:/original.jpg",
            "",
            &"A".repeat(64),
            &"a".repeat(63),
            &format!("{key}/other"),
        ] {
            assert!(cached_path(&dir, invalid).is_err());
        }
        assert!(cached_path(&dir, &"b".repeat(64)).is_err());
        fs::remove_file(file).unwrap();
        fs::create_dir(dir.join(format!("{key}.jpg"))).unwrap();
        assert!(cached_path(&dir, &key).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn bounds_dimensions_reuses_cache_invalidates_and_preserves_source() {
        let root = std::env::temp_dir().join(format!("jingji-thumbs-{}", std::process::id()));
        let dir = root.join("cache");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("original.png");
        image::RgbImage::new(1800, 1200).save(&source).unwrap();
        let original = fs::read(&source).unwrap();
        let (first, created) = generate(&source, &dir, EDGE).unwrap();
        assert!(created);
        assert_eq!(image::image_dimensions(&first).unwrap(), (512, 341));
        assert_eq!((first.clone(), false), generate(&source, &dir, EDGE).unwrap());
        assert_eq!(original, fs::read(&source).unwrap());
        image::RgbImage::new(600, 1200).save(&source).unwrap();
        let (second, _) = generate(&source, &dir, EDGE).unwrap();
        assert_ne!(first, second);
        assert_eq!(image::image_dimensions(second).unwrap(), (256, 512));
        prune(&dir, 0, 0, Duration::ZERO).unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        assert!(source.is_file());
        fs::write(&source, b"broken image").unwrap();
        assert!(generate(&source, &dir, EDGE).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn detail_preview_has_separate_high_resolution_cache_and_never_upscales() {
        let root = std::env::temp_dir().join(format!("aure-detail-thumbs-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("portrait.png");
        image::RgbImage::new(1600, 2400).save(&source).unwrap();
        let before = fs::read(&source).unwrap();
        let dir = root.join("cache");
        let (list, _) = generate(&source, &dir, 512).unwrap();
        let (detail, _) = generate(&source, &dir, 2048).unwrap();
        assert_ne!(list, detail);
        assert_eq!(image::image_dimensions(list).unwrap(), (341, 512));
        assert_eq!(image::image_dimensions(&detail).unwrap(), (1365, 2048));
        assert_eq!((detail, false), generate(&source, &dir, 2048).unwrap());
        let (largest, _) = generate(&source, &dir, 3072).unwrap();
        assert_eq!(image::image_dimensions(largest).unwrap(), (1600, 2400));
        assert_eq!(before, fs::read(source).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
