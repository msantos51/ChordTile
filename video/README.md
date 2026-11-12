# Vídeo de apresentação

Vídeo curto (9:16, 1080×1920, ~33 s) para TikTok, YouTube Shorts e Reels, feito a partir do **site real**: as cenas são gravadas automaticamente no leitor e montadas com legendas animadas e um final de marca. Nada é editado à mão: mudar um texto, uma cena ou o enquadramento é mudar o código e gerar outra vez.

## Como gerar

Precisas do Node.js 22 e do `ffmpeg`.

```bash
cd video && npm install          # uma vez
```

1. **Gravar as cenas** (com o site a correr, sem Supabase, para estar tudo desbloqueado):

   ```bash
   npm run dev                      # na raiz do projeto, noutro terminal
   cd video && npm run record       # grava public/clips/*.mp4 (imagem e som)
   ```

   Só uma cena: `node scripts/record.cjs http://localhost:5173 learn`.

2. **Montar o vídeo**:

   ```bash
   npm run render                   # → out/chordtile-short-final.mp4
   ```

   Para pré-visualizar e afinar no browser: `npm run studio`.

   Se já tiveres um Chromium na máquina, podes usá-lo em vez de o Remotion descarregar um: `REMOTION_BROWSER=/caminho/para/chrome-headless-shell npm run render`.

## O que está onde

| Ficheiro | O que faz |
|---|---|
| `scripts/record.cjs` | Grava cada cena no leitor (telemóvel, 412×780 a 2,33×): frames nítidos pelo CDP, com a hora de cada um, e o som do leitor; junta-os num MP4 a 30 fps |
| `scripts/audiotap.js` | Copia o som da página (música e contagem) para um gravador |
| `scripts/finish.sh` | Normaliza o volume para as redes sociais (-14 LUFS) |
| `src/Short.tsx` | A montagem: cenas, legendas, enquadramento (zoom e posição de cada cena), "a música toda" e o final |
| `src/brand.ts` | Cores do site, cor de cada nota e os acordes da música de exemplo |

As cenas cortam no tempo forte: a música de exemplo tem 100 bpm, um compasso tem 72 frames.

## Notas

- **Música:** é a música de exemplo do site (`public/sample.gp5`), criada para o projeto, por isso não há problemas de direitos de autor. Não usar músicas comerciais.
- **Remotion:** gratuito para pessoas a título individual e empresas pequenas (até 3 pessoas); acima disso precisa de licença. Ver [remotion.dev/license](https://www.remotion.dev/license).
- `public/clips/` e `out/` não vão para o git (são gerados).
