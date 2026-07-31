use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageHotspot {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z_index: i64,
    pub color: Option<String>,
    pub title: String,
    pub content: String,
    pub file_path: Option<String>,
    pub media_path: Option<String>,
    pub media_name: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub stack_id: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub plugin_kind: Option<String>,
    #[serde(default)]
    pub hotspots: Vec<ImageHotspot>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale: 1.0,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub root_path: String,
    pub nodes: Vec<CanvasNode>,
    pub viewport: Viewport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub relative_path: String,
    pub file_name: String,
    pub mime_type: String,
    pub content: Option<String>,
}

pub struct WorkspaceService {
    root: PathBuf,
    notes_dir: PathBuf,
    media_dir: PathBuf,
    database: Database,
}

impl WorkspaceService {
    pub fn new_default() -> anyhow::Result<Self> {
        let base = dirs::document_dir()
            .or_else(|| std::env::current_dir().ok())
            .ok_or_else(|| anyhow::anyhow!("无法找到可写入的项目目录"))?;
        Self::open(base.join("InspireSpace 演练"))
    }

    pub fn open(root: PathBuf) -> anyhow::Result<Self> {
        let notes_dir = root.join("notes");
        let media_dir = root.join("media");
        let cache_dir = root.join("cache");
        let metadata_dir = root.join(".inspirespace");
        for directory in [&root, &notes_dir, &media_dir, &cache_dir, &metadata_dir] {
            fs::create_dir_all(directory)?;
        }
        let database = Database::open(&metadata_dir.join("metadata.sqlite3"))?;
        Ok(Self {
            root,
            notes_dir,
            media_dir,
            database,
        })
    }

    pub fn snapshot(&self) -> anyhow::Result<WorkspaceSnapshot> {
        let mut nodes = self.database.load_nodes()?;
        for node in &mut nodes {
            if should_load_text_file(node) {
                let path = self.text_path(node);
                if path.is_file() {
                    node.content = fs::read_to_string(path).unwrap_or_default();
                }
            }
        }
        Ok(WorkspaceSnapshot {
            root_path: self.root.to_string_lossy().to_string(),
            nodes,
            viewport: self.database.load_viewport()?,
        })
    }

    pub fn upsert_node(&self, node: &CanvasNode) -> anyhow::Result<()> {
        self.database.upsert_node(node)
    }

    pub fn delete_node(&self, id: &str) -> anyhow::Result<()> {
        self.database.delete_node(id)
    }

    pub fn save_viewport(&self, viewport: &Viewport) -> anyhow::Result<()> {
        self.database.save_viewport(viewport)
    }

    pub fn save_text(&self, id: &str, content: &str) -> anyhow::Result<String> {
        let file_name = format!("{id}.md");
        let path = self.notes_dir.join(&file_name);
        atomic_write(&path, content.as_bytes())?;
        Ok(format!("notes/{file_name}"))
    }

    pub fn import_media(&self, source_path: &str, kind: &str) -> anyhow::Result<MediaAsset> {
        let source = Path::new(source_path);
        if !source.is_file() {
            anyhow::bail!("所选文件不存在");
        }
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .ok_or_else(|| anyhow::anyhow!("所选文件没有扩展名"))?;
        validate_extension(kind, &extension)?;
        let mime_type = mime_for_extension(&extension).to_string();
        let target_name = format!("{}.{}", Uuid::new_v4(), extension);
        fs::copy(source, self.media_dir.join(&target_name))?;
        let file_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("导入的文件")
            .to_string();
        let content = if matches!(extension.as_str(), "md" | "txt" | "rtf") {
            fs::read_to_string(source).ok()
        } else {
            None
        };
        Ok(MediaAsset {
            relative_path: format!("media/{target_name}"),
            file_name,
            mime_type,
            content,
        })
    }

    fn text_path(&self, node: &CanvasNode) -> PathBuf {
        node.file_path
            .as_deref()
            .map(|relative| {
                self.root
                    .join(relative.replace('/', std::path::MAIN_SEPARATOR_STR))
            })
            .unwrap_or_else(|| self.notes_dir.join(format!("{}.md", node.id)))
    }
}

fn should_load_text_file(node: &CanvasNode) -> bool {
    matches!(node.node_type.as_str(), "note" | "sheet" | "sticky")
        || (node.node_type == "document" && node.file_path.is_some())
}

fn validate_extension(kind: &str, extension: &str) -> anyhow::Result<()> {
    let supported = match kind {
        "image" => matches!(
            extension,
            "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "tiff"
                | "tif"
                | "bmp"
                | "ico"
                | "icns"
                | "heic"
                | "raw"
                | "exr"
                | "hdr"
        ),
        "video" => matches!(extension, "mp4" | "mov" | "gif" | "webp" | "webm" | "avi"),
        "document" => matches!(extension, "md" | "txt" | "rtf" | "pdf"),
        _ => false,
    };
    if supported {
        Ok(())
    } else {
        anyhow::bail!("不支持的{}格式：{}", kind, extension)
    }
}

fn mime_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "tiff" | "tif" => "image/tiff",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "icns" => "image/icns",
        "heic" => "image/heic",
        "raw" => "image/x-raw",
        "exr" => "image/x-exr",
        "hdr" => "image/vnd.radiance",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "md" => "text/markdown",
        "txt" => "text/plain",
        "rtf" => "application/rtf",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn atomic_write(path: &Path, content: &[u8]) -> anyhow::Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", Utc::now().timestamp_millis()));
    fs::write(&temporary, content)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary, path)?;
    Ok(())
}
