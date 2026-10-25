// Construit le worker d'isolation (`nexus-worker`). Sans lui, les recherches OSINT échouent (« worker indisponible »).
// Tauri exige que le binaire externe existe déjà au moment de la compilation : un fichier vide est posé d'abord, puis
// remplacé par le worker construit. Le même binaire sert au développement (à côté de l'exécutable) et à l'installateur.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcTauri = join(root, "src-tauri");
const release = process.argv.includes("--release");
const target = "x86_64-pc-windows-msvc";
const binaries = join(srcTauri, "binaries");
const placeholder = join(binaries, `nexus-worker-${target}.exe`);

mkdirSync(binaries, { recursive: true });
if (!existsSync(placeholder)) writeFileSync(placeholder, "");

execFileSync("cargo", ["build", "--bin", "nexus-worker", ...(release ? ["--release"] : [])], { cwd: srcTauri, stdio: "inherit" });

copyFileSync(join(srcTauri, "target", release ? "release" : "debug", "nexus-worker.exe"), placeholder);
console.log(`worker prêt : src-tauri/binaries/nexus-worker-${target}.exe (${release ? "release" : "debug"})`);
