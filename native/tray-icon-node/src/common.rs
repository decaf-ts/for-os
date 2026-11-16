use napi_derive::napi;

#[napi(object)]
#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl From<tray_icon::Rect> for Rect {
    fn from(rect: tray_icon::Rect) -> Self {
        Self {
            x: rect.position.x,
            y: rect.position.y,
            width: f64::from(rect.size.width),
            height: f64::from(rect.size.height),
        }
    }
}

#[napi]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

impl From<tray_icon::MouseButton> for MouseButton {
    fn from(button: tray_icon::MouseButton) -> Self {
        match button {
            tray_icon::MouseButton::Left => Self::Left,
            tray_icon::MouseButton::Right => Self::Right,
            tray_icon::MouseButton::Middle => Self::Middle,
        }
    }
}

#[napi]
pub enum MouseButtonState {
    Up,
    Down,
}

impl From<tray_icon::MouseButtonState> for MouseButtonState {
    fn from(state: tray_icon::MouseButtonState) -> Self {
        match state {
            tray_icon::MouseButtonState::Up => Self::Up,
            tray_icon::MouseButtonState::Down => Self::Down,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{MouseButton, MouseButtonState, Rect};

    #[test]
    fn converts_every_mouse_button() {
        assert!(matches!(
            MouseButton::from(tray_icon::MouseButton::Left),
            MouseButton::Left
        ));
        assert!(matches!(
            MouseButton::from(tray_icon::MouseButton::Right),
            MouseButton::Right
        ));
        assert!(matches!(
            MouseButton::from(tray_icon::MouseButton::Middle),
            MouseButton::Middle
        ));
    }

    #[test]
    fn converts_mouse_button_states() {
        assert!(matches!(
            MouseButtonState::from(tray_icon::MouseButtonState::Up),
            MouseButtonState::Up
        ));
        assert!(matches!(
            MouseButtonState::from(tray_icon::MouseButtonState::Down),
            MouseButtonState::Down
        ));
    }

    #[test]
    fn converts_physical_rect_fields() {
        let mut source = tray_icon::Rect::default();
        source.position.x = 12.5;
        source.position.y = -4.0;
        source.size.width = 120;
        source.size.height = 48;
        let rect = Rect::from(source);

        assert_eq!(rect.x, 12.5);
        assert_eq!(rect.y, -4.0);
        assert_eq!(rect.width, 120.0);
        assert_eq!(rect.height, 48.0);
    }
}
