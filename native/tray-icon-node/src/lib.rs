use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::VecDeque;
use std::process::{Command, Stdio};
use std::sync::Mutex;

static NOTIFICATION_ACTIONS: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());

pub mod common;
pub mod icon;
pub mod menu;
pub mod tray;

pub use common::*;
pub use icon::*;
pub use menu::*;
pub use tray::*;

/// Initializes the native tray subsystem.
///
/// On Linux, this initializes GTK. On macOS and Windows, this is a no-op
/// as those platforms handle initialization automatically.
///
/// # Errors
///
/// Returns an error if GTK initialization fails (Linux only).
#[napi]
pub fn initialize() -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        if gtk::init().is_err() {
            return Err(Error::from_reason("Failed to initialize GTK"));
        }
    }
    Ok(())
}

/// Processes pending UI events for the tray subsystem.
///
/// On Linux, this iterates pending GTK events.
/// On Windows, this processes the thread's message queue via `PeekMessageW`.
/// On macOS, this is a no-op as `NSApplication` handles its own event loop.
///
/// Call this in your event loop to ensure tray interactions are processed.
#[napi]
pub fn update() {
    #[cfg(target_os = "linux")]
    {
        while gtk::events_pending() {
            gtk::main_iteration_do(false);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
        };
        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            while PeekMessageW(&mut msg, 0, 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // No-op: macOS uses NSApplication's built-in run loop.
    }
}

/// One action button attached to a desktop notification.
///
/// `id` is the value returned by [`poll_notification_actions`] when the user
/// activates the button; `label` is the text rendered by the notification
/// service.
#[napi(object)]
#[derive(Debug, Clone)]
pub struct NotificationAction {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone)]
struct NotificationRequest {
    title: String,
    body: String,
    actions: Vec<NotificationAction>,
    expire_ms: Option<u32>,
}

impl NotificationRequest {
    fn new(title: String, body: String, actions: Vec<NotificationAction>) -> Self {
        Self {
            title,
            body,
            actions,
            expire_ms: None,
        }
    }

    fn with_timeout(mut self, timeout_ms: Option<u32>) -> Self {
        self.expire_ms = timeout_ms;
        self
    }
}

/// Ensures a body click (`default` action) maps to the first caller action.
///
/// The freedesktop notification protocol reserves `default` for activating the
/// notification body. Adding it lets the user click the popup itself while the
/// bridge still reports a stable caller-defined action id.
fn with_default_action(mut request: NotificationRequest) -> NotificationRequest {
    if let Some(first) = request.actions.first() {
        if !request.actions.iter().any(|action| action.id == "default") {
            let label = first.label.clone();
            request.actions.push(NotificationAction {
                id: "default".to_owned(),
                label,
            });
        }
    }
    request
}

/// Builds the `notify-send` argument vector for a notification.
///
/// Kept pure so the argument contract (timer and action buttons) can be
/// verified by the Rust test target without a desktop notification service.
#[cfg(any(target_os = "linux", test))]
fn notification_command_args(
    request: &NotificationRequest,
    wait_for_action: bool,
) -> Vec<String> {
    let mut args = vec!["--app-name=decaf-ts for-os".to_owned()];
    if let Some(expire_ms) = request.expire_ms {
        args.push(format!("--expire-time={expire_ms}"));
    }
    if wait_for_action {
        args.push("--wait".to_owned());
    }
    for action in &request.actions {
        args.push(format!("--action={}={}", action.id, action.label));
    }
    args.push("--".to_owned());
    args.push(request.title.clone());
    args.push(request.body.clone());
    args
}

/// Normalizes the notification-service action id and stores it for polling.
///
/// `default` is the reserved id the service reports when the notification
/// body itself (rather than a named button) is activated.
#[cfg(target_os = "linux")]
fn push_notification_action(raw_action: &str, default_alias: Option<&str>) {
    let trimmed = raw_action.trim();
    if trimmed.is_empty() {
        return;
    }
    let normalized = if trimmed == "default" {
        default_alias.unwrap_or("default")
    } else {
        trimmed
    };
    if let Ok(mut actions) = NOTIFICATION_ACTIONS.lock() {
        actions.push_back(normalized.to_owned());
    }
}

/// Sends a best-effort operating-system desktop notification.
///
/// `timeout_ms` controls how long the notification remains visible where the
/// host notification service supports an expiry (Linux `notify-send`, Windows
/// balloon tips). macOS uses the system default dismissal policy.
#[napi]
pub fn show_notification(title: String, body: String, timeout_ms: Option<u32>) -> Result<()> {
    let request = NotificationRequest::new(title, body, Vec::new()).with_timeout(timeout_ms);
    send_notification(request)
}

/// Sends a desktop notification with caller-defined action buttons.
///
/// Action buttons are delivered on Linux through `notify-send --wait`; the
/// activated button id is returned by [`poll_notification_actions`]. macOS and
/// Windows show a normal notification without buttons (the system notification
/// APIs used by this crate do not expose per-notification actions), so map
/// those platforms to a tray menu action instead.
#[napi]
pub fn show_notification_with_actions(
    title: String,
    body: String,
    actions: Vec<NotificationAction>,
    timeout_ms: Option<u32>,
) -> Result<()> {
    let default_alias = actions.first().map(|action| action.id.clone());
    let request = with_default_action(
        NotificationRequest::new(title, body, actions).with_timeout(timeout_ms),
    );
    send_notification_with_alias(request, default_alias)
}

/// Sends an appointment notification with Accept and See actions where the
/// desktop notification service supports actions (currently Linux notify-send).
/// Other platforms receive a normal notification and use the tray menu actions.
#[napi]
pub fn show_appointment_notification(
    title: String,
    body: String,
    timeout_ms: Option<u32>,
) -> Result<()> {
    let request = NotificationRequest::new(
        title,
        body,
        vec![
            NotificationAction {
                id: "default".to_owned(),
                label: "See appointment".to_owned(),
            },
            NotificationAction {
                id: "accept".to_owned(),
                label: "Accept appointment".to_owned(),
            },
            NotificationAction {
                id: "see".to_owned(),
                label: "See appointment".to_owned(),
            },
        ],
    )
    .with_timeout(timeout_ms);
    send_notification_with_alias(request, Some("see".to_owned()))
}

/// Returns the next notification action selected by the user.
#[napi]
pub fn poll_notification_actions() -> Option<String> {
    NOTIFICATION_ACTIONS
        .lock()
        .ok()
        .and_then(|mut actions| actions.pop_front())
}

#[cfg(target_os = "linux")]
fn send_notification(request: NotificationRequest) -> Result<()> {
    send_notification_with_alias(request, None)
}

#[cfg(target_os = "linux")]
fn send_notification_with_alias(
    request: NotificationRequest,
    default_alias: Option<String>,
) -> Result<()> {
    let wait_for_action = !request.actions.is_empty();
    let alias = default_alias;
    std::thread::Builder::new()
        .name("for-os-notification".to_owned())
        .spawn(move || {
            let args = notification_command_args(&request, wait_for_action);
            let output = Command::new("notify-send")
                .args(&args)
                .stdin(Stdio::null())
                .output();
            if let Ok(output) = output {
                let action = String::from_utf8_lossy(&output.stdout);
                push_notification_action(&action, alias.as_deref());
            }
        })
        .map_err(|error| {
            Error::from_reason(format!("Failed to start desktop notification: {error}"))
        })?;
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn send_notification(request: NotificationRequest) -> Result<()> {
    send_notification_with_alias(request, None)
}

#[cfg(not(target_os = "linux"))]
fn send_notification_with_alias(
    request: NotificationRequest,
    _default_alias: Option<String>,
) -> Result<()> {
    #[cfg(target_os = "macos")]
    let NotificationRequest { title, body, .. } = &request;

    #[cfg(target_os = "macos")]
    let mut command = {
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            escape_applescript(body),
            escape_applescript(title)
        );
        let mut command = Command::new("osascript");
        command.args(["-e", &script]);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let script = windows_notification_script(&request);
        let mut command = Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            Error::from_reason(format!("Failed to send desktop notification: {error}"))
        })
}

#[cfg(target_os = "macos")]
fn escape_applescript(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\r', " ")
        .replace('\n', " ")
}

/// Keeps the Windows notification host alive until the requested deadline or a
/// native close/click event. A zero timeout leaves dismissal to the OS/user.
/// Pure so Linux CI also covers the Windows lifecycle command.
#[cfg(any(target_os = "windows", test))]
fn windows_notification_script(request: &NotificationRequest) -> String {
    let timeout = request.expire_ms.unwrap_or(10_000);
    let deadline = if timeout == 0 {
        String::new()
    } else {
        format!(" -and $timer.ElapsedMilliseconds -lt {timeout}")
    };
    format!(
        "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; \
         $n = New-Object System.Windows.Forms.NotifyIcon; \
         $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; \
         $n.BalloonTipTitle = '{}'; $n.BalloonTipText = '{}'; \
         $n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info; \
         $script:notificationClosed = $false; \
         $n.add_BalloonTipClosed({{ $script:notificationClosed = $true }}); \
         $n.add_BalloonTipClicked({{ $script:notificationClosed = $true }}); \
         $timer = [System.Diagnostics.Stopwatch]::StartNew(); \
         try {{ $n.ShowBalloonTip({timeout}); \
         while (-not $script:notificationClosed{deadline}) {{ \
         [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 \
         }} }} finally {{ $n.Dispose() }}",
        escape_powershell_single_quote(&request.title),
        escape_powershell_single_quote(&request.body),
    )
}

#[cfg(any(target_os = "windows", test))]
fn escape_powershell_single_quote(value: &str) -> String {
    value
        .replace('\'', "''")
        .replace('\r', " ")
        .replace('\n', " ")
}

#[cfg(test)]
mod notification_tests {
    use super::{notification_command_args, NotificationAction, NotificationRequest};

    fn request(actions: Vec<NotificationAction>) -> NotificationRequest {
        NotificationRequest::new("title".to_owned(), "body".to_owned(), actions)
            .with_timeout(Some(4_000))
    }

    #[test]
    fn builds_timer_argument() {
        let args = notification_command_args(&request(Vec::new()), false);
        assert!(args.contains(&"--expire-time=4000".to_owned()));
        assert!(!args.contains(&"--wait".to_owned()));
        assert_eq!(args.last().map(String::as_str), Some("body"));
    }

    #[test]
    fn builds_action_arguments_and_waits() {
        let args = notification_command_args(
            &request(vec![
                NotificationAction {
                    id: "accept".to_owned(),
                    label: "Accept appointment".to_owned(),
                },
                NotificationAction {
                    id: "see".to_owned(),
                    label: "See appointment".to_owned(),
                },
            ]),
            true,
        );
        assert!(args.contains(&"--wait".to_owned()));
        assert!(args.contains(&"--action=accept=Accept appointment".to_owned()));
        assert!(args.contains(&"--action=see=See appointment".to_owned()));
    }

    #[test]
    fn adds_default_body_action_for_first_button() {
        let request = super::with_default_action(request(vec![NotificationAction {
            id: "accept".to_owned(),
            label: "Accept".to_owned(),
        }]));
        let args = notification_command_args(&request, true);
        assert!(args.contains(&"--action=accept=Accept".to_owned()));
        assert!(args.contains(&"--action=default=Accept".to_owned()));
    }

    #[test]
    fn preserves_zero_as_linux_never_expire_request() {
        let request = request(Vec::new()).with_timeout(Some(0));
        let args = notification_command_args(&request, false);
        assert!(args.contains(&"--expire-time=0".to_owned()));
    }

    #[test]
    fn windows_host_lifetime_matches_requested_timeout() {
        let script = super::windows_notification_script(&request(Vec::new()));
        assert!(script.contains("ShowBalloonTip(4000)"));
        assert!(script.contains("$timer.ElapsedMilliseconds -lt 4000"));
        assert!(!script.contains("Start-Sleep -Seconds 2"));
        assert!(script.contains("finally { $n.Dispose() }"));
        assert!(script.contains("add_BalloonTipClosed"));
        assert!(script.contains("add_BalloonTipClicked"));
    }

    #[test]
    fn windows_zero_waits_for_native_dismissal_without_deadline() {
        let script = super::windows_notification_script(&request(Vec::new()).with_timeout(Some(0)));
        assert!(script.contains("ShowBalloonTip(0)"));
        assert!(!script.contains("ElapsedMilliseconds -lt"));
        assert!(script.contains("while (-not $script:notificationClosed)"));
    }

    #[test]
    fn windows_default_timeout_and_text_escaping() {
        let request = NotificationRequest::new("a'b".to_owned(), "line\nbreak".to_owned(), Vec::new());
        let script = super::windows_notification_script(&request);
        assert!(script.contains("ShowBalloonTip(10000)"));
        assert!(script.contains("$timer.ElapsedMilliseconds -lt 10000"));
        assert!(script.contains("$n.BalloonTipTitle = 'a''b'"));
        assert!(script.contains("$n.BalloonTipText = 'line break'"));
    }

    #[test]
    fn omits_timer_when_not_configured() {
        let args = notification_command_args(
            &NotificationRequest::new("t".to_owned(), "b".to_owned(), Vec::new()),
            false,
        );
        assert!(!args.iter().any(|arg| arg.starts_with("--expire-time=")));
    }

    #[test]
    fn keeps_leading_dash_title_and_body_after_separator() {
        let request = NotificationRequest::new(
            "--expire-time=1".to_owned(),
            "--urgency=critical".to_owned(),
            Vec::new(),
        );
        let args = notification_command_args(&request, false);
        let separator = args
            .iter()
            .position(|argument| argument == "--")
            .expect("notification arguments must contain a -- separator");
        let title = args
            .iter()
            .position(|argument| argument == "--expire-time=1")
            .expect("title must be present in the argument vector");
        let body = args
            .iter()
            .position(|argument| argument == "--urgency=critical")
            .expect("body must be present in the argument vector");
        assert!(
            title > separator,
            "a leading-dash title must be delivered after the -- separator"
        );
        assert!(
            body > separator,
            "a leading-dash body must be delivered after the -- separator"
        );
        assert_eq!(title, separator + 1);
        assert_eq!(body, separator + 2);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn escapes_applescript_notification_text() {
        assert_eq!(super::escape_applescript("a\\b\"c\nd"), "a\\\\b\\\"c d");
    }

    #[test]
    fn escapes_powershell_notification_text() {
        assert_eq!(super::escape_powershell_single_quote("a'b\nc"), "a''b c");
    }
}
