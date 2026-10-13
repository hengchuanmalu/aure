//! Bounded catalog reads and transactional entity writes. Originals never live in SQLite.
mod authorization;
pub(crate) mod commands;
mod database;
mod entities;
mod protocol;
mod queries;
mod search;
pub(crate) mod maintenance;
#[cfg(test)]
mod tests;
mod transactions;

use rusqlite::Connection;
use serde_json::Value;
use std::{collections::HashSet, sync::Mutex};

pub use authorization::{
    authorized, authorized_video_path, media_path, prepare_profile_image, select,
};
pub use database::{initialize, needs_legacy_scope};
pub use protocol::resource;

pub struct CatalogState {
    pub connection: Mutex<Connection>,
    // Only the most recent uncommitted directory selection is retained here.
    pub selected: Mutex<HashSet<String>>,
}
type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn path_key(path: &str) -> String {
    let key = path.replace('\\', "/").to_lowercase();
    if let Some(unc) = key.strip_prefix("//?/unc/") {
        format!("//{unc}")
    } else {
        key.strip_prefix("//?/").unwrap_or(&key).to_owned()
    }
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn ids(v: &Value, key: &str) -> Vec<String> {
    v[key]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}
