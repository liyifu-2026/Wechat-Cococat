use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::agent_config::{cococat_config_dir, ensure_parent};

const CUSTOMER_TYPES_FILE: &str = "customer-types.json";

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomerTypeEntry {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub wiki_projects: Vec<String>,
    #[serde(default)]
    pub behavior_guide: String,
    #[serde(default)]
    pub sort_order: i32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct CustomerTypesFile {
    #[serde(default)]
    pub types: Vec<CustomerTypeEntry>,
}

fn customer_types_path() -> PathBuf {
    cococat_config_dir().join(CUSTOMER_TYPES_FILE)
}

fn default_seed() -> CustomerTypesFile {
    CustomerTypesFile {
        types: vec![
            CustomerTypeEntry {
                id: "prospect".into(),
                label: "潜在客户".into(),
                description: "尚未成交或初步接触".into(),
                wiki_projects: vec![],
                behavior_guide: String::new(),
                sort_order: 0,
            },
            CustomerTypeEntry {
                id: "vip".into(),
                label: "VIP 客户".into(),
                description: "高价值客户，需优先响应".into(),
                wiki_projects: vec![],
                behavior_guide: "当前为 VIP 客户：语气更热情；3 轮内未解决须考虑 escalation。".into(),
                sort_order: 1,
            },
            CustomerTypeEntry {
                id: "support".into(),
                label: "售后问题".into(),
                description: "售后与技术支持".into(),
                wiki_projects: vec![],
                behavior_guide: String::new(),
                sort_order: 2,
            },
        ],
    }
}

fn read_or_seed() -> Result<CustomerTypesFile, String> {
    let path = customer_types_path();
    if !path.is_file() {
        let seed = default_seed();
        write_inner(&seed)?;
        return Ok(seed);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        let seed = default_seed();
        write_inner(&seed)?;
        return Ok(seed);
    }
    serde_json::from_str(&raw).map_err(|e| format!("customer-types.json: {e}"))
}

fn write_inner(file: &CustomerTypesFile) -> Result<(), String> {
    let path = customer_types_path();
    ensure_parent(&path)?;
    let mut sorted = file.types.clone();
    sorted.sort_by_key(|t| t.sort_order);
    let payload = CustomerTypesFile { types: sorted };
    fs::write(
        &path,
        serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into()) + "\n",
    )
    .map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub fn read_customer_types_config() -> Result<CustomerTypesFile, String> {
    read_or_seed()
}

#[tauri::command]
pub fn write_customer_types_config(file: CustomerTypesFile) -> Result<(), String> {
    let cleaned: Vec<CustomerTypeEntry> = file
        .types
        .into_iter()
        .filter_map(|mut t| {
            t.id = t.id.trim().to_string();
            t.label = t.label.trim().to_string();
            if t.id.is_empty() || t.label.is_empty() {
                return None;
            }
            t.wiki_projects = t
                .wiki_projects
                .into_iter()
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty())
                .collect();
            Some(t)
        })
        .collect();
    if cleaned.is_empty() {
        return Err("至少保留一个客户类型".into());
    }
    write_inner(&CustomerTypesFile { types: cleaned })
}
