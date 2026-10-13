#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod catalog;
mod importing;
mod thumbnails;
mod video;
mod media_metadata;
mod native_tasks;
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(thumbnails::ThumbnailState::default())
        .manage(video::VideoState::default())
        .manage(media_metadata::MetadataState::default())
        .manage(catalog::maintenance::MaintenanceState::default())
        .setup(|app| {
            catalog::initialize(app.handle()).map_err(std::io::Error::other)?;
            if catalog::needs_legacy_scope(app.handle()).map_err(std::io::Error::other)? {
                // Restore legacy file grants only for the one-time migration.
                app.handle().plugin(tauri_plugin_persisted_scope::init())?;
            }
            thumbnails::initialize(app.handle())
        })
        .register_asynchronous_uri_scheme_protocol("jingji", |context, request, responder| {
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(catalog::resource(&app, request))
            });
        })
        .invoke_handler(tauri::generate_handler![
            importing::select_album_folder,
            importing::select_profile_image,
            video::prepare_video,
            video::cancel_video,
            thumbnails::image_thumbnail,
            catalog::commands::catalog_initialize,
            catalog::commands::original_cover_revision,
            catalog::commands::catalog_view,
            catalog::commands::catalog_suggestions,
            catalog::commands::catalog_recent,
            catalog::commands::catalog_restore_recent,
            catalog::commands::catalog_patch,
            catalog::commands::catalog_operation,
            catalog::commands::catalog_entity,
            catalog::commands::catalog_candidates,
            catalog::commands::catalog_import_context,
            catalog::commands::catalog_model_albums,
            catalog::commands::catalog_backup,
            catalog::maintenance::prepare_catalog_restore,
            catalog::maintenance::confirm_catalog_restore,
            catalog::maintenance::cancel_catalog_maintenance,
            catalog::maintenance::prepare_folder_refresh,
            catalog::maintenance::confirm_folder_refresh,
            catalog::maintenance::catalog_sync_folders,
            catalog::maintenance::prepare_media_relink,
            catalog::maintenance::confirm_media_relink,
            media_metadata::read_media_metadata,
            catalog::commands::catalog_reset
        ])
        .build(tauri::generate_context!())
        .expect("aure 启动失败")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                let first_exit = native_tasks::shutdown();
                video::shutdown(app);
                thumbnails::shutdown(app);
                media_metadata::shutdown(app);
                if !video::idle(app) || !native_tasks::idle() {
                    api.prevent_exit();
                    if first_exit {
                        let app=app.clone();
                        std::thread::spawn(move || {
                            while !video::idle(&app) || !native_tasks::idle() {std::thread::sleep(std::time::Duration::from_millis(50));}
                            app.exit(0);
                        });
                    }
                }
            }
        });
}
