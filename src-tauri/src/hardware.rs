//! Profil de la machine pour le choix du modèle de langage local (TODO §1). Lecture seule, sans donnée envoyée.
//!
//! La mémoire vidéo n'est pas lue : il n'existe pas d'API commune sous Windows sans dépendance supplémentaire.
//! `gpu` reste donc `None` tant que cette lecture n'est pas ajoutée ; le choix des niveaux n'en dépend pas encore.

use serde::Serialize;
use sysinfo::System;

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

// `camelCase` donnerait `memoryGib` : les noms explicites gardent ceux qu'attend l'interface (`memoryGiB`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    #[serde(rename = "vramGiB")]
    pub vram_gib: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    #[serde(rename = "memoryGiB")]
    pub memory_gib: f64,
    pub cores: usize,
    pub avx2: bool,
    pub gpu: Option<GpuInfo>,
}

/// Construit le profil à partir de valeurs déjà lues. Séparé de la lecture pour rester testable.
pub fn profile_from(memory_bytes: u64, cores: usize, avx2: bool, gpu: Option<GpuInfo>) -> HardwareProfile {
    HardwareProfile {
        memory_gib: memory_bytes as f64 / GIB,
        cores,
        avx2,
        gpu,
    }
}

/// Mesure réelle de la machine. Bloque le temps de la lecture : à appeler depuis `spawn_blocking`.
pub fn read_profile() -> HardwareProfile {
    let system = System::new_all();
    let cores = System::physical_core_count().unwrap_or_else(|| system.cpus().len());
    profile_from(system.total_memory(), cores, has_avx2(), None)
}

#[cfg(target_arch = "x86_64")]
fn has_avx2() -> bool {
    std::arch::is_x86_feature_detected!("avx2")
}

#[cfg(not(target_arch = "x86_64"))]
fn has_avx2() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_is_reported_in_gibibytes() {
        let profile = profile_from(8 * 1024 * 1024 * 1024, 4, true, None);
        assert_eq!(profile.memory_gib, 8.0);
        assert_eq!(profile.cores, 4);
        assert!(profile.avx2);
        assert!(profile.gpu.is_none());
    }

    #[test]
    fn a_real_reading_reports_at_least_one_core_and_some_memory() {
        let profile = read_profile();
        assert!(profile.cores >= 1);
        assert!(profile.memory_gib > 0.0);
    }
}
