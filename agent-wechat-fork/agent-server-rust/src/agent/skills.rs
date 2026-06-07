use std::path::Path;

pub struct Skill {
    pub name: String,
    pub content: String,
}

pub async fn load_skills(skill_dirs: &[String]) -> Vec<Skill> {
    let mut skills = Vec::new();
    for dir in skill_dirs {
        let path = Path::new(dir);
        if !path.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    let skill_md = entry_path.join("SKILL.md");
                    if skill_md.exists() {
                        let name = entry_path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string();
                        if let Ok(content) = tokio::fs::read_to_string(&skill_md).await {
                            skills.push(Skill { name, content });
                        }
                    }
                }
            }
        }
    }
    skills
}

pub fn format_skills_prompt(skills: &[Skill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
    let header = format!(
        "## Available Skills\n\nYou have access to the following skills: {}.\n\n",
        names.join(", ")
    );
    let bodies: String = skills
        .iter()
        .map(|s| format!("### {}\n\n{}", s.name, s.content))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");
    format!("{header}{bodies}")
}
