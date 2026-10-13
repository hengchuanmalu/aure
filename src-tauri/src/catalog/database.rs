use super::{err, CatalogState, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

pub(super) fn values(
    conn: &Connection,
    sql: &str,
    args: &[&dyn rusqlite::ToSql],
) -> Result<Vec<Value>> {
    let mut stmt = conn.prepare_cached(sql).map_err(err)?;
    let rows = stmt
        .query_map(args, |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}
pub(super) fn count(conn: &Connection, kind: &str) -> Result<i64> {
    conn.query_row("SELECT count(*) FROM entities WHERE kind=?", [kind], |r| {
        r.get(0)
    })
    .map_err(err)
}
pub(super) fn meta(conn: &Connection, key: &str, default: Value) -> Result<Value> {
    Ok(conn
        .query_row("SELECT value FROM meta WHERE key=?", [key], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .map_err(err)?
        .map(|s| serde_json::from_str(&s).map_err(err))
        .transpose()?
        .unwrap_or(default))
}
pub(super) fn set_meta(conn: &Connection, key: &str, value: &Value) -> Result<()> {
    conn.execute(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value.to_string()],
    )
    .map_err(err)?;
    Ok(())
}
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).map_err(err)?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    if version > 1 {
        return Err("目录库版本较新，请使用兼容版本打开；数据未修改".into());
    }
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(err)?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-65536; PRAGMA temp_store=FILE;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',favorite INTEGER NOT NULL DEFAULT 0,
        media_kind TEXT NOT NULL DEFAULT '',bytes INTEGER NOT NULL DEFAULT 0,updated TEXT NOT NULL DEFAULT '',PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS entity_order ON entities(kind,updated DESC,id);
      CREATE INDEX IF NOT EXISTS entity_name ON entities(kind,name,id);
      CREATE INDEX IF NOT EXISTS entity_favorite ON entities(kind,favorite,id);
      CREATE INDEX IF NOT EXISTS entity_media_kind ON entities(kind,media_kind,id);
      CREATE UNIQUE INDEX IF NOT EXISTS media_source ON entities(source) WHERE kind='media' AND source<>'';
      CREATE UNIQUE INDEX IF NOT EXISTS album_source ON entities(source) WHERE kind='albums' AND source<>'';
      CREATE INDEX IF NOT EXISTS media_url ON entities(json_extract(data,'$.src')) WHERE kind='media';
      CREATE TABLE IF NOT EXISTS refs(owner_kind TEXT NOT NULL,owner TEXT NOT NULL,target_kind TEXT NOT NULL,target TEXT NOT NULL,
        role TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(owner_kind,owner,role,target),
        FOREIGN KEY(owner_kind,owner) REFERENCES entities(kind,id) ON DELETE CASCADE,
        FOREIGN KEY(target_kind,target) REFERENCES entities(kind,id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS refs_target ON refs(target_kind,target,role,owner);
      CREATE INDEX IF NOT EXISTS refs_order ON refs(owner_kind,owner,role,position);
      CREATE TABLE IF NOT EXISTS summaries(album TEXT PRIMARY KEY,data TEXT NOT NULL,search TEXT NOT NULL,images INTEGER NOT NULL,videos INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS recent(album TEXT PRIMARY KEY,media TEXT,at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS authorized(path TEXT PRIMARY KEY);
      PRAGMA user_version=1;").map_err(err)?;
    Ok(conn)
}
pub fn initialize(app: &tauri::AppHandle) -> Result<()> {
    let dir = app.path().app_data_dir().map_err(err)?;
    std::fs::create_dir_all(&dir).map_err(err)?;
    app.manage(CatalogState {
        connection: Mutex::new(open(&dir.join("catalog.sqlite3"))?),
        selected: Mutex::new(HashSet::new()),
    });
    Ok(())
}
pub fn needs_legacy_scope(app: &tauri::AppHandle) -> Result<bool> {
    let state = app.state::<CatalogState>();
    let c = state.connection.lock().map_err(err)?;
    Ok(meta(&c, "initialized", json!(false))? != true)
}
