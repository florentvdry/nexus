//! Banc de compréhension : rejoue le corpus partagé (`src/core/language-model/corpus.json`) sur le modèle Ollama réel,
//! avec la vraie consigne (`ollama::classify_at`). Ignoré par défaut : il exige Ollama et un modèle installé.
//!
//! Lancer : `NEXUS_BENCH_MODEL=qwen2.5:14b cargo test comprehension_bench -- --ignored --nocapture`
//! Rapport JSON facultatif : `NEXUS_BENCH_OUT=<chemin>`.

#[cfg(test)]
mod tests {
    use crate::ollama;
    use serde::{Deserialize, Serialize};
    use std::collections::BTreeMap;
    use std::time::Instant;

    const CORPUS: &str = include_str!("../../src/core/language-model/corpus.json");

    #[derive(Deserialize)]
    struct Case {
        category: String,
        text: String,
        expected: Vec<String>,
    }

    #[derive(Serialize)]
    struct Miss {
        text: String,
        category: String,
        got: String,
        expected: Vec<String>,
    }

    #[derive(Serialize, Default)]
    struct Score {
        correct: usize,
        total: usize,
    }

    #[derive(Serialize)]
    struct Report {
        model: String,
        total: usize,
        correct: usize,
        accuracy: f64,
        errors: usize,
        mean_seconds: f64,
        p50_seconds: f64,
        p95_seconds: f64,
        by_category: BTreeMap<String, Score>,
        misses: Vec<Miss>,
    }

    fn percentile(sorted: &[f64], share: f64) -> f64 {
        if sorted.is_empty() {
            return 0.0;
        }
        let index = ((sorted.len() as f64 - 1.0) * share).round() as usize;
        sorted[index]
    }

    #[test]
    #[ignore = "exige Ollama et NEXUS_BENCH_MODEL"]
    fn comprehension_bench_on_the_real_model() {
        let model = std::env::var("NEXUS_BENCH_MODEL").expect("définir NEXUS_BENCH_MODEL (ex. qwen2.5:14b)");
        let cases: Vec<Case> = serde_json::from_str(CORPUS).expect("corpus.json valide");

        let mut by_category: BTreeMap<String, Score> = BTreeMap::new();
        let mut misses = Vec::new();
        let mut seconds = Vec::with_capacity(cases.len());
        let mut errors = 0;
        let mut correct = 0;

        for case in &cases {
            let started = Instant::now();
            let outcome = ollama::classify_at(ollama::ENDPOINT, &model, &case.text, &[]);
            seconds.push(started.elapsed().as_secs_f64());

            let got = match outcome {
                Ok(value) => value.get("type").and_then(|kind| kind.as_str()).unwrap_or("?").to_string(),
                Err(_) => {
                    errors += 1;
                    "ERREUR".to_string()
                }
            };
            let hit = case.expected.contains(&got);
            if hit {
                correct += 1;
            } else {
                misses.push(Miss { text: case.text.clone(), category: case.category.clone(), got, expected: case.expected.clone() });
            }
            let score = by_category.entry(case.category.clone()).or_default();
            score.total += 1;
            if hit {
                score.correct += 1;
            }
        }

        let mut sorted = seconds.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let mean = if seconds.is_empty() { 0.0 } else { seconds.iter().sum::<f64>() / seconds.len() as f64 };
        let report = Report {
            model: model.clone(),
            total: cases.len(),
            correct,
            accuracy: if cases.is_empty() { 0.0 } else { correct as f64 / cases.len() as f64 },
            errors,
            mean_seconds: mean,
            p50_seconds: percentile(&sorted, 0.5),
            p95_seconds: percentile(&sorted, 0.95),
            by_category,
            misses,
        };

        println!(
            "modèle {} : {}/{} justes ({:.1} %), erreurs {}, moyenne {:.2} s, p50 {:.2} s, p95 {:.2} s",
            report.model,
            report.correct,
            report.total,
            report.accuracy * 100.0,
            report.errors,
            report.mean_seconds,
            report.p50_seconds,
            report.p95_seconds
        );
        for (category, score) in &report.by_category {
            println!("  {category:<12} {}/{}", score.correct, score.total);
        }
        for miss in &report.misses {
            println!("  RATÉ [{}] « {} » -> {} (attendu {:?})", miss.category, miss.text, miss.got, miss.expected);
        }

        if let Ok(path) = std::env::var("NEXUS_BENCH_OUT") {
            let json = serde_json::to_string_pretty(&report).expect("rapport sérialisable");
            std::fs::write(&path, json).expect("rapport écrit");
            println!("rapport : {path}");
        }
    }
}
