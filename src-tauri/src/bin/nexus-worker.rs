//! Processus d'exécution des connecteurs. Lit une requête JSON sur l'entrée standard et écrit le rapport
//! JSON sur la sortie standard. Aucune interface, aucun accès à l'état de l'application.

use std::io::{Read, Write};

use nexus_lib::connectors::{self, ConnectorRequest};

fn main() {
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        std::process::exit(2);
    }
    let request: ConnectorRequest = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => {
            eprintln!("requête invalide : {error}");
            std::process::exit(2);
        }
    };

    match connectors::run(&request) {
        Ok(report) => {
            let json = serde_json::to_vec(&report).unwrap_or_default();
            let _ = std::io::stdout().write_all(&json);
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
