use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::Path,
};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub struct FolderFile {
    path: String,
    name: String,
    kind: &'static str,
    size: u64,
}
#[derive(Serialize)]
pub struct FolderScan {
    path: String,
    name: String,
    #[serde(rename = "parentName")]
    parent_name: String,
    #[serde(rename = "metadataSource")]
    metadata_source: &'static str,
    files: Vec<FolderFile>,
    skipped: usize,
    manifest: AlbumManifest,
}
#[derive(Serialize)]
pub struct ScanIssue { path: String, name: String, message: String }
#[derive(Serialize)]
pub struct FolderBatchScan {
    path: String,
    name: String,
    albums: Vec<FolderScan>,
    issues: Vec<ScanIssue>,
}
#[derive(Serialize)]
#[serde(untagged)]
pub enum FolderSelection { Album(FolderScan), Batch(FolderBatchScan) }

fn linked(info: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        info.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    { info.file_type().is_symlink() }
}

// Descend only inside the chosen tree; each manifest owns exactly its current layer.
fn scan_selection(root: &Path) -> Result<FolderSelection, String> {
    let info = fs::symlink_metadata(root).map_err(|e| format!("无法打开文件夹：{e}"))?;
    if !info.is_dir() || linked(&info) { return Err("请选择普通写真文件夹".into()); }
    let root = root.canonicalize().map_err(|e| format!("无法打开文件夹：{e}"))?;
    if root.join("album.json").exists() || has_current_media(&root)? {
        return scan_folder(&root).map(FolderSelection::Album);
    }
    let mut batch = FolderBatchScan {
        path: root.to_string_lossy().into_owned(),
        name: root.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        albums: vec![], issues: vec![],
    };
    let mut stack = vec![(root, 0)];
    let mut visited = 0;
    while let Some((path, depth)) = stack.pop() {
        visited += 1;
        if visited > 20_000 { return Err("目录超过 20000 个，请分批选择模特文件夹".into()); }
        let result = (|| -> Result<(), String> {
            if path.join("album.json").exists() {
                batch.albums.push(scan_folder(&path)?);
                return Ok(());
            }
            let mut children = vec![];
            let mut has_media = false;
            for entry in fs::read_dir(&path).map_err(|e| format!("无法读取目录：{e}"))? {
                let entry = entry.map_err(|e| format!("目录读取未完成：{e}"))?;
                let info = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
                if linked(&info) { continue; }
                if info.is_dir() { children.push(entry.path()); }
                else if info.is_file() && media_kind(&entry.path()).is_some() { has_media = true; }
            }
            if has_media {
                batch.albums.push(scan_folder(&path)?);
                return Ok(());
            }
            if depth >= 8 && !children.is_empty() { return Err("目录超过 8 层，请选择更具体的文件夹".into()); }
            children.sort();
            stack.extend(children.into_iter().rev().map(|p| (p, depth + 1)));
            Ok(())
        })();
        if let Err(message) = result {
            batch.issues.push(ScanIssue { path: path.to_string_lossy().into_owned(),
                name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(), message });
        }
    }
    if batch.albums.is_empty() && batch.issues.is_empty() {
        return Err("没有找到支持的图片或视频，请选择写真、模特或写真总文件夹".into());
    }
    Ok(FolderSelection::Batch(batch))
}

fn has_current_media(path: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(path).map_err(|e| format!("无法读取目录：{e}"))? {
        let entry = entry.map_err(|e| format!("目录读取未完成：{e}"))?;
        let info = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if info.is_file() && !linked(&info) && media_kind(&entry.path()).is_some() { return Ok(true); }
    }
    Ok(false)
}

// Compare digit runs numerically without assuming three-digit padded file names.
fn natural_order(a: &str, b: &str) -> std::cmp::Ordering {
    let left = a.to_lowercase(); let right = b.to_lowercase();
    let (a_bytes, b_bytes) = (left.as_bytes(), right.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < a_bytes.len() && j < b_bytes.len() {
        let ordering;
        if a_bytes[i].is_ascii_digit() && b_bytes[j].is_ascii_digit() {
            let (start_i, start_j) = (i, j);
            while i < a_bytes.len() && a_bytes[i].is_ascii_digit() { i += 1; }
            while j < b_bytes.len() && b_bytes[j].is_ascii_digit() { j += 1; }
            let n = left[start_i..i].trim_start_matches('0');
            let m = right[start_j..j].trim_start_matches('0');
            ordering = n.len().cmp(&m.len()).then_with(|| n.cmp(m));
        } else {
            ordering = a_bytes[i].cmp(&b_bytes[j]); i += 1; j += 1;
        }
        if ordering != std::cmp::Ordering::Equal { return ordering; }
    }
    a_bytes.len().cmp(&b_bytes.len()).then_with(|| left.cmp(&right)).then_with(|| a.cmp(b))
}

pub(crate) fn media_kind(path: &Path) -> Option<&'static str> {
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif" => Some("image"),
        "mp4" | "webm" | "mov" | "m4v" | "mkv" | "avi" | "wmv" | "asf"
        | "flv" | "f4v" | "ts" | "mts" | "m2ts" | "m2t" | "mpg" | "mpeg"
        | "mpe" | "m2v" | "vob" | "3gp" | "3g2" | "ogv" | "ogg" | "rm" | "rmvb" => Some("video"),
        _ => None,
    }
}
#[derive(Clone, Serialize)]
pub(crate) struct MaintenanceFile {
    pub path: String, pub name: String, pub kind: String, pub size: u64,
    pub width: u32, pub height: u32, pub revision: String,
}
pub(crate) fn scan_existing_folder(path: &Path) -> Result<Vec<MaintenanceFile>, String> {
    let root = fs::symlink_metadata(path).map_err(|e|format!("文件夹不可用：{e}"))?;
    if !root.is_dir() || linked(&root) { return Err("请选择普通写真文件夹".into()); }
    let root = path.canonicalize().map_err(|e|e.to_string())?;
    let mut files=vec![];
    for entry in fs::read_dir(&root).map_err(|e|e.to_string())? {
        let entry=entry.map_err(|e|e.to_string())?;
        let info=fs::symlink_metadata(entry.path()).map_err(|e|e.to_string())?;
        if !info.is_file() || linked(&info) {continue;}
        let Some(kind)=media_kind(&entry.path()) else {continue;};
        if files.len()>=50_000 {return Err("单套写真超过 50000 项，请分套整理".into());}
        let (width,height)=if kind=="image" {image::image_dimensions(entry.path()).unwrap_or_default()} else {(0,0)};
        files.push(MaintenanceFile {path:entry.path().to_string_lossy().into_owned(),name:entry.file_name().to_string_lossy().into_owned(),kind:kind.into(),size:info.len(),width,height,revision:crate::video::key(&entry.path())?});
    }
    files.sort_by(|a, b| natural_order(&a.name, &b.name));
    Ok(files)
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AlbumManifest {
    version: u32,
    name: String,
    #[serde(default)]
    number: String,
    #[serde(default)]
    models: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    media: Vec<String>,
}
fn clean_names(names: &mut [String], field: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for name in names {
        *name = name.trim().to_owned();
        if name.is_empty() || !seen.insert(name.to_lowercase()) {
            return Err(format!("album.json 的 {field} 包含空值或重复项"));
        }
    }
    Ok(())
}
fn local_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':'])
}
fn read_manifest(path: &Path) -> Result<AlbumManifest, String> {
    let file_path = path.join("album.json");
    let info = fs::symlink_metadata(&file_path)
        .map_err(|_| "当前文件夹缺少 album.json，请先由整理软件生成资料文件".to_owned())?;
    if !info.is_file() || linked(&info) {
        return Err("album.json 必须是当前文件夹内的普通文件".into());
    }
    let mut bytes = vec![];
    fs::File::open(file_path)
        .map_err(|e| format!("无法读取 album.json：{e}"))?
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("无法读取 album.json：{e}"))?;
    if bytes.len() > 1_048_576 {
        return Err("album.json 超过 1 MB".into());
    }
    let mut value: AlbumManifest =
        serde_json::from_slice(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes))
            .map_err(|e| format!("album.json 格式错误：{e}"))?;
    if value.version != 1 {
        return Err("不支持该 album.json 版本，目前支持 version: 1".into());
    }
    value.name = value.name.trim().to_owned();
    value.number = value.number.trim().to_owned();
    if value.name.is_empty() {
        return Err("album.json 的 name 不能为空".into());
    }
    clean_names(&mut value.models, "models")?;
    clean_names(&mut value.tags, "tags")?;
    // File names are literal; whitespace is significant for matching on disk.
    let mut seen = HashSet::new();
    for name in &value.media {
        if !local_name(name) || !seen.insert(name.to_lowercase()) {
            return Err("album.json 的 media 必须使用不重复的当前层文件名".into());
        }
    }
    if !value.cover.is_empty() && !local_name(&value.cover) {
        return Err("album.json 的 cover 必须是当前层文件名".into());
    }
    Ok(value)
}
fn scan_folder(path: &Path) -> Result<FolderScan, String> {
    let path = path
        .canonicalize()
        .map_err(|e| format!("无法打开文件夹：{e}"))?;
    let name = path.file_name().ok_or("请选择具体的写真文件夹")?.to_string_lossy().into_owned();
    let has_manifest = path.join("album.json").try_exists().map_err(|e| format!("无法检查资料文件：{e}"))?;
    let manifest = if has_manifest { read_manifest(&path)? } else {
        AlbumManifest { version: 1, name: name.clone(), number: String::new(), models: vec![], tags: vec![], cover: String::new(), media: vec![] }
    };
    let mut result = FolderScan {
        name,
        parent_name: path.parent().and_then(|p| p.file_name()).unwrap_or_default().to_string_lossy().into_owned(),
        metadata_source: if has_manifest { "manifest" } else { "folder" },
        path: path.to_string_lossy().into_owned(),
        files: vec![],
        skipped: 0,
        manifest,
    };
    // A single selected directory is one album. Do not merge nested albums or follow links.
    for entry in fs::read_dir(&path).map_err(|e| format!("无法读取文件夹：{e}"))? {
        let entry = entry.map_err(|e| format!("目录读取未完成：{e}"))?;
        let p = entry.path();
        if entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case("album.json")
        {
            continue;
        }
        let info = fs::symlink_metadata(&p).map_err(|e| format!("无法读取文件信息：{e}"))?;
        if !info.is_file() || linked(&info) {
            result.skipped += 1;
            continue;
        }
        let extension = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = match extension.as_str() {
            "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif" => "image",
            "mp4" | "webm" | "mov" | "m4v" | "mkv" | "avi" | "wmv" | "asf"
            | "flv" | "f4v" | "ts" | "mts" | "m2ts" | "m2t" | "mpg" | "mpeg"
            | "mpe" | "m2v" | "vob" | "3gp" | "3g2" | "ogv" | "ogg" | "rm" | "rmvb" => "video",
            _ => {
                result.skipped += 1;
                continue;
            }
        };
        result.files.push(FolderFile {
            path: p.to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
            size: info.len(),
        });
        if result.files.len() > 50_000 { return Err("单套写真超过 50000 项，请分套整理".into()); }
    }
    if result.files.is_empty() {
        return Err("文件夹内没有支持的图片或视频（只扫描当前层）".into());
    }
    if has_manifest { result.files.sort_by_key(|f| f.name.to_lowercase()); }
    else { result.files.sort_by(|a, b| natural_order(&a.name, &b.name)); }
    if !result.manifest.media.is_empty() {
        let mut ordered = Vec::with_capacity(result.files.len());
        let mut files: HashMap<_, _> = result
            .files
            .drain(..)
            .map(|f| (f.name.to_ascii_lowercase(), f))
            .collect();
        for name in &result.manifest.media {
            let file = files
                .remove(&name.to_ascii_lowercase())
                .ok_or_else(|| format!("album.json 引用的媒体不存在或不受支持：{name}"))?;
            ordered.push(file);
        }
        if !files.is_empty() {
            return Err("album.json 的 media 清单未包含当前层所有支持的媒体文件".into());
        }
        result.files = ordered;
    }
    if result.manifest.cover.is_empty() {
        result.manifest.cover = result
            .files
            .iter()
            .find(|f| {
                f.kind == "image"
                    && f.name
                        .rsplit_once('.')
                        .is_some_and(|(stem, _)| stem.eq_ignore_ascii_case("cover"))
            })
            .or_else(|| result.files.iter().find(|f| f.kind == "image"))
            .map(|f| f.name.clone())
            .unwrap_or_default();
    } else if !result
        .files
        .iter()
        .any(|f| f.kind == "image" && f.name.eq_ignore_ascii_case(&result.manifest.cover))
    {
        return Err("album.json 的 cover 必须指向当前文件夹内的图片".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn select_profile_image(app: tauri::AppHandle, purpose: Option<String>) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
          let title = if purpose.as_deref() == Some("background") { "选择背景图片" } else { "选择头像图片" };
          let Some(selected) = app.dialog().file().set_title(title)
            .add_filter("图片", &["jpg", "jpeg", "png", "webp", "gif", "bmp"])
            .blocking_pick_file() else { return Ok(None); };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let image = crate::catalog::prepare_profile_image(&app, &path)?;
        Ok(Some(image))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn select_album_folder(app: tauri::AppHandle) -> Result<Option<FolderSelection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("选择写真、模特或写真总文件夹")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let result = scan_selection(&path)?;
        // Only the files successfully scanned for this selection are exposed to the WebView.
        let albums = match &result {
            FolderSelection::Album(album) => std::slice::from_ref(album),
            FolderSelection::Batch(batch) => batch.albums.as_slice(),
        };
        crate::catalog::select(&app, albums.iter().flat_map(|a| a.files.iter().map(|f| f.path.clone())))?;
        Ok(Some(result))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scans_model_and_library_roots_and_reports_invalid_albums() {
        let root = std::env::temp_dir().join(format!("aure-batch-{}", std::process::id()));
        for directory in ["Model A/Set 1", "Model A/Set 2", "Model B/Set 3", "Model B/Invalid", "Missing"] {
            fs::create_dir_all(root.join(directory)).unwrap();
            fs::write(root.join(directory).join("cover.jpg"), b"original").unwrap();
            if directory != "Missing" {
                fs::write(root.join(directory).join("album.json"), if directory.ends_with("Invalid") { b"broken".as_slice() } else { br#"{"version":1,"name":"Set","models":["Model"]}"#.as_slice() }).unwrap();
            }
        }
        let FolderSelection::Batch(batch) = scan_selection(&root).unwrap() else { panic!("expected batch") };
        assert_eq!(batch.albums.len(), 4);
        assert_eq!(batch.issues.len(), 1);
        assert!(batch.albums.iter().any(|a| a.name == "Missing" && a.metadata_source == "folder"));
        let FolderSelection::Batch(model) = scan_selection(&root.join("Model A")).unwrap() else { panic!("expected model batch") };
        assert_eq!(model.albums.len(), 2);
        assert!(matches!(scan_selection(&root.join("Model A/Set 1")).unwrap(), FolderSelection::Album(_)));
        assert_eq!(fs::read(root.join("Model A/Set 1/cover.jpg")).unwrap(), b"original");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn scans_extended_video_containers() {
        let root=std::env::temp_dir().join(format!("aure-video-scan-{}",std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("album.json"),br#"{"version":1,"name":"Video"}"#).unwrap();
        let extensions=["MP4","mov","mkv","webm","avi","wmv","asf","flv","ts","mts","m2ts","mpeg","vob","3gp","ogv","rmvb"];
        for ext in extensions {fs::write(root.join(format!("clip.{ext}")),b"test").unwrap();}
        let scan=scan_folder(&root).unwrap();
        assert_eq!(scan.files.len(),extensions.len());
        assert!(scan.files.iter().all(|f|f.kind=="video"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn scans_current_folder_without_modifying_originals() {
        let root = std::env::temp_dir().join(format!("jingji-scan-{}", std::process::id()));
        fs::create_dir_all(root.join("child")).unwrap();
        fs::write(root.join("cover.JPG"), b"test").unwrap();
        fs::write(root.join("album.json"), br#"{"version":1,"name":"Album"}"#).unwrap();
        fs::write(root.join("02.png"), b"photo").unwrap();
        fs::write(root.join("clip.MP4"), b"video").unwrap();
        fs::write(root.join("notes.txt"), b"notes").unwrap();
        fs::write(root.join("child/03.jpg"), b"nested").unwrap();
        let result = scan_folder(&root).unwrap();
        assert_eq!(result.files.len(), 3);
        assert_eq!(result.skipped, 2);
        assert_eq!(result.files.iter().filter(|f| f.kind == "image").count(), 2);
        assert_eq!(result.files.iter().map(|f| f.size).sum::<u64>(), 14);
        assert_eq!(result.manifest.cover, "cover.JPG");
        assert_eq!(fs::read(root.join("cover.JPG")).unwrap(), b"test");
        assert!(scan_folder(&root.join("missing")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn reads_manifest_order_and_rejects_invalid_references() {
        let root = std::env::temp_dir().join(format!("aure-manifest-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("001.jpg"), b"photo").unwrap();
        fs::write(root.join("002.jpg"), b"photo").unwrap();
        let good = r#"{"version":1,"name":"中文写真","number":"009","models":[" 林夏 ","江月"],"tags":["清新"],"cover":"002.jpg","media":["002.jpg","001.jpg"]}"#;
        fs::write(root.join("album.json"), format!("\u{feff}{good}")).unwrap();
        let result = scan_folder(&root).unwrap();
        assert_eq!(
            result
                .files
                .iter()
                .map(|f| f.name.as_str())
                .collect::<Vec<_>>(),
            vec!["002.jpg", "001.jpg"]
        );
        assert_eq!(result.manifest.models, vec!["林夏", "江月"]);
        assert_eq!(result.manifest.number, "009");
        for bad in [
            r#"{"version":2,"name":"A"}"#,
            r#"{"version":1,"name":" "}"#,
            r#"{"version":1,"name":"A","models":["A","a"]}"#,
            r#"{"version":1,"name":"A","media":["../001.jpg","002.jpg"]}"#,
            r#"{"version":1,"name":"A","media":["001.jpg"]}"#,
            r#"{"version":1,"name":"A","media":["missing.jpg","001.jpg"]}"#,
            r#"{"version":1,"name":"A","cover":"missing.jpg"}"#,
            r#"{"version":1,"name":"A","number":9}"#,
            "broken",
        ] {
            fs::write(root.join("album.json"), bad).unwrap();
            assert!(
                scan_folder(&root).is_err(),
                "accepted invalid manifest: {bad}"
            );
        }
        fs::write(root.join("album.json"), vec![b' '; 1_048_577]).unwrap();
        assert!(scan_folder(&root).is_err());
        fs::remove_file(root.join("album.json")).unwrap();
        let without_manifest = scan_folder(&root).unwrap();
        assert_eq!(without_manifest.metadata_source, "folder");
        assert!(!root.join("album.json").exists());
        assert_eq!(fs::read(root.join("001.jpg")).unwrap(), b"photo");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn raw_folder_keeps_original_names_and_uses_natural_order() {
        let root = std::env::temp_dir().join(format!("aure-raw-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        for name in ["10.jpg", "2.jpg", "cover.jpg", "1.mp4"] { fs::write(root.join(name), b"original").unwrap(); }
        let FolderSelection::Album(album) = scan_selection(&root).unwrap() else { panic!("expected one album"); };
        assert_eq!(album.metadata_source, "folder");
        assert_eq!(album.files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["1.mp4", "2.jpg", "10.jpg", "cover.jpg"]);
        assert_eq!(album.manifest.cover, "cover.jpg");
        let refreshed = scan_existing_folder(&root).unwrap();
        assert_eq!(refreshed.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["1.mp4", "2.jpg", "10.jpg", "cover.jpg"]);
        assert!(!root.join("album.json").exists());
        for file in &album.files { assert_eq!(fs::read(&file.path).unwrap(), b"original"); }
        fs::remove_dir_all(root).unwrap();
    }
}
