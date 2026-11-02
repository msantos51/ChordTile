// Página inicial: apresentação do site. O ficheiro escolhido aqui fica guardado neste browser
// (IndexedDB) e o leitor abre-o logo (player.html?open). Nada é enviado para um servidor.
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist/latin-700.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/plus-jakarta-sans/latin-800.css';
import './landing.css';
import { setPendingFile } from './app/library';

const input = document.getElementById('landingFile') as HTMLInputElement;
const drop = document.getElementById('landingDrop') as HTMLElement;
const err = document.getElementById('landingErr') as HTMLElement;

function fail(msg: string) {
  err.textContent = msg; err.hidden = false;
}

async function openInReader(f: File | undefined) {
  if (!f) return;
  err.hidden = true;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    await setPendingFile(f.name, bytes);
    location.href = './player.html?open';
  } catch {
    fail('Couldn’t hand the file to the player in this browser (private mode?). Open the player and load it there.');
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b => b.addEventListener('click', () => input.click()));
input.addEventListener('change', () => { void openInReader(input.files?.[0]); input.value = ''; });

let dragN = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { dragN++; drop.hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) drop.hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragN = 0; drop.hidden = true; void openInReader(e.dataTransfer?.files[0]); });
