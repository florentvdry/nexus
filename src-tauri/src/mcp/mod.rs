//! Connecteurs MCP (Model Context Protocol). Quand une demande dépasse les capacités de NEXUS, le modèle propose un
//! service extérieur ; NEXUS cherche un serveur MCP dans un catalogue de confiance, l'installe seulement après accord
//! de l'utilisateur, puis appelle ses outils. Aucun serveur n'est lancé sans cet accord.

pub mod catalog;
pub mod client;
pub mod commands;
pub mod store;
