//! SIMULATION DE SOURCE, réservée aux tests. Un serveur HTTP local répond avec des réponses fixes.
//! Il ne représente aucune donnée réelle : il permet de tester les connecteurs sans accès Internet.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::thread;

/// Routes : (préfixe de la cible HTTP, code, corps). Renvoie l'URL de base, p. ex. `http://127.0.0.1:4321`.
pub fn simulated_source(routes: Vec<(&'static str, u16, &'static str)>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("port libre");
    let base = format!("http://{}", listener.local_addr().expect("adresse locale"));
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request_line = String::new();
            if BufReader::new(&stream).read_line(&mut request_line).is_err() {
                continue;
            }
            let target = request_line.split_whitespace().nth(1).unwrap_or("/").to_string();
            let (status, body) = routes
                .iter()
                .find(|(prefix, _, _)| target.starts_with(prefix))
                .map(|(_, status, body)| (*status, *body))
                .unwrap_or((404, ""));
            let response = format!(
                "HTTP/1.1 {status} SIM\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    base
}
