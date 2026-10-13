//! Media requests release their files and child processes before normal exit.
use std::{
    process::Command,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    time::{Duration, Instant},
};

#[derive(Default)]
struct Coordinator {
    active: AtomicUsize,
    shutting_down: AtomicBool,
}

static COORDINATOR: Coordinator = Coordinator {
    active: AtomicUsize::new(0),
    shutting_down: AtomicBool::new(false),
};

pub(crate) struct TaskGuard<'a>(&'a Coordinator);

impl Drop for TaskGuard<'_> {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::AcqRel);
    }
}

impl Coordinator {
    fn start(&self) -> Result<TaskGuard<'_>, String> {
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("应用正在退出，媒体任务已取消".into());
        }
        self.active.fetch_add(1, Ordering::AcqRel);
        let task = TaskGuard(self);
        if self.shutting_down.load(Ordering::Acquire) {
            return Err("应用正在退出，媒体任务已取消".into());
        }
        Ok(task)
    }

    fn idle(&self) -> bool {
        self.active.load(Ordering::Acquire) == 0
    }

    fn shutdown(&self) -> bool {
        !self.shutting_down.swap(true, Ordering::AcqRel)
    }

    fn run_tool(
        &self,
        command: &mut Command,
        cancel: &AtomicBool,
        limit: Duration,
        spawn_error: &str,
    ) -> Result<(), String> {
        if cancel.load(Ordering::Acquire) || self.shutting_down.load(Ordering::Acquire) {
            return Err("媒体处理已取消".into());
        }
        let mut child = command.spawn().map_err(|_| spawn_error.to_owned())?;
        let started = Instant::now();
        loop {
            let cancelled = cancel.load(Ordering::Acquire)
                || self.shutting_down.load(Ordering::Acquire);
            if cancelled || started.elapsed() > limit {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if cancelled { "媒体处理已取消" } else { "媒体处理超时，请重试" }.into());
            }
            match child.try_wait() {
                Ok(Some(status)) => return if status.success() {
                    Ok(())
                } else {
                    Err("无法解码此媒体，文件可能损坏或编码不受 FFmpeg 支持".into())
                },
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error.to_string());
                }
            }
        }
    }
}

pub(crate) fn start() -> Result<TaskGuard<'static>, String> {
    COORDINATOR.start()
}

pub(crate) fn idle() -> bool {
    COORDINATOR.idle()
}

pub(crate) fn shutdown() -> bool {
    COORDINATOR.shutdown()
}

pub(crate) fn cancelled() -> bool {
    COORDINATOR.shutting_down.load(Ordering::Acquire)
}

pub(crate) fn check_cancelled() -> Result<(), String> {
    if cancelled() { Err("应用正在退出，媒体任务已取消".into()) } else { Ok(()) }
}

pub(crate) fn run_tool(
    command: &mut Command,
    cancel: &AtomicBool,
    limit: Duration,
    spawn_error: &str,
) -> Result<(), String> {
    COORDINATOR.run_tool(command, cancel, limit, spawn_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn shutdown_rejects_new_tasks_and_waits_for_existing_guards() {
        let state = Coordinator::default();
        let first = state.start().unwrap();
        let second = state.start().unwrap();
        assert!(!state.idle());
        assert!(state.shutdown());
        assert!(!state.shutdown());
        assert!(state.start().is_err());
        drop(first);
        assert!(!state.idle());
        drop(second);
        assert!(state.idle());
    }

    #[test]
    fn shutdown_stops_child_and_waits_until_temporary_files_are_cleaned() {
        let state = Arc::new(Coordinator::default());
        let worker_state = state.clone();
        let root = std::env::temp_dir().join(format!("aure-task-shutdown-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let temporary = root.join("media.decode.png");
        let worker_path = temporary.clone();
        let worker = std::thread::spawn(move || {
            let _task = worker_state.start().unwrap();
            std::fs::write(&worker_path, b"disposable pending media").unwrap();
            #[cfg(windows)]
            let mut command = {
                use std::os::windows::process::CommandExt;
                let mut command = Command::new("powershell.exe");
                command.creation_flags(0x08000000);
                command.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
                command
            };
            #[cfg(not(windows))]
            let mut command = {
                let mut command = Command::new("sleep");
                command.arg("30");
                command
            };
            let result = worker_state.run_tool(&mut command, &AtomicBool::new(false), Duration::from_secs(30), "test helper unavailable");
            std::fs::remove_file(worker_path).unwrap();
            result
        });
        let start = Instant::now();
        while !temporary.exists() && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(temporary.exists());
        // Ensure the helper has been launched before exercising cancellation.
        std::thread::sleep(Duration::from_millis(200));
        state.shutdown();
        assert!(worker.join().unwrap().unwrap_err().contains("取消"));
        assert!(start.elapsed() < Duration::from_secs(5));
        assert!(state.idle());
        assert!(!temporary.exists());
        std::fs::remove_dir(root).unwrap();
    }
}
