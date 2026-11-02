# Mapa de Compassos

Plataforma para aprender músicas a partir de ficheiros Guitar Pro. Carregas o ficheiro e o site:

- divide a música pelas **secções** marcadas no ficheiro (Intro, Verso, Refrão…);
- deteta o **tom de cada compasso** e mostra-o num quadrado com a **cor da nota** (convenção Boomwhackers: Dó vermelho … Si rosa);
- mostra a **tablatura** sincronizada e toca a música, com **loop por secção**, velocidade de 25 % a 150 %, metrónomo, contagem e "tocar por cima" (silencia a tua pista) ou "só o meu instrumento" (ouve-se só a tua pista);
- deixa **editar** tudo (tons, nomes, dividir secções) e **exportar o esquema para PDF**;
- **guarda as músicas importadas** neste browser ("As minhas músicas") e abre a última ao voltar;
- tem um **tutorial** na primeira visita e uma página **Como funciona** (`ajuda.html`).

Os ficheiros são lidos só no browser: nada é enviado para um servidor.

## Começar

Precisas do Node.js 22.

```bash
npm install
npm run dev        # servidor local em http://localhost:5173
```

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm test` | Testes (deteção dos acordes, notas, contagem, PDF) |
| `npm run typecheck` | Verifica os tipos TypeScript |
| `npm run build` | Gera o site em `dist/` |
| `npm run preview` | Serve o `dist/` localmente |

## Estrutura

```
index.html                 Página inicial (apresentação; design "Azul profundo")
leitor.html                O leitor: esquema, tablatura e leitor (estrutura e ícones)
licencas.html              Termos, privacidade e licenças
ajuda.html                 Página "Como funciona" (guia e perguntas frequentes)
src/
  main.ts                  Interface: esquema, tablatura sincronizada, leitor, ajustes
  fonts.ts                 Fontes alojadas no site (Fontsource)
  styles.css               Estilos (design "Estúdio": tema escuro e tema claro, tokens de cor)
  analysis/
    analyze.ts             Deteção do tom por compasso e secções (módulo puro, testado)
    parse.ts               Leitura dos ficheiros, com recurso a Windows-1252 nos GP3–GP5
    bar.ts                 Notas de um compasso (corda, casa, início) para a vista em grande
  app/
    notes.ts               Nome escrito → nota (A, F#m, Dó, Sib…) para as cores
    count.ts               Contagem do compasso (1 & 2 &, 1 e & a) e escolha automática da subdivisão
    pdf.ts                 Exportar o esquema para PDF (jsPDF, carregado só quando se exporta)
    sync.ts                Atraso do cursor/esquema para compensar a latência do áudio
    theme.ts               Tema claro/escuro (guardado no browser) e cores da tablatura
    audio-unlock.ts        Som no iPhone mesmo com o interruptor de silêncio ligado
    library.ts             "As minhas músicas": ficheiros importados guardados no browser (IndexedDB)
    tour.ts                Tutorial da primeira visita (passos e destaques)
tests/                     Testes (Vitest) e ficheiro .gp5 de exemplo
scripts/
  copy-alphatab.mjs        Copia o alphaTab, a fonte e os sons para public/vendor
  make-fixture.py          Gera o .gp5 de teste (precisa de `pip install pyguitarpro`)
```

### Como funciona a deteção

O tom é detetado **só a partir do instrumento selecionado** (menu ao lado de "Esquema" ou em Ajustes). Por
defeito é o baixo, se a música tiver um; a escolha fica guardada por música, e as correções feitas à mão
ficam guardadas por instrumento.

Para cada compasso soma a duração de cada nota desse instrumento por classe de nota, dá mais peso à nota
mais grave de cada tempo e ao início do compasso, e compara com modelos de acorde maior, menor e power chord.
Se o ficheiro tiver acordes escritos nesse instrumento, usa esses.

### alphaTab

A leitura dos ficheiros, a tablatura e o som usam o [alphaTab](https://alphatab.net) (MPL-2.0). É servido como
script clássico a partir de `public/vendor/alphatab` (criado pelo `npm run vendor`, que corre antes do `dev`
e do `build`), porque os workers do leitor reabrem esse mesmo ficheiro. A fonte Bravura (OFL) e o banco de
sons Sonivox (Apache 2.0) vêm no pacote do alphaTab; o script copia também os textos das licenças.

### Fontes

Geist, Geist Mono e Plus Jakarta Sans (títulos da página inicial), todas OFL, vêm do [Fontsource](https://fontsource.org)
e são servidas pelo próprio site (`src/fonts.ts`, `src/landing.ts`). Não há pedidos a servidores de terceiros, o que evita enviar o IP de quem visita à Google.

## Músicas guardadas e tutorial

Cada ficheiro importado é guardado no IndexedDB do browser (base `mapa-de-compassos`, identificado por
título | artista | nº de compassos), junto com as correções que já ficavam no `localStorage`. Nada vai para um
servidor. O tutorial aparece só na primeira visita (`mapa:tour-visto`) e pode ser revisto no menu "?".

## Termos, privacidade e licenças

A página `licencas.html` (ligada no rodapé) tem os termos de utilização, a nota de privacidade e as licenças de
todos os componentes de terceiros. Se acrescentares uma dependência que vá para o site, acrescenta-a lá.

O código deste repositório é © 2026 Miguel Santos, todos os direitos reservados (ver `LICENSE`).

## Telemóvel

O site adapta-se a telemóveis e tablets (vertical e horizontal): leitor compacto numa linha (as opções abrem no botão
de ajustes), tablatura com dois compassos por linha, janela do compasso em ecrã inteiro e alvos de toque de 44 px.
Em ecrãs táteis, tocar num quadrado escolhe o compasso sem abrir o teclado; para corrigir o tom usa-se "Editar".
Pode ser adicionado ao ecrã principal (`manifest.webmanifest` e ícones em `public/`).

## Publicação

Cada push para a `main` publica o site no GitHub Pages (`.github/workflows/deploy.yml`).
Na primeira vez, ativa em **Settings → Pages → Source: GitHub Actions**.

Cada PR corre os testes, a verificação de tipos e o build (`.github/workflows/ci.yml`).
