use rusqlite::{params, Connection, OptionalExtension};

use crate::workspace::{CanvasNode, Viewport};

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(path: &std::path::Path) -> anyhow::Result<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    fn migrate(&self) -> anyhow::Result<()> {
        self.connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                node_type TEXT NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                z_index INTEGER NOT NULL DEFAULT 0,
                color TEXT,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                file_path TEXT,
                media_path TEXT,
                media_name TEXT,
                parent_id TEXT,
                stack_id TEXT,
                stack_order INTEGER,
                stack_anchor_x REAL,
                stack_anchor_y REAL,
                stack_title TEXT,
                url TEXT,
                plugin_kind TEXT,
                folder_icon TEXT,
                hotspots_json TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_z_index ON nodes(z_index);
            CREATE INDEX IF NOT EXISTS idx_nodes_updated_at ON nodes(updated_at);
            CREATE INDEX IF NOT EXISTS idx_nodes_parent_id ON nodes(parent_id);
            CREATE INDEX IF NOT EXISTS idx_nodes_stack_id ON nodes(stack_id);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;

        // 兼容旧版本数据库；SQLite 的 CREATE TABLE IF NOT EXISTS 不会补齐新列。
        self.ensure_column("parent_id", "TEXT")?;
        self.ensure_column("stack_id", "TEXT")?;
        self.ensure_column("stack_order", "INTEGER")?;
        self.ensure_column("stack_anchor_x", "REAL")?;
        self.ensure_column("stack_anchor_y", "REAL")?;
        self.ensure_column("stack_title", "TEXT")?;
        self.ensure_column("url", "TEXT")?;
        self.ensure_column("plugin_kind", "TEXT")?;
        self.ensure_column("folder_icon", "TEXT")?;
        self.ensure_column("hotspots_json", "TEXT NOT NULL DEFAULT '[]'")?;
        Ok(())
    }

    fn ensure_column(&self, name: &str, definition: &str) -> anyhow::Result<()> {
        let mut statement = self.connection.prepare("PRAGMA table_info(nodes)")?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        if !columns.iter().any(|column| column == name) {
            self.connection.execute_batch(&format!(
                "ALTER TABLE nodes ADD COLUMN {name} {definition};"
            ))?;
        }
        Ok(())
    }

    pub fn load_nodes(&self) -> anyhow::Result<Vec<CanvasNode>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, node_type, x, y, width, height, z_index, color, title, content,
                   file_path, media_path, media_name, parent_id, stack_id, stack_order, stack_anchor_x,
                   stack_anchor_y, stack_title, url, plugin_kind, folder_icon, hotspots_json, created_at, updated_at
            FROM nodes
            ORDER BY z_index ASC, created_at ASC
            "#,
        )?;

        let rows = statement.query_map([], |row| {
            Ok(CanvasNode {
                id: row.get(0)?,
                node_type: row.get(1)?,
                x: row.get(2)?,
                y: row.get(3)?,
                width: row.get(4)?,
                height: row.get(5)?,
                z_index: row.get(6)?,
                color: row.get(7)?,
                title: row.get(8)?,
                content: row.get(9)?,
                file_path: row.get(10)?,
                media_path: row.get(11)?,
                media_name: row.get(12)?,
                parent_id: row.get(13)?,
                stack_id: row.get(14)?,
                stack_order: row.get(15)?,
                stack_anchor_x: row.get(16)?,
                stack_anchor_y: row.get(17)?,
                stack_title: row.get(18)?,
                url: row.get(19)?,
                plugin_kind: row.get(20)?,
                folder_icon: row.get(21)?,
                hotspots: serde_json::from_str(&row.get::<_, String>(22)?).unwrap_or_default(),
                created_at: row.get(23)?,
                updated_at: row.get(24)?,
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn upsert_node(&self, node: &CanvasNode) -> anyhow::Result<()> {
        // 可编辑文字保存为独立 Markdown 文件；数据库仅保存布局和文件引用。
        // PDF 等二进制文档的 content 保存 MIME，便于前端选择渲染器。
        let is_text_document = node.node_type == "document"
            && node
                .file_path
                .as_deref()
                .is_some_and(|path| path.replace('\\', "/").starts_with("notes/"));
        let persisted_content =
            if matches!(node.node_type.as_str(), "note" | "sheet" | "sticky") || is_text_document {
                ""
            } else {
                node.content.as_str()
            };

        self.connection.execute(
            r#"
            INSERT INTO nodes (
                id, node_type, x, y, width, height, z_index, color, title, content,
                file_path, media_path, media_name, parent_id, stack_id, stack_order, stack_anchor_x,
                stack_anchor_y, stack_title, url, plugin_kind, folder_icon, hotspots_json, created_at, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                ?21, ?22, ?23, ?24, ?25
            )
            ON CONFLICT(id) DO UPDATE SET
                node_type = excluded.node_type,
                x = excluded.x,
                y = excluded.y,
                width = excluded.width,
                height = excluded.height,
                z_index = excluded.z_index,
                color = excluded.color,
                title = excluded.title,
                content = excluded.content,
                file_path = excluded.file_path,
                media_path = excluded.media_path,
                media_name = excluded.media_name,
                parent_id = excluded.parent_id,
                stack_id = excluded.stack_id,
                stack_order = excluded.stack_order,
                stack_anchor_x = excluded.stack_anchor_x,
                stack_anchor_y = excluded.stack_anchor_y,
                stack_title = excluded.stack_title,
                url = excluded.url,
                plugin_kind = excluded.plugin_kind,
                folder_icon = excluded.folder_icon,
                hotspots_json = excluded.hotspots_json,
                updated_at = excluded.updated_at
            "#,
            params![
                node.id,
                node.node_type,
                node.x,
                node.y,
                node.width,
                node.height,
                node.z_index,
                node.color,
                node.title,
                persisted_content,
                node.file_path,
                node.media_path,
                node.media_name,
                node.parent_id,
                node.stack_id,
                node.stack_order,
                node.stack_anchor_x,
                node.stack_anchor_y,
                node.stack_title,
                node.url,
                node.plugin_kind,
                node.folder_icon,
                serde_json::to_string(&node.hotspots)?,
                node.created_at,
                node.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_node(&self, id: &str) -> anyhow::Result<()> {
        self.connection
            .execute("DELETE FROM nodes WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn save_viewport(&self, viewport: &Viewport) -> anyhow::Result<()> {
        let value = serde_json::to_string(viewport)?;
        self.connection.execute(
            r#"
            INSERT INTO settings (key, value) VALUES ('viewport', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            "#,
            params![value],
        )?;
        Ok(())
    }

    pub fn load_viewport(&self) -> anyhow::Result<Viewport> {
        let value = self
            .connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'viewport'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        match value {
            Some(value) => Ok(serde_json::from_str(&value).unwrap_or_default()),
            None => Ok(Viewport::default()),
        }
    }
}
