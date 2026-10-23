//! Profil de la machine pour le choix du modèle de langage local (TODO §1). Lecture seule, sans donnée envoyée.
//!
//! La carte graphique est lue par DXGI sous Windows : c'est la seule API qui donne la mémoire dédiée réelle
//! (WMI plafonne `AdapterRAM` à 4 Go). Les adaptateurs logiciels (rendu de secours de Windows) sont ignorés.

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

/// Un adaptateur vu par le système, avant le choix de la carte à montrer.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, PartialEq)]
struct GpuCandidate {
    name: String,
    vram_bytes: u64,
    software: bool,
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
    profile_from(system.total_memory(), cores, has_avx2(), read_gpu())
}

/// Carte matérielle la plus puissante : la mémoire dédiée la plus grande, adaptateurs logiciels exclus.
#[cfg_attr(not(windows), allow(dead_code))]
fn pick_gpu(candidates: &[GpuCandidate]) -> Option<GpuInfo> {
    candidates
        .iter()
        .filter(|candidate| !candidate.software && !candidate.name.is_empty())
        .max_by_key(|candidate| candidate.vram_bytes)
        .map(|candidate| GpuInfo {
            name: candidate.name.clone(),
            vram_gib: candidate.vram_bytes as f64 / GIB,
        })
}

#[cfg(windows)]
fn read_gpu() -> Option<GpuInfo> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};

    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }.ok()?;
    let mut candidates = Vec::new();
    let mut index = 0;
    // `EnumAdapters1` renvoie une erreur quand la liste est épuisée : c'est la fin de la boucle.
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(index) } {
        if let Ok(desc) = unsafe { adapter.GetDesc1() } {
            candidates.push(GpuCandidate {
                name: wide_to_string(&desc.Description),
                vram_bytes: desc.DedicatedVideoMemory as u64,
                software: (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0,
            });
        }
        index += 1;
    }
    pick_gpu(&candidates)
}

#[cfg(windows)]
fn wide_to_string(wide: &[u16]) -> String {
    let end = wide.iter().position(|&unit| unit == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..end]).trim().to_string()
}

#[cfg(not(windows))]
fn read_gpu() -> Option<GpuInfo> {
    None
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

    fn candidate(name: &str, vram_gib: u64, software: bool) -> GpuCandidate {
        GpuCandidate { name: name.into(), vram_bytes: vram_gib * 1024 * 1024 * 1024, software }
    }

    #[test]
    fn memory_is_reported_in_gibibytes() {
        let profile = profile_from(8 * 1024 * 1024 * 1024, 4, true, None);
        assert_eq!(profile.memory_gib, 8.0);
        assert_eq!(profile.cores, 4);
        assert!(profile.avx2);
        assert!(profile.gpu.is_none());
    }

    #[test]
    fn the_adapter_with_the_most_dedicated_memory_is_picked() {
        let gpu = pick_gpu(&[candidate("Intel UHD", 0, false), candidate("NVIDIA GeForce RTX 4060", 8, false)]);
        assert_eq!(gpu, Some(GpuInfo { name: "NVIDIA GeForce RTX 4060".into(), vram_gib: 8.0 }));
    }

    #[test]
    fn software_renderers_are_never_picked() {
        assert_eq!(pick_gpu(&[candidate("Microsoft Basic Render Driver", 0, true)]), None);
        assert_eq!(pick_gpu(&[]), None);
    }

    #[test]
    fn a_real_reading_reports_at_least_one_core_and_some_memory() {
        let profile = read_profile();
        assert!(profile.cores >= 1);
        assert!(profile.memory_gib > 0.0);
    }
}
