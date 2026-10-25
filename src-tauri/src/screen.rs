//! Capture de l'écran principal, sur demande seulement. La capture est réduite, encodée en PNG et renvoyée à l'interface,
//! qui la donne au modèle local. Rien n'est enregistré sur le disque et rien ne quitte ce poste.

use crate::error::AdapterError;
use crate::grants::require_main;
use crate::web::base64;

/// Largeur maximale envoyée au modèle : assez pour lire un texte, sans alourdir la requête.
pub const MAX_WIDTH: usize = 1024;

/// Somme de contrôle CRC-32 (norme PNG).
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in bytes {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

fn adler32(bytes: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in bytes {
        a = (a + byte as u32) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut body = Vec::with_capacity(4 + data.len());
    body.extend_from_slice(kind);
    body.extend_from_slice(data);
    out.extend_from_slice(&body);
    out.extend_from_slice(&crc32(&body).to_be_bytes());
}

/// Encodage PNG (RGB, 8 bits) sans compression : format valide, lu par tout décodeur, et sans dépendance.
pub fn encode_png(width: usize, height: usize, rgb: &[u8]) -> Vec<u8> {
    let mut raw = Vec::with_capacity(height * (width * 3 + 1));
    for row in rgb.chunks(width * 3).take(height) {
        raw.push(0);
        raw.extend_from_slice(row);
    }
    // Bloc DEFLATE « stored » : au plus 65 535 octets par bloc.
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (index, block) in blocks.iter().enumerate() {
        let last = index + 1 == blocks.len();
        zlib.push(if last { 1 } else { 0 });
        let len = block.len() as u16;
        zlib.extend_from_slice(&len.to_le_bytes());
        zlib.extend_from_slice(&(!len).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());

    let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut header = Vec::with_capacity(13);
    header.extend_from_slice(&(width as u32).to_be_bytes());
    header.extend_from_slice(&(height as u32).to_be_bytes());
    header.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(&mut png, b"IHDR", &header);
    chunk(&mut png, b"IDAT", &zlib);
    chunk(&mut png, b"IEND", &[]);
    png
}

/// Réduit une image BGRA (format Windows) en RGB, à `MAX_WIDTH` au plus, par échantillonnage simple.
pub fn downscale_bgra(bgra: &[u8], width: usize, height: usize) -> (Vec<u8>, usize, usize) {
    let (target_w, target_h) = if width > MAX_WIDTH {
        let target_h = (height * MAX_WIDTH / width).max(1);
        (MAX_WIDTH, target_h)
    } else {
        (width, height)
    };
    let mut rgb = Vec::with_capacity(target_w * target_h * 3);
    for y in 0..target_h {
        let source_y = y * height / target_h;
        for x in 0..target_w {
            let source_x = x * width / target_w;
            let index = (source_y * width + source_x) * 4;
            rgb.push(bgra[index + 2]);
            rgb.push(bgra[index + 1]);
            rgb.push(bgra[index]);
        }
    }
    (rgb, target_w, target_h)
}

/// Capture de l'écran principal, encodée en PNG et en base64 (prête pour le modèle).
#[cfg(windows)]
pub fn capture_primary_base64() -> Result<String, AdapterError> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    let width = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(1) as usize;
    let height = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(1) as usize;
    let fail = |what: &str| AdapterError::Operation(format!("capture d'écran impossible ({what})"));

    // SAFETY: handles créés ici, libérés dans l'ordre inverse ; aucune donnée n'est lue hors des bornes allouées.
    let pixels = unsafe {
        let screen = GetDC(Some(HWND::default()));
        if screen.is_invalid() {
            return Err(fail("écran inaccessible"));
        }
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, width as i32, height as i32);
        let previous = SelectObject(memory, bitmap.into());
        let copied = BitBlt(memory, 0, 0, width as i32, height as i32, Some(screen), 0, 0, SRCCOPY);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buffer = vec![0u8; width * height * 4];
        let lines = GetDIBits(memory, bitmap, 0, height as u32, Some(buffer.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
        SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(Some(HWND::default()), screen);
        if copied.is_err() || lines == 0 {
            return Err(fail("copie de l'écran"));
        }
        buffer
    };
    let (rgb, w, h) = downscale_bgra(&pixels, width, height);
    Ok(base64(&encode_png(w, h, &rgb)))
}

#[cfg(not(windows))]
pub fn capture_primary_base64() -> Result<String, AdapterError> {
    Err(AdapterError::Operation("la capture d'écran n'est disponible que sous Windows".into()))
}

#[tauri::command]
pub async fn screen_capture(webview: tauri::Webview) -> Result<String, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(capture_primary_base64)
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_the_png_reference_value() {
        // Valeur de référence de la norme PNG pour le bloc IEND.
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
    }

    #[test]
    fn a_png_has_its_signature_header_and_end_chunks() {
        let rgb = vec![255u8, 0, 0, 0, 255, 0];
        let png = encode_png(2, 1, &rgb);
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(&png[png.len() - 8..png.len() - 4], b"IEND");
    }

    #[test]
    fn a_wide_screen_is_reduced_to_the_maximum_width() {
        let bgra = vec![0u8; 2048 * 1024 * 4];
        let (rgb, w, h) = downscale_bgra(&bgra, 2048, 1024);
        assert_eq!((w, h), (MAX_WIDTH, 512));
        assert_eq!(rgb.len(), w * h * 3);
    }

    #[test]
    fn colours_are_turned_from_bgra_to_rgb() {
        let bgra = vec![10u8, 20, 30, 255];
        let (rgb, _, _) = downscale_bgra(&bgra, 1, 1);
        assert_eq!(rgb, vec![30, 20, 10]);
    }

}
