use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::fs;
use tokio::process::Command;

#[derive(Serialize, Clone)]
pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
    pub duration_ms: u64,
}

fn resolve_path(path: &str, work_dir: &str) -> PathBuf {
    if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        PathBuf::from(work_dir).join(path)
    }
}

const MAX_READ_BYTES: usize = 200_000;

#[tauri::command]
pub async fn tool_read_file(
    path: String,
    work_dir: String,
    offset: Option<u64>,
    limit: Option<u64>,
) -> ToolResult {
    let start = Instant::now();
    let resolved = resolve_path(&path, &work_dir);

    let content = match fs::read_to_string(&resolved).await {
        Ok(c) => c,
        Err(e) => {
            return ToolResult {
                content: format!("Error reading file: {e}"),
                is_error: true,
                duration_ms: start.elapsed().as_millis() as u64,
            };
        }
    };

    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();
    let start_line = (offset.unwrap_or(1).max(1) as usize) - 1;
    let start_idx = start_line.min(total_lines);
    let end_idx = match limit {
        Some(l) => (start_idx + l as usize).min(total_lines),
        None => total_lines,
    };

    let selected: String = lines[start_idx..end_idx]
        .iter()
        .enumerate()
        .map(|(i, line)| format!("{:>4}\t{}", start_idx + i + 1, line))
        .collect::<Vec<_>>()
        .join("\n");

    let output = if selected.len() > MAX_READ_BYTES {
        format!("{}\n\n... [truncated, file has {} lines total]", &selected[..MAX_READ_BYTES], total_lines)
    } else {
        format!("{selected}\n\n({total_lines} lines total)")
    };

    ToolResult { content: output, is_error: false, duration_ms: start.elapsed().as_millis() as u64 }
}

const MAX_RESULTS: usize = 50;
const SEARCH_TIMEOUT_SECS: u64 = 15;

#[tauri::command]
pub async fn tool_grep(
    pattern: String,
    path: Option<String>,
    work_dir: String,
    glob: Option<String>,
    ignore_case: Option<bool>,
) -> ToolResult {
    let start = Instant::now();
    if pattern.is_empty() {
        return ToolResult { content: "Error: pattern is required".into(), is_error: true, duration_ms: 0 };
    }

    let search_path = match path {
        Some(p) => resolve_path(&p, &work_dir).to_string_lossy().to_string(),
        None => work_dir.clone(),
    };

    let mut cmd = Command::new("rg");
    cmd.arg("--line-number").arg("--no-heading").arg("--color=never")
        .arg(format!("--max-count={MAX_RESULTS}"));

    if ignore_case.unwrap_or(false) { cmd.arg("--ignore-case"); }
    if let Some(g) = glob { cmd.arg("--glob").arg(g); }
    cmd.arg(&pattern).arg(&search_path);

    let result = tokio::time::timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS), cmd.output()).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            if output.status.code() == Some(1) && stdout.is_empty() {
                return ToolResult { content: "No matches found.".into(), is_error: false, duration_ms };
            }
            if !output.status.success() && output.status.code() != Some(1) {
                return ToolResult { content: format!("Search error: {stderr}"), is_error: true, duration_ms };
            }
            let lines: Vec<&str> = stdout.lines().collect();
            let total = lines.len();
            let display: String = lines.into_iter().take(MAX_RESULTS).collect::<Vec<_>>().join("\n");
            let summary = if total > MAX_RESULTS {
                format!("{display}\n\n... ({total} matches, showing first {MAX_RESULTS})")
            } else {
                format!("{display}\n\n({total} matches)")
            };
            ToolResult { content: summary, is_error: false, duration_ms }
        }
        Ok(Err(e)) => ToolResult { content: format!("Error running rg: {e}"), is_error: true, duration_ms },
        Err(_) => ToolResult { content: format!("Search timed out after {SEARCH_TIMEOUT_SECS}s"), is_error: true, duration_ms },
    }
}

// PLACEHOLDER_REMAINING_TOOLS

#[tauri::command]
pub async fn tool_glob(
    pattern: String,
    path: Option<String>,
    work_dir: String,
) -> ToolResult {
    let start = Instant::now();
    let base_dir = match path {
        Some(p) => resolve_path(&p, &work_dir).to_string_lossy().to_string(),
        None => work_dir.clone(),
    };

    // Try fd first, fallback to find
    let mut cmd = Command::new("fd");
    cmd.arg("--glob").arg(&pattern).arg(&base_dir).arg("--type=f").arg("--color=never");

    let result = tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output()).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(output)) if output.status.success() || output.status.code() == Some(1) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).take(100).collect();
            if lines.is_empty() {
                ToolResult { content: "No files matched.".into(), is_error: false, duration_ms }
            } else {
                ToolResult { content: lines.join("\n"), is_error: false, duration_ms }
            }
        }
        _ => {
            // Fallback to find
            let mut cmd2 = Command::new("find");
            cmd2.arg(&base_dir).arg("-name").arg(&pattern).arg("-type").arg("f");
            match cmd2.output().await {
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let lines: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).take(100).collect();
                    if lines.is_empty() {
                        ToolResult { content: "No files matched.".into(), is_error: false, duration_ms }
                    } else {
                        ToolResult { content: lines.join("\n"), is_error: false, duration_ms }
                    }
                }
                Err(e) => ToolResult { content: format!("Glob error: {e}"), is_error: true, duration_ms },
            }
        }
    }
}

#[tauri::command]
pub async fn tool_write_file(
    path: String,
    content: String,
    work_dir: String,
) -> ToolResult {
    let start = Instant::now();
    let resolved = resolve_path(&path, &work_dir);

    if let Some(parent) = resolved.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
            return ToolResult { content: format!("Error creating dirs: {e}"), is_error: true, duration_ms: start.elapsed().as_millis() as u64 };
        }
    }

    match fs::write(&resolved, &content).await {
        Ok(_) => ToolResult {
            content: format!("Written {} bytes to {}", content.len(), resolved.display()),
            is_error: false,
            duration_ms: start.elapsed().as_millis() as u64,
        },
        Err(e) => ToolResult { content: format!("Error writing file: {e}"), is_error: true, duration_ms: start.elapsed().as_millis() as u64 },
    }
}

#[tauri::command]
pub async fn tool_edit(
    path: String,
    old_string: String,
    new_string: String,
    work_dir: String,
) -> ToolResult {
    let start = Instant::now();
    let resolved = resolve_path(&path, &work_dir);

    let content = match fs::read_to_string(&resolved).await {
        Ok(c) => c,
        Err(e) => return ToolResult { content: format!("Error reading file: {e}"), is_error: true, duration_ms: start.elapsed().as_millis() as u64 },
    };

    let count = content.matches(&old_string).count();
    if count == 0 {
        return ToolResult { content: "Error: old_string not found in file".into(), is_error: true, duration_ms: start.elapsed().as_millis() as u64 };
    }
    if count > 1 {
        return ToolResult { content: format!("Error: old_string found {count} times, must be unique"), is_error: true, duration_ms: start.elapsed().as_millis() as u64 };
    }

    let new_content = content.replacen(&old_string, &new_string, 1);
    match fs::write(&resolved, &new_content).await {
        Ok(_) => ToolResult { content: format!("Edited {}", resolved.display()), is_error: false, duration_ms: start.elapsed().as_millis() as u64 },
        Err(e) => ToolResult { content: format!("Error writing file: {e}"), is_error: true, duration_ms: start.elapsed().as_millis() as u64 },
    }
}

const BASH_TIMEOUT_MS: u64 = 30_000;

#[tauri::command]
pub async fn tool_bash(
    command: String,
    work_dir: String,
    timeout_ms: Option<u64>,
) -> ToolResult {
    let start = Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(BASH_TIMEOUT_MS));

    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(&command).current_dir(&work_dir);

    let result = tokio::time::timeout(timeout, cmd.output()).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = if stderr.is_empty() {
                stdout.to_string()
            } else {
                format!("{stdout}\n[stderr]\n{stderr}")
            };
            let truncated = if combined.len() > MAX_READ_BYTES {
                format!("{}\n\n... [truncated]", &combined[..MAX_READ_BYTES])
            } else {
                combined
            };
            ToolResult { content: truncated, is_error: !output.status.success(), duration_ms }
        }
        Ok(Err(e)) => ToolResult { content: format!("Error executing command: {e}"), is_error: true, duration_ms },
        Err(_) => ToolResult { content: format!("Command timed out after {}ms", timeout.as_millis()), is_error: true, duration_ms },
    }
}