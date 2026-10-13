
use super::database::{count, open, set_meta, values};
use super::entities::{get, put, rebuild};
use super::protocol::{image_not_modified, image_revision};
use super::queries::{album_query, recent, view};
use super::transactions::{import_snapshot, operation, patch, save_recent};
use super::*;
use serde_json::json;
use std::path::Path;
use std::time::Instant;
#[test]
fn group_removal_preserves_tags_refs_and_search() {
    let mut c=open(Path::new(":memory:")).unwrap();populate(&mut c,&small());
    let before=get(&c,"albums","a",true).unwrap().unwrap();
    let tx=c.transaction().unwrap();operation(&tx,&json!({"type":"removeTag","id":"g","group":true})).unwrap();tx.commit().unwrap();
    assert!(get(&c,"groups","g",false).unwrap().is_none());
    let tag=get(&c,"tags","t",true).unwrap().unwrap();
    assert_eq!(get(&c,"groups",text(&tag,"groupId"),false).unwrap().unwrap()["name"],"未分组");
    assert_eq!(get(&c,"albums","a",true).unwrap().unwrap()["tags"],before["tags"]);
    assert_eq!(view(&c,&json!({"route":"library","tags":["t"]})).unwrap()["total"],1);
}
#[test]
fn batch_tags_are_atomic_and_cover_full_album_media() {
    let mut c=open(Path::new(":memory:")).unwrap();populate(&mut c,&small());
    let before=get(&c,"albums","a",true).unwrap().unwrap();
    {let tx=c.transaction().unwrap();assert!(operation(&tx,&json!({"type":"addAlbumTags","albumIds":["a","missing"],"tagIds":["t"],"includeMedia":true})).is_err());}
    assert_eq!(get(&c,"albums","a",true).unwrap().unwrap(),before);
    let tx=c.transaction().unwrap();operation(&tx,&json!({"type":"addAlbumTags","albumIds":["a"],"tagIds":["t"],"includeMedia":true})).unwrap();tx.commit().unwrap();
    assert_eq!(get(&c,"media","p",true).unwrap().unwrap()["tags"],json!(["t"]));
}
#[test]
fn backup_restore_validates_before_replacing_and_preserves_recovery_data() {
    use super::maintenance::{validate_backup,restore_from};
    let root=std::env::temp_dir().join(format!("aure-restore-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();
    let backup=root.join("backup.sqlite3");let bad=root.join("bad.sqlite3");
    let mut c=open(Path::new(":memory:")).unwrap();populate(&mut c,&small());
    c.backup(rusqlite::MAIN_DB,&backup,None).unwrap();assert!(validate_backup(&backup).is_ok());
    c.execute("UPDATE entities SET name='changed',data=json_set(data,'$.name','changed') WHERE kind='albums'",[]).unwrap();
    std::fs::write(&bad,b"not sqlite").unwrap();assert!(restore_from(&mut c,&bad).is_err());
    assert_eq!(get(&c,"albums","a",true).unwrap().unwrap()["name"],"changed");
    restore_from(&mut c,&backup).unwrap();assert_ne!(get(&c,"albums","a",true).unwrap().unwrap()["name"],"changed");
    let future=Connection::open(&backup).unwrap();future.execute_batch("PRAGMA user_version=2;").unwrap();drop(future);
    assert!(restore_from(&mut c,&backup).is_err());
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn backup_restore_rejects_valid_json_with_invalid_entities_or_relationships() {
    use super::maintenance::{restore_from, validate_backup};
    let root = std::env::temp_dir().join(format!("aure-restore-invalid-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let mut c = open(Path::new(":memory:")).unwrap();
    populate(&mut c, &small());
    let original = get(&c, "albums", "a", true).unwrap().unwrap();
    for (i, mutation) in [
        "UPDATE entities SET data='42' WHERE kind='albums'",
        "UPDATE entities SET data=json_set(data,'$.id','other') WHERE kind='media'",
        "UPDATE entities SET data=json_set(data,'$.rating',6) WHERE kind='media'",
        "UPDATE entities SET kind='unsupported' WHERE kind='groups'",
        "UPDATE entities SET source='d:/unselected/file.jpg' WHERE kind='media'",
        "UPDATE entities SET media_kind='video' WHERE kind='media'",
        "UPDATE refs SET role='unsupported' WHERE role='content'",
        "ALTER TABLE refs RENAME TO old_refs; CREATE TABLE refs AS SELECT * FROM old_refs; DROP TABLE old_refs; DELETE FROM entities WHERE kind='media'",
        "UPDATE summaries SET data='42'",
    ].iter().enumerate() {
        let backup = root.join(format!("invalid-{i}.sqlite3"));
        c.backup(rusqlite::MAIN_DB, &backup, None).unwrap();
        let source = Connection::open(&backup).unwrap();
        source.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
        source.execute_batch(mutation).unwrap();
        drop(source);
        assert!(validate_backup(&backup).is_err(), "accepted {mutation}");
        assert!(restore_from(&mut c, &backup).is_err(), "restored {mutation}");
        assert_eq!(get(&c, "albums", "a", true).unwrap().unwrap(), original);
    }
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn folder_refresh_replacements_clear_metadata_and_refresh_dimensions() {
    let mut c = open(Path::new(":memory:")).unwrap();
    let mut db = small();
    db["albums"][0]["sourceDirectory"] = json!("D:/disposable-refresh");
    db["media"][0]["sourcePath"] = json!("D:/disposable-refresh/photo.jpg");
    db["media"][0]["name"] = json!("photo.jpg");
    db["media"][0]["exif"] = json!({"相机型号":"previous"});
    let mut video = db["media"][0].clone();
    video["id"] = json!("v");
    video["kind"] = json!("video");
    video["name"] = json!("clip.mp4");
    video["sourcePath"] = json!("D:/disposable-refresh/clip.mp4");
    video["src"] = json!("http://jingji.localhost/media/v");
    video["metadataRevision"] = json!("old-revision");
    video["duration"] = json!(120);
    video["codec"] = json!("h264");
    video["poster"] = json!("/old-poster.jpg");
    video["videoPosterPercent"] = json!(50);
    db["media"].as_array_mut().unwrap().push(video);
    db["albums"][0]["mediaIds"] = json!(["p", "v"]);
    populate(&mut c, &db);
    let original = get(&c, "albums", "a", true).unwrap().unwrap();
    let files = vec![
        crate::importing::MaintenanceFile { path:"D:/disposable-refresh/photo.jpg".into(), name:"photo.jpg".into(), kind:"image".into(), size:1_000, width:800, height:600, revision:"new-photo".into() },
        crate::importing::MaintenanceFile { path:"D:/disposable-refresh/clip.mp4".into(), name:"clip.mp4".into(), kind:"video".into(), size:db["media"][1]["size"].as_u64().unwrap(), width:0, height:0, revision:"new-video".into() },
    ];
    let result = super::maintenance::refresh_folder(&mut c, &original, &files, "D:/disposable-refresh", true).unwrap();
    assert_eq!(result["changed"], 2);
    let photo = get(&c, "media", "p", true).unwrap().unwrap();
    assert_eq!(photo["width"], 800);
    assert_eq!(photo["height"], 600);
    assert!(photo.get("exif").is_none());
    assert_eq!(photo["tags"], db["media"][0]["tags"]);
    assert_eq!(photo["favorite"], true);
    let video = get(&c, "media", "v", true).unwrap().unwrap();
    assert_eq!(video["width"], 0);
    assert_eq!(video["height"], 0);
    assert_eq!(video["videoPosterPercent"], 50);
    for field in ["metadataRevision", "duration", "codec", "exif", "poster"] {
        assert!(video.get(field).is_none(), "retained stale {field}");
    }
    let album = get(&c, "albums", "a", true).unwrap().unwrap();
    assert!(!album["_summary"]["previews"].as_array().unwrap().contains(&json!("/old-poster.jpg")));
    let changes = c.total_changes();
    super::maintenance::refresh_folder(&mut c, &album, &files, "D:/disposable-refresh", true).unwrap();
    assert_eq!(c.total_changes(), changes);
}
#[test]
fn folder_refresh_preserves_missing_refs_and_relocated_ids_and_is_idempotent() {
    let mut c=open(Path::new(":memory:")).unwrap();let mut db=small();
    db["media"][0]["sourcePath"]=json!("D:/disposable-missing/001.jpg");db["media"][0]["name"]=json!("001.jpg");
    db["albums"][0]["sourceDirectory"]=json!("D:/disposable-missing");populate(&mut c,&db);
    let original=get(&c,"albums","a",true).unwrap().unwrap();
    let files=vec![crate::importing::MaintenanceFile{path:"D:/replacement/001.jpg".into(),name:"001.jpg".into(),kind:"image".into(),size:db["media"][0]["size"].as_u64().unwrap(),width:100,height:50,revision:"r1".into()},crate::importing::MaintenanceFile{path:"D:/replacement/new.jpg".into(),name:"new.jpg".into(),kind:"image".into(),size:100,width:100,height:50,revision:"r1".into()}];
    let preview=super::maintenance::refresh_folder(&mut c,&original,&files,"D:/replacement",false).unwrap();assert_eq!(preview["moved"],1);assert_eq!(preview["added"],1);
    assert_eq!(get(&c,"albums","a",true).unwrap().unwrap(),original);
    super::maintenance::refresh_folder(&mut c,&original,&files,"D:/replacement",true).unwrap();
    let album=get(&c,"albums","a",true).unwrap().unwrap();assert_eq!(album["mediaIds"][0],"p");assert_eq!(album["mediaIds"].as_array().unwrap().len(),2);
    let media=get(&c,"media","p",true).unwrap().unwrap();assert_eq!(media["sourcePath"],"D:/replacement/001.jpg");assert_eq!(media["tags"],db["media"][0]["tags"]);
    let changes=c.total_changes();super::maintenance::refresh_folder(&mut c,&album,&files,"D:/replacement",true).unwrap();assert_eq!(c.total_changes(),changes);
    let missing=super::maintenance::refresh_folder(&mut c,&album,&[],"D:/replacement",true).unwrap();assert_eq!(missing["missing"],2);assert_eq!(get(&c,"albums","a",true).unwrap().unwrap()["mediaIds"],album["mediaIds"]);
}
#[test]
fn custom_avatar_is_atomic_reuses_sources_and_preserves_profile_photos() {
    let mut c = open(Path::new(":memory:")).unwrap();
    populate(&mut c, &small());
    let mut m = get(&c, "models", "m", true).unwrap().unwrap();
    let image = json!({"id":"custom-avatar","kind":"image","name":"头像.png","src":"http://jingji.localhost/media/custom-avatar",
            "sourcePath":"D:/disposable/avatar.png","width":10,"height":10,"size":100,"tags":[],"favorite":false,"liked":false,"rating":0});
    m["avatar"] = image["src"].clone();
    let mut op = json!({"type":"saveModel","model":m,"albumIds":["missing"],"avatarImage":image});
    {
        let tx = c.transaction().unwrap();
        assert!(operation(&tx, &op).is_err());
    }
    assert!(get(&c, "media", "custom-avatar", true).unwrap().is_none());
    assert_eq!(
        get(&c, "models", "m", true).unwrap().unwrap()["avatar"],
        "/demo.jpg"
    );
    op["albumIds"] = json!(["a"]);
    {
        let tx = c.transaction().unwrap();
        operation(&tx, &op).unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(
        get(&c, "models", "m", true).unwrap().unwrap()["photoIds"],
        json!(["p"])
    );
    op["avatarImage"]["id"] = json!("duplicate");
    op["avatarImage"]["src"] = json!("http://jingji.localhost/media/duplicate");
    op["model"]["avatar"] = op["avatarImage"]["src"].clone();
    {
        let tx = c.transaction().unwrap();
        operation(&tx, &op).unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(count(&c, "media").unwrap(), 2);
    assert_eq!(
        get(&c, "models", "m", true).unwrap().unwrap()["avatar"],
        "http://jingji.localhost/media/custom%2Davatar"
    );
}
#[test]
fn custom_background_is_atomic_and_does_not_change_avatar() {
    let mut c = open(Path::new(":memory:")).unwrap();
    populate(&mut c, &small());
    let mut model = get(&c, "models", "m", true).unwrap().unwrap();
    let original_avatar = model["avatar"].clone();
    let image = json!({"id":"custom-background","kind":"image","name":"背景.png","src":"http://jingji.localhost/media/custom-background",
            "sourcePath":"D:/disposable/background.png","width":800,"height":600,"size":100,"tags":[],"favorite":false,"liked":false,"rating":0});
    model["background"] = image["src"].clone();
    model["backgroundCrop"] = json!({"x":25,"y":70,"zoom":1.5});
    let mut op =
        json!({"type":"saveModel","model":model,"albumIds":["missing"],"backgroundImage":image});
    {
        let tx = c.transaction().unwrap();
        assert!(operation(&tx, &op).is_err());
    }
    assert!(get(&c, "media", "custom-background", true)
        .unwrap()
        .is_none());
    assert_eq!(
        get(&c, "models", "m", true).unwrap().unwrap()["background"],
        ""
    );
    op["albumIds"] = json!(["a"]);
    {
        let tx = c.transaction().unwrap();
        operation(&tx, &op).unwrap();
        tx.commit().unwrap();
    }
    let saved = get(&c, "models", "m", true).unwrap().unwrap();
    assert_eq!(saved["avatar"], original_avatar);
    assert_eq!(saved["photoIds"], json!(["p"]));
    assert_eq!(saved["backgroundCrop"], json!({"x":25,"y":70,"zoom":1.5}));
    op["backgroundImage"]["id"] = json!("duplicate-background");
    op["backgroundImage"]["src"] = json!("http://jingji.localhost/media/duplicate-background");
    op["model"]["background"] = op["backgroundImage"]["src"].clone();
    {
        let tx = c.transaction().unwrap();
        operation(&tx, &op).unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(count(&c, "media").unwrap(), 2);
    assert_eq!(
        get(&c, "models", "m", true).unwrap().unwrap()["background"],
        "http://jingji.localhost/media/custom%2Dbackground"
    );
}
#[test]
fn album_id_candidates_do_not_fall_back_to_all_albums() {
    let mut c = open(Path::new(":memory:")).unwrap();
    populate(&mut c, &small());
    assert_eq!(album_query(&c, &json!({"ids":[]}), 48, 0).unwrap().1, 0);
    assert_eq!(
        album_query(&c, &json!({"ids":["missing"]}), 48, 0)
            .unwrap()
            .1,
        0
    );
    assert_eq!(
        album_query(&c, &json!({"ids":["a"]}), 48, 0).unwrap().0,
        vec!["a"]
    );
    assert_eq!(album_query(&c, &json!({}), 48, 0).unwrap().1, 1);
}
#[test]
fn image_cache_revision_and_conditional_headers() {
    let path = std::env::temp_dir().join(format!("aure-image-cache-{}.jpg", std::process::id()));
    std::fs::write(&path, b"original").unwrap();
    let first = image_revision(&path, &std::fs::metadata(&path).unwrap()).unwrap();
    let mut headers = tauri::http::HeaderMap::new();
    assert!(!image_not_modified(&headers, &first));
    headers.insert(
        "if-none-match",
        format!("\"older\", {first}").parse().unwrap(),
    );
    assert!(image_not_modified(&headers, &first));
    std::fs::write(&path, b"changed original").unwrap();
    let changed = image_revision(&path, &std::fs::metadata(&path).unwrap()).unwrap();
    assert_ne!(first, changed);
    assert!(!image_not_modified(&headers, &changed));
    headers.insert(
        "if-none-match",
        changed.trim_start_matches("W/").parse().unwrap(),
    );
    assert!(image_not_modified(&headers, &changed));
    std::fs::remove_file(&path).unwrap();
    assert!(std::fs::metadata(&path).is_err());
}
fn small() -> Value {
    json!({"version":1,"groups":[{"id":"g","name":"风格"}],"tags":[{"id":"t","name":"人像","groupId":"g"}],
          "media":[{"id":"p","kind":"image","name":"照片","src":"/demo.jpg","width":6000,"height":4000,"size":20971520,"tags":["t"],"favorite":true,"liked":false,"rating":0}],
          "models":[{"id":"m","name":"模特","alias":"","bio":"","avatar":"/demo.jpg","background":"","fields":[],"links":[],"photoIds":["p"]}],
          "albums":[{"id":"a","name":"写真","number":"001","subtitle":"","description":"","cover":"/demo.jpg","mediaIds":["p"],"tags":[],"modelIds":["m"],"favorite":true,"createdAt":"2026-10-04","updatedAt":"2026-10-04"}],
          "settings":{"reducedMotion":true},"importRules":[],"recent":[]})
}
fn populate(c: &mut Connection, db: &Value) {
    let tx = c.transaction().unwrap();
    import_snapshot(&tx, db).unwrap();
    tx.commit().unwrap();
}
#[test]
fn search_suggestions_share_browser_ranking_and_never_write() {
    let fixture: Value = serde_json::from_str(include_str!("../../../tests/fixtures/search-cases.json")).unwrap();
    let mut db = small();
    db["groups"] = json!([{"id":"group","name":"风格"}]);
    db["tags"] = fixture["tags"].clone();
    db["media"] = json!([]);
    db["models"] = fixture["models"].clone();
    db["albums"] = fixture["albums"].clone();
    let mut c = open(Path::new(":memory:")).unwrap();
    populate(&mut c, &db);
    let before = c.total_changes();
    for example in fixture["cases"].as_array().unwrap() {
        let result = super::search::suggestions(&c, text(example, "query")).unwrap();
        assert_eq!(json!(result.iter().map(|item| text(item, "id")).collect::<Vec<_>>()), example["ids"], "query: {}", example["query"]);
    }
    assert_eq!(c.total_changes(), before);
    assert!(recent(&c).unwrap().is_empty());
    for i in 0..150 {
        let album = json!({"id":format!("extra-{i}"),"name":format!("林夏写真 {i}"),"modelIds":[],"mediaIds":[],"tags":[]});
        put(&c, "albums", &album).unwrap();
        rebuild(&c, text(&album, "id")).unwrap();
    }
    let result = super::search::suggestions(&c, "林夏").unwrap();
    assert_eq!(result.len(), 8);
    assert!(result.iter().any(|item| item["kind"] == "model"));
    assert!(result.iter().any(|item| item["kind"] == "tag"));
    assert_eq!(super::search::suggestions(&c, "149").unwrap()[0]["id"], "extra-149");
    put(&c, "models", &json!({"id":"model","name":"改名后","alias":"","photoIds":[]})).unwrap();
    rebuild(&c, "related").unwrap();
    assert!(!super::search::suggestions(&c, "林夏").unwrap().iter().any(|item| item["id"] == "model"));
}
#[test]
fn album_sort_directions_cover_full_catalog_and_paged_windows() {
    let mut c = open(Path::new(":memory:")).unwrap();
    let mut db = small();
    let template = db["albums"][0].clone();
    db["albums"] = json!([]);
    for i in (0..7).rev() {
        let mut album = template.clone();
        album["id"] = json!(format!("a{i}"));
        album["name"] = json!(format!("Album {i}"));
        album["createdAt"] = json!(format!("2026-10-{:02}", i + 1));
        album["updatedAt"] = json!(format!("2026-10-{:02}", 7 - i));
        db["albums"].as_array_mut().unwrap().push(album);
    }
    populate(&mut c, &db);
    for sort in ["name", "created", "updated"] {
        let mut ascending: Vec<String> = (0..7).map(|i| format!("a{i}")).collect();
        if sort == "updated" {
            ascending.reverse();
        }
        for direction in ["asc", "desc"] {
            let mut expected = ascending.clone();
            if direction == "desc" {
                expected.reverse();
            }
            let q = json!({"sort":sort,"order":direction});
            assert_eq!(album_query(&c, &q, 96, 0).unwrap().0, expected);
            assert_eq!(album_query(&c, &q, 3, 0).unwrap().0, expected[..3]);
            assert_eq!(album_query(&c, &q, 3, 3).unwrap().0, expected[3..6]);
            assert_eq!(album_query(&c, &q, 3, 6).unwrap().0, expected[6..]);
        }
        let fallback = if sort == "name" { "asc" } else { "desc" };
        assert_eq!(
            album_query(&c, &json!({"sort":sort,"order":"invalid"}), 96, 0).unwrap(),
            album_query(&c, &json!({"sort":sort,"order":fallback}), 96, 0).unwrap()
        );
    }
}
#[test]
fn viewer_cover_updates_only_cover_fields_and_preserves_paginated_relationships() {
    let mut c = open(Path::new(":memory:")).unwrap();
    let mut db = small();
    db["albums"][0]["coverCrop"] = json!({"x":30,"y":60,"zoom":2});
    for i in 0..240 {
        let mut media = db["media"][0].clone();
        media["id"] = json!(format!("photo-{i}"));
        if i == 160 {
            media["src"] = json!("/new-cover.jpg");
        }
        db["media"].as_array_mut().unwrap().push(media);
        db["albums"][0]["mediaIds"]
            .as_array_mut()
            .unwrap()
            .push(json!(format!("photo-{i}")));
    }
    let mut outside = db["media"][0].clone();
    outside["id"] = json!("outside");
    db["media"].as_array_mut().unwrap().push(outside);
    let mut video = db["media"][0].clone();
    video["id"] = json!("video");
    video["kind"] = json!("video");
    db["media"].as_array_mut().unwrap().push(video);
    db["albums"][0]["mediaIds"]
        .as_array_mut()
        .unwrap()
        .push(json!("video"));
    populate(&mut c, &db);
    let refs_before = values(&c, "SELECT json_array(owner_kind,owner,target_kind,target,role,position) FROM refs ORDER BY rowid", &[]).unwrap();
    let media_before = values(
        &c,
        "SELECT data FROM entities WHERE kind='media' ORDER BY id",
        &[],
    )
    .unwrap();
    let mut album_before = get(&c, "albums", "a", true).unwrap().unwrap();
    let tx = c.transaction().unwrap();
    operation(
        &tx,
        &json!({"type":"setAlbumCover","albumId":"a","mediaId":"photo-160"}),
    )
    .unwrap();
    tx.commit().unwrap();
    let mut album_after = get(&c, "albums", "a", true).unwrap().unwrap();
    assert_eq!(album_after["coverMediaId"], json!("photo-160"));
    assert_eq!(album_after["cover"], json!("/new-cover.jpg"));
    assert!(album_after.get("coverCrop").is_none());
    for key in [
        "cover",
        "coverMediaId",
        "coverCrop",
        "updatedAt",
        "_summary",
    ] {
        album_before.as_object_mut().unwrap().remove(key);
        album_after.as_object_mut().unwrap().remove(key);
    }
    assert_eq!(album_after, album_before);
    assert_eq!(values(&c, "SELECT json_array(owner_kind,owner,target_kind,target,role,position) FROM refs ORDER BY rowid", &[]).unwrap(), refs_before);
    assert_eq!(
        values(
            &c,
            "SELECT data FROM entities WHERE kind='media' ORDER BY id",
            &[]
        )
        .unwrap(),
        media_before
    );
    let changes_before = c.total_changes();
    for (album, media) in [
        ("a", "outside"),
        ("a", "video"),
        ("a", "missing"),
        ("missing", "p"),
    ] {
        assert!(operation(
            &c,
            &json!({"type":"setAlbumCover","albumId":album,"mediaId":media})
        )
        .is_err());
    }
    assert_eq!(c.total_changes(), changes_before);
    assert_eq!(
        get(&c, "albums", "a", false).unwrap().unwrap()["coverMediaId"],
        json!("photo-160")
    );
}
#[test]
fn album_videos_follow_all_photos_across_pages_and_viewer_boundaries() {
    let mut c = open(Path::new(":memory:")).unwrap();
    let mut db = small();
    for (id, kind) in [("v1", "video"), ("p2", "image"), ("v0", "video")] {
        let mut media = db["media"][0].clone();
        media["id"] = json!(id);
        media["kind"] = json!(kind);
        db["media"].as_array_mut().unwrap().push(media);
    }
    db["albums"][0]["mediaIds"] = json!(["v1", "p2", "v0", "p"]);
    populate(&mut c, &db);
    let before = c.total_changes();
    assert_eq!(
        get(&c, "albums", "a", true).unwrap().unwrap()["mediaIds"],
        json!(["p2", "p", "v1", "v0"])
    );
    for (page, expected) in [(0, json!(["p2", "p"])), (1, json!(["v1", "v0"]))] {
        let result = view(&c, &json!({"route":"album","id":"a","page":page,"limit":2})).unwrap();
        assert_eq!(result["visibleMediaIds"], expected);
    }
    for (kind, sequence) in [
        ("all", vec!["p2", "p", "v1", "v0"]),
        ("image", vec!["p2", "p"]),
        ("video", vec!["v1", "v0"]),
    ] {
        for (index, id) in sequence.iter().enumerate() {
            let result = view(
                &c,
                &json!({"route":"viewer","owner":"a","id":id,"kind":kind}),
            )
            .unwrap();
            assert_eq!(result["viewer"]["index"], json!(index));
            assert_eq!(result["viewer"]["total"], json!(sequence.len()));
            assert_eq!(
                result["viewer"]["previous"],
                json!(index.checked_sub(1).map(|i| sequence[i]))
            );
            assert_eq!(result["viewer"]["next"], json!(sequence.get(index + 1)));
        }
    }
    assert_eq!(c.total_changes(), before);
}
#[test]
fn sidebar_tag_counts_include_media_and_keep_all_tags_across_pages() {
    let mut c = open(Path::new(":memory:")).unwrap();
    let mut snapshot = small();
    snapshot["tags"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"u","name":"城市","groupId":"g"}));
    snapshot["albums"][0]["tags"] = json!(["t", "u"]);
    let mut second = snapshot["albums"][0].clone();
    second["id"] = json!("b");
    second["tags"] = json!([]);
    snapshot["albums"].as_array_mut().unwrap().push(second);
    populate(&mut c, &snapshot);
    let filtered = view(
        &c,
        &json!({"route":"library","tagSidebar":true,"tags":["t","u"],"limit":1}),
    )
    .unwrap();
    assert_eq!(filtered["total"], 1);
    assert_eq!(filtered["tagAlbumCounts"]["t"], 2);
    assert_eq!(filtered["tagAlbumCounts"]["u"], 1);
    assert_eq!(filtered["db"]["albums"].as_array().unwrap().len(), 1);
    let second_page = view(
        &c,
        &json!({"route":"library","tagSidebar":true,"tags":["t"],"limit":1,"page":1}),
    )
    .unwrap();
    assert_eq!(second_page["total"], 2);
    assert_eq!(second_page["tagAlbumCounts"], filtered["tagAlbumCounts"]);
    assert_eq!(second_page["db"]["albums"].as_array().unwrap().len(), 1);
    let no_match = view(
        &c,
        &json!({"route":"library","tagSidebar":true,"tags":["u","missing"]}),
    )
    .unwrap();
    assert_eq!(no_match["total"], 0);
    assert_eq!(no_match["tagAlbumCounts"], filtered["tagAlbumCounts"]);
}
#[test]
fn detail_windows_omit_full_relationships_and_edit_reads_preserve_them() {
    let mut first_payload_bytes = [None, None];
    for size in [200, 2000] {
        let mut c = open(Path::new(":memory:")).unwrap();
        let mut snapshot = small();
        let template = snapshot["media"][0].clone();
        let mut images = vec![];
        let mut videos = vec![];
        let mut content = vec![];
        snapshot["media"] = json!([]);
        for index in 0..size {
            let id = format!("media-{index:06}");
            let video = index % 10 == 0;
            let mut media = template.clone();
            media["id"] = json!(id);
            media["src"] = json!(format!("/fixture/{id}.jpg"));
            media["kind"] = json!(if video { "video" } else { "image" });
            snapshot["media"].as_array_mut().unwrap().push(media);
            content.push(id.clone());
            if video { videos.push(id); } else { images.push(id); }
        }
        snapshot["albums"][0]["mediaIds"] = json!(content);
        snapshot["albums"][0]["coverMediaId"] = json!(images[0]);
        snapshot["models"][0]["photoIds"] = json!(images);
        snapshot["models"][0]["avatar"] = json!("/fixture/media-000001.jpg");
        snapshot["models"][0]["bio"] = json!("完整的模特资料");
        snapshot["models"][0]["fields"] = json!([{"id":"height","label":"身高","value":"170"}]);
        populate(&mut c, &snapshot);
        let before = c.total_changes();
        let ordered: Vec<_> = images.iter().chain(videos.iter()).cloned().collect();
        for page in [0, 1] {
            let window = view(&c, &json!({"route":"album","id":"a","page":page})).unwrap();
            assert_eq!(window["db"]["albums"][0]["mediaIds"], json!([]));
            assert_eq!(window["firstMediaId"], json!(images[0]));
            assert_eq!(window["total"], json!(size));
            assert_eq!(window["visibleMediaIds"], json!(&ordered[page * 96..(page + 1) * 96]));
            assert!(window["db"]["media"].as_array().unwrap().len() <= 101);
            let bytes = window.to_string().len();
            if let Some(first) = first_payload_bytes[page] {
                // Ten times more relationships must not add their IDs to each
                // response; only bounded records and count digits may differ.
                assert!(bytes <= first + 512, "detail payload grew from {first} to {bytes}");
            } else { first_payload_bytes[page] = Some(bytes); }
        }
        let video_window = view(&c, &json!({"route":"album","id":"a","kind":"video"})).unwrap();
        assert_eq!(video_window["firstMediaId"], json!(images[0]));
        assert_eq!(video_window["visibleMediaIds"][0], json!(videos[0]));
        let model_window = view(&c, &json!({"route":"model","id":"m"})).unwrap();
        assert_eq!(model_window["db"]["models"][0]["photoIds"], json!([]));
        assert_eq!(model_window["db"]["models"][0]["bio"], snapshot["models"][0]["bio"]);
        assert_eq!(model_window["db"]["models"][0]["fields"], snapshot["models"][0]["fields"]);
        assert_eq!(model_window["mediaTotal"], json!(images.len()));
        assert!(model_window["visibleMediaIds"].is_null());
        assert!(model_window["db"]["media"].as_array().unwrap().len() <= 5);
        assert_eq!(c.total_changes(), before);

        // catalog_entity uses get(..., true). Editors still receive and save
        // the complete ordered relationships outside the visible data window.
        let mut album = get(&c, "albums", "a", true).unwrap().unwrap();
        assert_eq!(album["mediaIds"], json!(ordered));
        album["name"] = json!("修改写真名称");
        operation(&c, &json!({"type":"saveAlbum","album":album})).unwrap();
        assert_eq!(get(&c, "albums", "a", true).unwrap().unwrap()["mediaIds"], json!(ordered));
        patch(&c, &json!({"albums":[{"id":"a","favorite":false}]})).unwrap();
        assert_eq!(get(&c, "albums", "a", true).unwrap().unwrap()["mediaIds"], json!(ordered));
        let mut model = get(&c, "models", "m", true).unwrap().unwrap();
        assert_eq!(model["photoIds"], json!(images));
        model["name"] = json!("修改模特名称");
        operation(&c, &json!({"type":"saveModel","model":model,"albumIds":["a"]})).unwrap();
        assert_eq!(get(&c, "models", "m", true).unwrap().unwrap()["photoIds"], json!(images));
    }
}
#[test]
fn manifest_import_commits_tags_and_relationships_atomically() {
    let mut c = open(Path::new(":memory:")).unwrap();
    populate(&mut c, &small());
    let mut album = small()["albums"][0].clone();
    album["id"] = json!("imported");
    album["sourceDirectory"] = json!("D:/test/json-set");
    album["tags"] = json!(["new-tag"]);
    let op = json!({"type":"importPrepared", "album":album, "media":[], "models":[],
            "groups":[{"id":"new-group","name":"导入标签"}],
            "tags":[{"id":"new-tag","name":"新标签","groupId":"new-group"}], "importRules":[]});
    {
        let tx = c.transaction().unwrap();
        operation(&tx, &op).unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(
        get(&c, "albums", "imported", true).unwrap().unwrap()["tags"],
        json!(["new-tag"])
    );
    assert_eq!(
        get(&c, "tags", "new-tag", true).unwrap().unwrap()["groupId"],
        "new-group"
    );
    {
        let tx = c.transaction().unwrap();
        assert!(operation(&tx, &op).is_err());
    }
    let mut invalid = op.clone();
    invalid["album"]["id"] = json!("failed");
    invalid["album"]["sourceDirectory"] = json!("D:/test/failed");
    invalid["album"]["mediaIds"] = json!(["missing"]);
    invalid["groups"][0]["id"] = json!("rollback-group");
    invalid["tags"] = json!([]);
    {
        let tx = c.transaction().unwrap();
        assert!(operation(&tx, &invalid).is_err());
    }
    assert!(get(&c, "groups", "rollback-group", false)
        .unwrap()
        .is_none());
    assert!(get(&c, "albums", "failed", true).unwrap().is_none());
}
#[test]
fn transactions_relationships_search_history_and_reopen() {
    let path = std::env::temp_dir().join(format!(
        "jingji-catalog-unit-{}.sqlite3",
        std::process::id()
    ));
    let mut c = open(&path).unwrap();
    populate(&mut c, &small());
    assert_eq!(
        view(&c, &json!({"route":"library","q":"人像"})).unwrap()["total"],
        1
    );
    let tx = c.transaction().unwrap();
    patch(
        &tx,
        &json!({"media":[{"id":"p","rating":4,"favorite":false}]}),
    )
    .unwrap();
    tx.commit().unwrap();
    let before = c.total_changes();
    let tx = c.transaction().unwrap();
    save_recent(
        &tx,
        Some(&json!({"albumId":"a","mediaId":"p","at":"2026-10-04T08:00:00Z"})),
    )
    .unwrap();
    tx.commit().unwrap();
    assert!(c.total_changes() - before < 5);
    drop(c);
    let mut c = open(&path).unwrap();
    assert_eq!(get(&c, "media", "p", true).unwrap().unwrap()["rating"], 4);
    let favorite_view = view(&c, &json!({"route":"viewer","owner":"favorites","id":"p"})).unwrap();
    assert_eq!(favorite_view["viewer"]["total"], 1);
    assert_eq!(recent(&c).unwrap().len(), 1);
    // A failed album save must roll back even its earlier metadata writes.
    let mut a = get(&c, "albums", "a", true).unwrap().unwrap();
    a["name"] = json!("不可提交");
    a["mediaIds"] = json!(["missing"]);
    {
        let tx = c.transaction().unwrap();
        assert!(operation(&tx, &json!({"type":"saveAlbum","album":a})).is_err());
    }
    assert_eq!(
        get(&c, "albums", "a", true).unwrap().unwrap()["name"],
        "写真"
    );
    let tx = c.transaction().unwrap();
    operation(&tx, &json!({"type":"removeTag","id":"g","group":true})).unwrap();
    tx.commit().unwrap();
    assert_eq!(
        view(&c, &json!({"route":"library","q":"人像"})).unwrap()["total"],
        1
    );
    assert_eq!(
        get(&c, "media", "p", true).unwrap().unwrap()["tags"],
        json!(["t"])
    );
    let tx = c.transaction().unwrap();
    operation(&tx, &json!({"type":"removeAlbum","id":"a"})).unwrap();
    tx.commit().unwrap();
    assert!(get(&c, "media", "p", true).unwrap().is_some());
    assert!(recent(&c).unwrap().is_empty());
    drop(c);
    std::fs::remove_file(path).unwrap();
}
#[test]
fn large_native_catalog_has_bounded_reads_and_local_writes() {
    for (albums, media) in [(1000, 100000), (5000, 300000)] {
        let mut c = open(Path::new(":memory:")).unwrap();
        let start = Instant::now();
        let tx = c.transaction().unwrap();
        put(&tx, "groups", &json!({"id":"g","name":"风格"})).unwrap();
        put(&tx, "tags", &json!({"id":"t","name":"人像","groupId":"g"})).unwrap();
        put(&tx,"models",&json!({"id":"m","name":"模特","alias":"","bio":"","avatar":"/demo.jpg","background":"","fields":[],"links":[],"photoIds":[]})).unwrap();
        for i in 0..media {
            put(&tx,"media",&json!({"id":format!("p{i:06}"),"kind":"image","name":format!("照片{i}"),"src":"/demo.jpg","size":20971520,"width":6000,"height":4000,"tags":if i%7==0 {vec!["t"]}else{vec![]},"favorite":true,"liked":false,"rating":0})).unwrap();
        }
        for i in 0..albums {
            let content: Vec<String> = (i * media / albums..(i + 1) * media / albums)
                .map(|n| format!("p{n:06}"))
                .collect();
            let a = json!({"id":format!("a{i:05}"),"name":format!("写真{i:05}"),"subtitle":"","description":"","cover":"/demo.jpg","mediaIds":content,"tags":[],"modelIds":["m"],"favorite":true,"createdAt":"2026-10-04","updatedAt":"2026-10-04"});
            put(&tx, "albums", &a).unwrap();
            rebuild(&tx, text(&a, "id")).unwrap();
        }
        set_meta(&tx, "initialized", &json!(true)).unwrap();
        tx.commit().unwrap();
        let fixture_ms = start.elapsed().as_millis();
        let start = Instant::now();
        let home = view(&c, &json!({"route":"home"})).unwrap();
        let cold_ms = start.elapsed().as_millis();
        assert!(home["db"]["albums"].as_array().unwrap().len() <= 32);
        assert!(home["db"]["media"].as_array().unwrap().len() <= 160);
        assert_eq!(home["mediaCount"], media);
        let mut samples = vec![];
        for i in 0..10 {
            let start = Instant::now();
            let page = view(
                &c,
                &json!({"route":"library","q":"人像","tags":["t"],"page":i}),
            )
            .unwrap();
            samples.push(start.elapsed().as_millis());
            assert_eq!(page["total"], albums);
            assert!(page["db"]["albums"].as_array().unwrap().len() <= 96);
            assert!(page["db"]["media"].as_array().unwrap().len() <= 480);
            assert!(page["db"]["albums"]
                .as_array()
                .unwrap()
                .iter()
                .all(|a| a["mediaIds"] == json!([])));
        }
        let before = c.total_changes();
        let start = Instant::now();
        let tx = c.transaction().unwrap();
        patch(&tx, &json!({"media":[{"id":"p000000","rating":5}]})).unwrap();
        tx.commit().unwrap();
        let writes = c.total_changes() - before;
        let save_ms = start.elapsed().as_millis();
        assert!(writes < 20);
        let viewer = view(
            &c,
            &json!({"route":"viewer","owner":"favorites","id":format!("p{:06}",media-1)}),
        )
        .unwrap();
        assert_eq!(viewer["viewer"]["index"], media - 1);
        assert_eq!(viewer["viewer"]["previous"], format!("p{:06}", media - 2));
        assert!(viewer["db"]["media"].as_array().unwrap().len() <= 1);
        samples.sort();
        eprintln!(
            "{}",
            json!({"albums":albums,"media":media,"fixtureMs":fixture_ms,"homeQueryMs":cold_ms,"searchP95Ms":samples[9],"ratingSaveMs":save_ms,"ratingChangedRows":writes})
        );
        assert!(cold_ms < 3000);
        assert!(samples[9] < 1000);
    }
}
#[test]
fn canonical_windows_keys_and_future_schema_are_preserved() {
    assert_eq!(
        path_key(r"\\?\D:\Photos\A.jpg"),
        path_key(r"d:\photos\a.jpg")
    );
    assert_eq!(
        path_key(r"\\?\UNC\server\share\a.jpg"),
        path_key(r"\\server\share\a.jpg")
    );
    let path = std::env::temp_dir().join(format!("jingji-future-schema-{}.db", std::process::id()));
    let c = Connection::open(&path).unwrap();
    c.execute_batch("PRAGMA user_version=99; CREATE TABLE preserve(value TEXT); INSERT INTO preserve VALUES('keep');").unwrap();
    drop(c);
    assert!(open(&path).is_err());
    let c = Connection::open(&path).unwrap();
    assert_eq!(
        c.query_row("SELECT value FROM preserve", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "keep"
    );
    drop(c);
    std::fs::remove_file(path).unwrap();
}

