use serde::Serialize;
use sysinfo::{Disks, System};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub mount_point: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os_name: String,
    pub host_name: String,
    pub cpu_brand: String,
    pub cpu_count: usize,
    pub cpu_usage_percent: f32,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub disks: Vec<DiskInfo>,
    pub uptime_seconds: u64,
}

/// Mesure réelle de l'état de la machine.
///
/// La mesure CPU exige deux échantillons séparés d'un intervalle minimal : cette fonction
/// bloque donc un thread et doit être appelée depuis `spawn_blocking`.
pub fn read_system_info() -> SystemInfo {
    let mut system = System::new();
    system.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    system.refresh_cpu_usage();
    system.refresh_memory();

    let disks = Disks::new_with_refreshed_list()
        .list()
        .iter()
        .map(|disk| DiskInfo {
            mount_point: disk.mount_point().to_string_lossy().into_owned(),
            total_bytes: disk.total_space(),
            available_bytes: disk.available_space(),
        })
        .collect();

    SystemInfo {
        os_name: System::long_os_version().unwrap_or_else(|| "Système inconnu".into()),
        host_name: System::host_name().unwrap_or_else(|| "inconnu".into()),
        cpu_brand: system
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim().to_string())
            .unwrap_or_default(),
        cpu_count: system.cpus().len(),
        cpu_usage_percent: system.global_cpu_usage(),
        memory_total_bytes: system.total_memory(),
        memory_used_bytes: system.used_memory(),
        disks,
        uptime_seconds: System::uptime(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_plausible_memory_and_cpu_values() {
        let info = read_system_info();
        assert!(info.cpu_count > 0, "au moins un processeur logique");
        assert!(info.memory_total_bytes > 0, "mémoire totale positive");
        assert!(info.memory_used_bytes <= info.memory_total_bytes);
        assert!((0.0..=100.0).contains(&info.cpu_usage_percent));
    }
}
