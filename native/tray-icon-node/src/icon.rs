use std::io::Cursor;

use napi::bindgen_prelude::*;
use napi_derive::napi;

const MAX_ICON_DIMENSION: u32 = 4096;

fn validate_dimensions(label: &str, width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(Error::from_reason(format!(
            "{label} has invalid dimensions {width}x{height}"
        )));
    }
    if width > MAX_ICON_DIMENSION || height > MAX_ICON_DIMENSION {
        return Err(Error::from_reason(format!(
            "{label} is {width}x{height}px; tray icons are limited to {MAX_ICON_DIMENSION}px per side"
        )));
    }
    Ok(())
}

fn icon_limits() -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_ICON_DIMENSION);
    limits.max_image_height = Some(MAX_ICON_DIMENSION);
    limits
}

fn decode_icon_rgba(path: &str) -> Result<image::RgbaImage> {
    let bytes = std::fs::read(path)
        .map_err(|e| Error::from_reason(format!("Failed to read image {path}: {e}")))?;
    let probe = image::ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| Error::from_reason(format!("Failed to inspect image {path}: {e}")))?;
    let format = probe.format().ok_or_else(|| {
        Error::from_reason(format!(
            "Unsupported or unrecognized image format for {path}"
        ))
    })?;
    let (width, height) = probe
        .into_dimensions()
        .map_err(|e| Error::from_reason(format!("Failed to read dimensions of {path}: {e}")))?;
    validate_dimensions(&format!("Image {path}"), width, height)?;

    let mut decoder = image::ImageReader::with_format(Cursor::new(&bytes), format);
    decoder.limits(icon_limits());
    decoder
        .decode()
        .map(|image| image.to_rgba8())
        .map_err(|e| Error::from_reason(format!("Failed to decode image {path}: {e}")))
}

#[napi]
#[derive(Clone)]
pub struct Icon {
    pub(crate) inner: tray_icon::Icon,
    pub(crate) rgba: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[napi]
impl Icon {
    /// Creates an icon from an image file at the given path.
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be opened or decoded as an image.
    #[napi(factory)]
    pub fn from_path(path: String) -> Result<Self> {
        let img = decode_icon_rgba(&path)?;
        let (width, height) = img.dimensions();
        let rgba = img.into_raw();
        let icon = tray_icon::Icon::from_rgba(rgba.clone(), width, height)
            .map_err(|e| Error::from_reason(format!("Failed to create icon: {e}")))?;
        Ok(Self {
            inner: icon,
            rgba,
            width,
            height,
        })
    }

    /// Creates an icon from raw RGBA pixel data.
    ///
    /// # Errors
    ///
    /// Returns an error if the RGBA data length does not match `width * height * 4`
    /// or the OS fails to create the icon.
    #[napi(factory)]
    pub fn from_rgba(rgba: Buffer, width: u32, height: u32) -> Result<Self> {
        validate_dimensions("RGBA icon", width, height)?;
        let rgba_vec = rgba.to_vec();
        let expected_len = width as usize * height as usize * 4;
        if rgba_vec.len() != expected_len {
            return Err(Error::from_reason(format!(
                "RGBA buffer length {} does not match expected size {} ({}×{}×4)",
                rgba_vec.len(),
                expected_len,
                width,
                height
            )));
        }
        let icon = tray_icon::Icon::from_rgba(rgba_vec.clone(), width, height)
            .map_err(|e| Error::from_reason(format!("Failed to create icon from RGBA: {e}")))?;
        Ok(Self {
            inner: icon,
            rgba: rgba_vec,
            width,
            height,
        })
    }
}

#[cfg(test)]
mod dimension_cap_tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use napi::bindgen_prelude::Buffer;

    use super::{decode_icon_rgba, icon_limits, validate_dimensions, Icon};

    const DOCUMENTED_MAX: u32 = 4096;
    const ONE_OVER: u32 = 4097;

    struct TempPng(PathBuf);

    impl TempPng {
        fn from_image(image: &image::RgbaImage) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "tray-icon-node-dimension-cap-{}-{}.png",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            image
                .save_with_format(&path, image::ImageFormat::Png)
                .expect("test fixture must encode as PNG");
            Self(path)
        }

        fn as_str(&self) -> &str {
            self.0.to_str().expect("temporary path must be valid UTF-8")
        }
    }

    impl Drop for TempPng {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn accepts_dimensions_at_or_below_the_cap() {
        validate_dimensions("Icon", 16, 16).expect("16x16 is a valid tray icon size");
        validate_dimensions("Icon", DOCUMENTED_MAX, DOCUMENTED_MAX)
            .expect("4096x4096 is the maximum accepted tray icon size");
        validate_dimensions("Icon", DOCUMENTED_MAX, 1).expect("a wide icon at the cap is accepted");
        validate_dimensions("Icon", 1, DOCUMENTED_MAX).expect("a tall icon at the cap is accepted");
    }

    #[test]
    fn decoder_limits_match_the_documented_cap() {
        let limits = icon_limits();
        assert_eq!(limits.max_image_width, Some(DOCUMENTED_MAX));
        assert_eq!(limits.max_image_height, Some(DOCUMENTED_MAX));
    }

    #[test]
    fn rejects_width_one_pixel_over_the_cap() {
        let error =
            validate_dimensions("Icon", ONE_OVER, 16).expect_err("4097px width must be rejected");
        assert_eq!(
            error.reason,
            "Icon is 4097x16px; tray icons are limited to 4096px per side"
        );
    }

    #[test]
    fn rejects_height_one_pixel_over_the_cap() {
        let error =
            validate_dimensions("Icon", 16, ONE_OVER).expect_err("4097px height must be rejected");
        assert_eq!(
            error.reason,
            "Icon is 16x4097px; tray icons are limited to 4096px per side"
        );
    }

    #[test]
    fn rejects_zero_width() {
        let error = validate_dimensions("Icon", 0, 16).expect_err("zero width must be rejected");
        assert_eq!(error.reason, "Icon has invalid dimensions 0x16");
    }

    #[test]
    fn rejects_zero_height() {
        let error = validate_dimensions("Icon", 16, 0).expect_err("zero height must be rejected");
        assert_eq!(error.reason, "Icon has invalid dimensions 16x0");
    }

    #[test]
    fn from_rgba_rejects_oversize_width_before_length_validation() {
        let error = Icon::from_rgba(Buffer::from(vec![0u8; 4]), 5000, 1)
            .err()
            .expect("oversized RGBA width must be rejected");
        let message = error.reason;
        assert!(
            message.contains("is 5000x1px; tray icons are limited to 4096px per side"),
            "expected the dimension-cap message, got: {message}"
        );
        assert!(
            !message.contains("does not match expected size"),
            "dimension validation must run before buffer-length validation, got: {message}"
        );
    }

    #[test]
    fn from_rgba_rejects_oversize_height_before_length_validation() {
        let error = Icon::from_rgba(Buffer::from(vec![0u8; 4]), 1, 5000)
            .err()
            .expect("oversized RGBA height must be rejected");
        let message = error.reason;
        assert!(
            message.contains("is 1x5000px; tray icons are limited to 4096px per side"),
            "expected the dimension-cap message, got: {message}"
        );
        assert!(
            !message.contains("does not match expected size"),
            "dimension validation must run before buffer-length validation, got: {message}"
        );
    }

    #[test]
    fn rejects_an_oversized_png_from_its_header_before_decoding() {
        let oversized = image::RgbaImage::from_pixel(5000, 1, image::Rgba([9, 9, 9, 255]));
        let fixture = TempPng::from_image(&oversized);
        let error = decode_icon_rgba(fixture.as_str())
            .expect_err("a PNG header reporting more than 4096px must be rejected");
        let message = error.reason;
        assert!(
            message.contains("is 5000x1px; tray icons are limited to 4096px per side"),
            "expected the pre-decode cap message, got: {message}"
        );
    }

    #[test]
    fn decodes_a_small_valid_png() {
        let small = image::RgbaImage::from_pixel(16, 16, image::Rgba([1, 2, 3, 255]));
        let fixture = TempPng::from_image(&small);
        let decoded = decode_icon_rgba(fixture.as_str()).expect("16x16 PNG must decode");
        assert_eq!(decoded.dimensions(), (16, 16));
        assert_eq!(decoded.into_raw().len(), 16 * 16 * 4);
    }
}
