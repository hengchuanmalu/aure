//! Playback copies are disposable; originals and catalog records are never rewritten.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const COPY_LIMIT: u64 = 1024 * 1024 * 1024;
const CACHE_LIMIT: u64 = 2 * COPY_LIMIT;
static POSTER_SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[derive(Default)]
pub struct VideoState {
    requests: Mutex<HashMap<String, Arc<AtomicBool>>>,
    worker: Mutex<()>,
    leases: Mutex<HashMap<String, PathBuf>>,
}
pub(crate) fn command(tool: &str) -> Command {
    let candidate = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|p| p.join("Microsoft/WinGet/Links").join(format!("{tool}.exe")));
    let mut c = Command::new(
        candidate
            .filter(|p| p.is_file())
            .unwrap_or_else(|| PathBuf::from(tool)),
    );
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c.stdin(Stdio::null()).stderr(Stdio::null());
    c
}
fn cache(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("video-playback-v1");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
pub fn key(path: &Path) -> Result<String, String> {
    let m = fs::metadata(path).map_err(|_| "视频原件不存在")?;
    let modified = m
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    Ok(format!(
        "{:x}",
        Sha256::digest(format!("playback-v1:{}:{}:{modified}", path.display(), m.len()).as_bytes())
    ))
}
pub fn cached_path(
    app: &tauri::AppHandle,
    source: &Path,
    revision: &str,
) -> Result<PathBuf, String> {
    if revision.strip_prefix("preview-").unwrap_or(revision) != key(source)? {
        return Err("播放缓存已过期".into());
    }
    Ok(cache(app)?.join(format!("{revision}.mp4")))
}
fn progress(app: &tauri::AppHandle, request: &str, phase: &str, percent: f64) {
    let _ = app.emit(
        "video-preparation",
        json!({"requestId":request,"phase":phase,"percent":percent}),
    );
}
pub(crate) fn probe(path: &Path, temp: &Path, cancel: &AtomicBool) -> Result<Value, String> {
    let file = fs::File::create(temp).map_err(|e| format!("无法创建媒体信息缓存 {}：{e}", temp.display()))?;
    let result = (|| {
        let mut process = command("ffprobe");
        process.args(["-v","error","-protocol_whitelist","file,pipe","-show_entries","stream=codec_type,codec_name,pix_fmt,width,height:stream_disposition=attached_pic:format=duration","-of","json"])
            .arg(path).stdout(file);
        crate::native_tasks::run_tool(&mut process, cancel, Duration::from_secs(30), "未找到 FFmpeg / ffprobe，请安装后重试；原件仍可尝试直接播放")?;
        let mut bytes = vec![];
        fs::File::open(temp)
            .map_err(|e| e.to_string())?
            .take(1024 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|_| "视频信息读取失败".into())
    })();
    let _ = fs::remove_file(temp);
    result
}
fn supported_video(info: &Value) -> Option<&Value> {
    info["streams"]
        .as_array()?
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1)
}
// A separate, bounded JPEG cache; selecting a frame never modifies the source.
pub fn poster(path: &Path, dir: &Path, percent: u8) -> Result<(PathBuf, bool), String> {
    let revision = key(path)?;
    let fingerprint = format!("{:x}", Sha256::digest(format!("poster-v1:512:{revision}:{percent}")));
    let target = dir.join(format!("{fingerprint}.jpg"));
    if target.is_file() { return Ok((target, false)); }
    let temporary = dir.join(format!("{fingerprint}-{}-{}.tmp", std::process::id(), POSTER_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
    let cancel = AtomicBool::new(false);
    let result = (|| {
        let info = probe(path, &temporary.with_extension("json"), &cancel)?;
        supported_video(&info).ok_or("文件内没有可解码的视频轨道")?;
        let duration = info["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok()).filter(|s| s.is_finite() && *s > 0.0).unwrap_or(0.0);
        let position = if percent == 10 && duration <= 10.0 { 0.0 } else { duration * f64::from(percent) / 100.0 };
        let extract = |seek: f64| -> Result<(), String> {
            let mut process = command("ffmpeg");
            process.args(["-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-ss", &format!("{seek:.3}")]).arg("-i").arg(path)
                .args(["-map", "0:V:0", "-frames:v", "1", "-an", "-threads", "2", "-vf", "scale=512:512:force_original_aspect_ratio=decrease", "-q:v", "3", "-f", "image2"]).arg(&temporary)
                .stdout(Stdio::null());
            crate::native_tasks::run_tool(&mut process, &cancel, Duration::from_secs(20), "未找到 FFmpeg，无法提取视频封面")?;
            if fs::metadata(&temporary).map_err(|e| e.to_string())?.len() == 0 { return Err("无法提取视频封面".into()); }
            Ok(())
        };
        extract(position).or_else(|error| if position > 0.0 { extract(0.0) } else { Err(error) })?;
        if key(path)? != revision { return Err("视频已改变，请重试".into()); }
        fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
        Ok((target, true))
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}
fn direct(info: &Value, path: &Path) -> bool {
    let Some(v) = supported_video(info) else {
        return false;
    };
    let ext = path
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let audio = info["streams"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["codec_type"] == "audio")
        .all(|s| s["codec_name"] == "aac" || s["codec_name"] == "mp3");
    matches!(ext.as_str(), "mp4" | "m4v" | "mov")
        && v["codec_name"] == "h264"
        && matches!(v["pix_fmt"].as_str(), Some("yuv420p" | "yuvj420p"))
        && audio
}
fn trim_cache(app: &tauri::AppHandle, dir: &Path, keep: &Path, needed: u64) -> Result<(), String> {
    let state = app.state::<VideoState>();
    let leases = state.leases.lock().map_err(|e| e.to_string())?;
    let mut files: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let m = e.metadata().ok()?;
            (p.extension().is_some_and(|e| e == "mp4") && m.is_file()).then_some((
                p,
                m.len(),
                m.modified().ok(),
            ))
        })
        .collect();
    files.sort_by_key(|x| x.2);
    let mut size: u64 = files.iter().map(|x| x.1).sum();
    for (p, len, _) in files {
        if size + needed <= CACHE_LIMIT {
            break;
        }
        if p != keep && !leases.values().any(|v| *v == p) && fs::remove_file(p).is_ok() {
            size -= len;
        }
    }
    if size + needed > CACHE_LIMIT {
        return Err("视频播放缓存空间不足，请关闭其他视频后重试".into());
    }
    Ok(())
}
fn prepare(
    app: &tauri::AppHandle,
    id: &str,
    request: &str,
    force: bool,
    preview: bool,
    cancel: &AtomicBool,
) -> Result<Value, String> {
    let path = crate::catalog::authorized_video_path(app, id)?;
    let revision = key(&path)?;
    let dir = cache(app)?;
    let target = dir.join(format!("{revision}.mp4"));
    {
        let state = app.state::<VideoState>();
        let _jobs = state.requests.lock().map_err(|e| e.to_string())?;
        if cancel.load(Ordering::Relaxed) || crate::native_tasks::cancelled() {
            return Err("已取消视频准备".into());
        }
        state
            .leases
            .lock()
            .map_err(|e| e.to_string())?
            .insert(request.to_owned(), target.clone());
    }
    let url = format!(
        "http://jingji.localhost/playback/{}/{revision}",
        percent_encoding::utf8_percent_encode(id, percent_encoding::NON_ALPHANUMERIC)
    );
    if target.is_file() {
        // Touch for eviction order, without rewriting the copy's bytes.
        if let Ok(f) = fs::OpenOptions::new().write(true).open(&target) {
            let _ = f.set_modified(std::time::SystemTime::now());
        }
        return Ok(json!({"src":url,"compatible":true,"cached":true}));
    }
    progress(app, request, "probe", 0.0);
    let probe_temp = dir.join(format!("{request}.json"));
    let info = probe(&path, &probe_temp, cancel)?;
    let v = supported_video(&info).ok_or("文件内没有可解码的视频轨道")?;
    let details = json!({"codec":v["codec_name"],"width":v["width"],"height":v["height"]});
    if !force && direct(&info, &path) {
        return Ok(
            json!({"src":format!("http://jingji.localhost/media/{}",percent_encoding::utf8_percent_encode(id,percent_encoding::NON_ALPHANUMERIC)),"compatible":false,"details":details}),
        );
    }
    if preview {
        let duration = info["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok()).filter(|s| s.is_finite()).unwrap_or(0.0);
        return prepare_preview(app, &path, id, request, &revision, duration, cancel);
    }
    let state = app.state::<VideoState>();
    let _guard = loop {
        if cancel.load(Ordering::Relaxed) || crate::native_tasks::cancelled() {
            return Err("已取消视频准备".into());
        }
        if let Ok(g) = state.worker.try_lock() {
            break g;
        }
        progress(app, request, "queued", 0.0);
        std::thread::sleep(Duration::from_millis(200));
    };
    if target.is_file() {
        return Ok(json!({"src":url,"compatible":true,"cached":true,"details":details}));
    }
    trim_cache(app, &dir, &target, COPY_LIMIT)?;
    let partial = dir.join(format!("{request}.pending.mp4"));
    let progress_file = dir.join(format!("{request}.progress"));
    let result = (|| {
        let output = fs::File::create(&progress_file).map_err(|e| e.to_string())?;
        let mut child = command("ffmpeg")
            .args([
                "-v",
                "error",
                "-nostdin",
                "-y",
                "-protocol_whitelist",
                "file,pipe",
                "-threads",
                "2",
                "-i",
            ])
            .arg(&path)
            .args([
                "-map",
                "0:V:0",
                "-map",
                "0:a:0?",
                "-sn",
                "-dn",
                "-filter_threads",
                "2",
                "-vf",
                "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-threads",
                "2",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ac",
                "2",
                "-movflags",
                "+faststart",
                "-progress",
                "pipe:1",
                "-f",
                "mp4",
            ])
            .arg(&partial)
            .stdout(output)
            .spawn()
            .map_err(|_| "未找到 FFmpeg，无法准备兼容播放副本".to_owned())?;
        let duration = info["format"]["duration"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let start = Instant::now();
        loop {
            if cancel.load(Ordering::Relaxed) || crate::native_tasks::cancelled()
                || start.elapsed() > Duration::from_secs(7200)
                || fs::metadata(&partial).is_ok_and(|m| m.len() > COPY_LIMIT)
            {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if cancel.load(Ordering::Relaxed) || crate::native_tasks::cancelled() {
                    "已取消视频准备"
                } else {
                    "视频播放副本超过空间或时间限制"
                }
                .into());
            }
            match child.try_wait() {
                Ok(Some(s)) => {
                    if !s.success() {
                        return Err("兼容播放准备失败，请重试；原视频未修改".into());
                    }
                    break;
                }
                Ok(None) => {}
                Err(e) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(e.to_string());
                }
            }
            if let Ok(mut f) = fs::File::open(&progress_file) {
                let len = f.metadata().map(|m| m.len()).unwrap_or(0);
                let _ = f.seek(SeekFrom::Start(len.saturating_sub(8192)));
                let mut s = String::new();
                let _ = f.read_to_string(&mut s);
                let seconds = s
                    .lines()
                    .filter_map(|l| l.strip_prefix("out_time_us="))
                    .filter_map(|s| s.parse::<f64>().ok())
                    .last()
                    .unwrap_or(0.0)
                    / 1_000_000.0;
                progress(
                    app,
                    request,
                    "convert",
                    if duration > 0.0 {
                        (seconds / duration * 100.0).clamp(0.0, 99.0)
                    } else {
                        0.0
                    },
                );
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        if cancel.load(Ordering::Relaxed) || crate::native_tasks::cancelled() {
            return Err("已取消视频准备".into());
        }
        if key(&path)? != revision {
            return Err("视频原件已发生变化，请重新打开".into());
        }
        let check = probe(&partial, &probe_temp, cancel)?;
        if !direct(&check, &partial) {
            return Err("播放副本校验失败，请重试".into());
        }
        let output_duration = check["format"]["duration"]
            .as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        if duration > 0.0 && output_duration + 0.5 < duration {
            return Err("视频播放副本不完整，请重试".into());
        }
        let size = fs::metadata(&partial).map_err(|e| e.to_string())?.len();
        trim_cache(app, &dir, &target, size)?;
        fs::rename(&partial, &target).map_err(|e| e.to_string())?;
        Ok(json!({"src":url,"compatible":true,"cached":false,"details":details}))
    })();
    let _ = fs::remove_file(partial);
    let _ = fs::remove_file(progress_file);
    result
}
fn prepare_preview(app: &tauri::AppHandle, path: &Path, id: &str, request: &str, revision: &str, duration: f64, cancel: &AtomicBool) -> Result<Value, String> {
    let dir = cache(app)?;
    let target = dir.join(format!("preview-{revision}.mp4"));
    let url = format!("http://jingji.localhost/playback/{}/preview-{revision}", percent_encoding::utf8_percent_encode(id, percent_encoding::NON_ALPHANUMERIC));
    let state = app.state::<VideoState>();
    {
        let _jobs = state.requests.lock().map_err(|e| e.to_string())?;
        if cancel.load(Ordering::Relaxed) || crate::native_tasks::cancelled() { return Err("已取消视频准备".into()); }
        state.leases.lock().map_err(|e| e.to_string())?.insert(request.to_owned(), target.clone());
    }
    if target.is_file() { return Ok(json!({"src":url,"compatible":true,"cached":true,"preview":true,"duration":duration})); }
    let _guard = loop {
        if cancel.load(Ordering::Relaxed) || crate::native_tasks::cancelled() { return Err("已取消视频准备".into()); }
        if let Ok(guard) = state.worker.try_lock() { break guard; }
        std::thread::sleep(Duration::from_millis(100));
    };
    if target.is_file() { return Ok(json!({"src":url,"compatible":true,"cached":true,"preview":true,"duration":duration})); }
    trim_cache(app, &dir, &target, 32 * 1024 * 1024)?;
    let partial = dir.join(format!("{request}.preview.pending.mp4"));
    let result = (|| {
        let mut process = command("ffmpeg");
        process.args(["-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe", "-threads", "2", "-i"]).arg(path)
            .args(["-map", "0:V:0", "-t", "12", "-an", "-sn", "-dn", "-filter_threads", "2", "-vf", "scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart", "-fs", "33554432", "-f", "mp4"])
            .arg(&partial).stdout(Stdio::null());
        crate::native_tasks::run_tool(&mut process, cancel, Duration::from_secs(45), "未找到 FFmpeg，无法准备视频预览")?;
        if cancel.load(Ordering::Relaxed) || crate::native_tasks::cancelled() { return Err("已取消视频准备".into()); }
        if key(path)? != revision { return Err("视频已改变，请重试".into()); }
        let info = probe(&partial, &dir.join(format!("{request}.preview.json")), cancel)?;
        if !direct(&info, &partial) { return Err("视频预览校验失败".into()); }
        fs::rename(&partial, &target).map_err(|e| e.to_string())?;
        Ok(json!({"src":url,"compatible":true,"cached":false,"preview":true,"duration":duration}))
    })();
    if result.is_err() { let _ = fs::remove_file(partial); }
    result
}
#[tauri::command]
pub async fn prepare_video(
    app: tauri::AppHandle,
    id: String,
    request_id: String,
    force: bool,
    preview: bool,
) -> Result<Value, String> {
    let task = crate::native_tasks::start()?;
    if request_id.is_empty()
        || request_id.len() > 96
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("无效的视频请求".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<VideoState>();
        let mut jobs = state.requests.lock().map_err(|e| e.to_string())?;
        if jobs.len() >= 16 || jobs.contains_key(&request_id) {
            return Err("视频请求过多，请重试".into());
        }
        jobs.insert(request_id.clone(), cancelled.clone());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _task = task;
        let result = prepare(&app, &id, &request_id, force, preview, &cancelled);
        if result.as_ref().is_err() || result.as_ref().is_ok_and(|v| v["compatible"] != true) {
            if let Ok(mut leases) = app.state::<VideoState>().leases.lock() {
                leases.remove(&request_id);
            }
        }
        if let Ok(mut jobs) = app.state::<VideoState>().requests.lock() {
            jobs.remove(&request_id);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn cancel_video(app: tauri::AppHandle, request_id: String) {
    if let Ok(jobs) = app.state::<VideoState>().requests.lock() {
        if let Some(cancel) = jobs.get(&request_id) {
            cancel.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut leases) = app.state::<VideoState>().leases.lock() {
        leases.remove(&request_id);
    }
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Ok(jobs) = app.state::<VideoState>().requests.lock() {
        for cancel in jobs.values() {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}
pub fn idle(app: &tauri::AppHandle) -> bool {
    app.state::<VideoState>()
        .requests
        .lock()
        .is_ok_and(|jobs| jobs.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compatibility_requires_video_and_safe_audio() {
        let mut info = json!({"streams":[{"codec_type":"video","codec_name":"hevc","pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"aac"}]});
        assert!(!direct(&info, Path::new("a.mp4")));
        info["streams"][0]["codec_name"] = json!("h264");
        assert!(direct(&info, Path::new("a.mov")));
        assert!(!direct(&info, Path::new("a.mkv")));
        info["streams"][0]["pix_fmt"] = json!("yuv420p10le");
        assert!(!direct(&info, Path::new("a.mp4")));
        info["streams"][0]["pix_fmt"] = json!("yuv420p");
        info["streams"][1]["codec_name"] = json!("ac3");
        assert!(!direct(&info, Path::new("a.mp4")));
        assert!(supported_video(&json!({"streams":[{"codec_type":"audio"}]})).is_none());
    }
}
