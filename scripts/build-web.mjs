// Copia só os arquivos do jogo para www/, que é o que vai dentro do app
// Android (Capacitor). Testes, README e afins ficam de fora.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const FILES = ['index.html', 'style.css', 'manifest.webmanifest', 'sw.js', 'js', 'icons'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const file of FILES) cpSync(file, `www/${file}`, { recursive: true });
console.log(`www/ pronto (${FILES.join(', ')})`);
