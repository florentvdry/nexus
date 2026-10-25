//! État de la batterie, en lecture seule. Un poste sans batterie (fixe) renvoie `None` : ce n'est pas une erreur.

use serde::Serialize;

use crate::error::AdapterError;
use crate::grants::require_main;

/// Batterie : charge en pourcentage et branchement secteur.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatteryStatus {
    pub percent: u8,
    pub charging: bool,
}

/// Interprétation des valeurs brutes de Windows (`SYSTEM_POWER_STATUS`). Testée sans matériel.
/// `flags` 128 signifie « pas de batterie » ; 255 pour la charge signifie « inconnue ».
pub fn interpret(ac_line: u8, battery_flag: u8, percent: u8) -> Option<BatteryStatus> {
    const NO_BATTERY: u8 = 128;
    const UNKNOWN_PERCENT: u8 = 255;
    if battery_flag & NO_BATTERY != 0 || percent == UNKNOWN_PERCENT {
        return None;
    }
    Some(BatteryStatus { percent: percent.min(100), charging: ac_line == 1 })
}

#[cfg(windows)]
pub fn read_battery() -> Result<Option<BatteryStatus>, AdapterError> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: la structure est initialisée et transmise par pointeur, comme l'attend l'API Windows.
    unsafe { GetSystemPowerStatus(&mut status) }.map_err(|error| AdapterError::Operation(format!("état de l'énergie indisponible ({error})")))?;
    Ok(interpret(status.ACLineStatus, status.BatteryFlag, status.BatteryLifePercent))
}

#[cfg(not(windows))]
pub fn read_battery() -> Result<Option<BatteryStatus>, AdapterError> {
    Err(AdapterError::Operation("l'état de la batterie n'est lu que sous Windows".into()))
}

#[tauri::command]
pub async fn battery_status(webview: tauri::Webview) -> Result<Option<BatteryStatus>, AdapterError> {
    require_main(&webview)?;
    tauri::async_runtime::spawn_blocking(read_battery)
        .await
        .map_err(|error| AdapterError::TaskFailed(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_desktop_without_battery_has_no_status() {
        assert_eq!(interpret(1, 128, 255), None);
    }

    #[test]
    fn an_unknown_level_has_no_status() {
        assert_eq!(interpret(0, 1, 255), None);
    }

    #[test]
    fn the_level_and_the_charger_are_read() {
        assert_eq!(interpret(0, 1, 12), Some(BatteryStatus { percent: 12, charging: false }));
        assert_eq!(interpret(1, 8, 80), Some(BatteryStatus { percent: 80, charging: true }));
    }

    #[test]
    fn a_level_above_100_is_capped() {
        assert_eq!(interpret(1, 1, 150).map(|status| status.percent), Some(100));
    }
}
