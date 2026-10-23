//! Plugins de données : manifeste `nexus.json`, validation, empreinte, installation depuis un dossier ou un dépôt Git,
//! lock des plugins approuvés, catalogue. Spécification : `docs/PLUGIN-SPEC.md`.

pub mod check;
pub mod index;
pub mod manifest;
pub mod packs;
pub mod sandbox;
pub mod store;

pub use store::{Installed, PackData, Prepared, State, Store};

#[cfg(test)]
mod tests;
