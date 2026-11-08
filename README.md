# ChordTile

Plataforma para aprender músicas a partir de ficheiros Guitar Pro. Carregas o ficheiro e o site:

- divide a música pelas **secções** marcadas no ficheiro (Intro, Verso, Refrão…);
- deteta o **tom de cada compasso** e mostra-o num quadrado com a **cor da nota** (convenção Boomwhackers: Dó vermelho … Si rosa);
- mostra a **tablatura** sincronizada e toca a música, com **loop por secção**, velocidade (25, 50, 75, 100 e 125 %), metrónomo, contagem e "tocar por cima" (silencia a tua pista) ou "só o meu instrumento" (ouve-se só a tua pista);
- deixa **mudar o nome e dividir as secções**, escrever **notas em cada compasso** e **exportar o esquema para PDF** (com o mesmo aspeto do site);
- **guarda as músicas importadas na conta** ("My songs"): Gratuito até 3, Premium sem limite; em qualquer dispositivo abre a última. **Nada fica guardado no browser** além da sessão de login;
- tem um **tutorial** na primeira visita e uma página **How it works** (`help.html`).

O site está em **inglês**; o código e esta documentação continuam em português.

Os ficheiros são abertos no browser e guardados, em privado, na conta (Supabase). Sem conta só se experimenta a música de exemplo e nada do que se mude fica guardado.

## Começar

Precisas do Node.js 22.

```bash
npm install
npm run dev        # servidor local em http://localhost:5173
```

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm test` | Testes (deteção dos acordes, notas, contagem, técnicas, PDF, planos, metrónomo, migração dos dados antigos) |
| `npm run typecheck` | Verifica os tipos TypeScript |
| `npm run build` | Gera o site em `dist/` |
| `npm run preview` | Serve o `dist/` localmente |

## Estrutura

```
index.html                 Página inicial (apresentação)
player.html                O leitor: esquema, tablatura e leitor (estrutura e ícones)
account.html               Conta: entrar, perfil, plano, segurança e apagar a conta
licenses.html              Termos, privacidade e licenças
help.html                  Página "How it works" (guia e perguntas frequentes)
public/leitor.html, ajuda.html, licencas.html   Redirecionam os endereços antigos para os novos
src/
  main.ts                  Interface: esquema, tablatura sincronizada, leitor, ajustes
  landing.ts               Página inicial (animação e importar a partir daí)
  account.ts               Página da conta
  doc.ts                   Páginas de texto (ajuda e termos)
  fonts.ts                 Fontes alojadas no site (Fontsource)
  styles.css               Estilos do leitor e das páginas de texto (design "Vermelho, branco e preto": tema escuro e claro, tokens de cor)
  landing.css              Estilos da página inicial (mesma paleta)
  analysis/
    analyze.ts             Deteção do tom por compasso e secções (módulo puro, testado)
    parse.ts               Leitura dos ficheiros, com recurso a Windows-1252 nos GP3–GP5
    bar.ts                 Notas de um compasso (corda, casa, início) para a vista em grande
  app/
    notes.ts               Nome escrito → nota (A, F#m, Dó, Sib…) para as cores
    count.ts               Contagem do compasso (1 & 2 &, 1 e & a) e escolha automática da subdivisão
    pdf.ts                 Exportar o esquema para PDF (jsPDF, carregado só quando se exporta), com as cores, o tema e a letra do site
    sync.ts                Atraso do cursor/esquema para compensar a latência do áudio
    theme.ts               Tema claro/escuro (guardado na conta) e cores da tablatura
    audio-unlock.ts        Som no iPhone mesmo com o interruptor de silêncio ligado
    library.ts             Leitura única dos dados que versões antigas deixaram no browser (para os passar para a conta)
    user-store.ts          Dados da pessoa (notas, secções, progresso, preferências): em memória e guardados na conta
    tour.ts                Tutorial da primeira visita (passos e destaques)
    metronome.ts           Sons do metrónomo e da contagem (clique, voz, woodblock…) e a sua geração em amostras
    metro-grid.ts          Grelha das batidas, calculada como o sintetizador do alphaTab a calcula (puro, testado)
    metro-inject.ts        Mistura o metrónomo e a contagem no fluxo de áudio da música, na amostra exata
    plan.ts                Planos (sem conta / Free / Premium) e o que cada um desbloqueia
    practice.ts            Progresso por secção (tempo, melhor velocidade, "Mastered")
    billing.ts             Preços e links de pagamento (Stripe)
    cloud.ts, cloud-plan.ts   Conta, "My songs" e dados da pessoa (Supabase)
    auth-ui.ts, auth-errors.ts   Janela de entrar / criar conta / nova palavra-passe
tests/                     Testes (Vitest) e ficheiro .gp5 de teste
public/sample.gp5          Música de exemplo do site (gerada com `make-fixture.py --en`)
scripts/
  copy-alphatab.mjs        Copia o alphaTab, a fonte e os sons para public/vendor
  pdf-fonts.mjs            Converte a Roboto (WOFF) em TTF para o PDF, em public/vendor/fonts
  make-fixture.py          Gera o .gp5 de teste (precisa de `pip install pyguitarpro`)
```

### Como funciona a deteção

O tom é detetado **só a partir do instrumento selecionado** (menu do instrumento na barra de topo).
Por defeito é o baixo, se a música tiver um; a escolha fica guardada por música.

Para cada compasso soma a duração de cada nota desse instrumento por classe de nota, dá mais peso à nota
mais grave de cada tempo e ao início do compasso, e compara com modelos de acorde maior, menor e power chord.
Se o ficheiro tiver acordes escritos nesse instrumento, usa esses.

### Tile by Tile (aprender de cor)

Método guiado no leitor (`player.html?learn`, atalho `learn.html`). O percurso (`src/app/learn-path.ts`, testado) é,
para cada secção: **Learn** (só a tab dessa secção em loop, `display.startBar`/`barCount` do alphaTab) →
**Remember** (a tab esconde-se, ficam só os quadrados dessa secção) → **Connect** (a partir da 2.ª secção, toca-se
da 1.ª até essa, seguido e sem a tab). A última ligação é a música toda.

- Cada volta do loop conta (3 por secção, 2 ao ligar, 1 na música toda); o botão do passo seguinte acende-se.
- **Peek**: carregar e manter mostra a tab por cima; a volta em que se espreitou não conta.
- No topo, a música em miniatura: um quadrado por compasso, cinzento até a secção se saber de cor e depois com a
  cor da nota; as secções já tocadas seguidas ficam ligadas, com a percentagem da música sabida de cor.
- O passo fica na conta (`user_data`, chave `mapa:learn:<música>`, `{ v: 2, step }`; o formato antigo é convertido).

### Metrónomo exato

O metrónomo e a contagem **não** são tocados a partir dos avisos do alphaTab: esses chegam depois de o som já ter
tocado, em blocos e com alguns ms de irregularidade, e noutro `AudioContext` (com outro relógio). Em vez disso,
`metro-inject.ts` soma o som aos blocos de áudio que o sintetizador envia (`output.addSamples`), antes de eles
tocarem, na amostra que `metro-grid.ts` calcula com a mesma regra do alphaTab (grelha de batidas do MIDI e
micro-janelas de 64 amostras). Fica sempre alinhado com a música, mesmo que o áudio engasgue, e só usa nomes
públicos do alphaTab (se não os encontrar, volta ao método antigo). O som "Click" é o do próprio sintetizador.

Para confirmar, compara-se, no mesmo fluxo, o clique do alphaTab (volume 1) com o som do site: coincidem na mesma
amostra em todas as batidas (a velocidades diferentes, com contagem, a meio da música, depois de pausar e em loop).

### alphaTab

A leitura dos ficheiros, a tablatura e o som usam o [alphaTab](https://alphatab.net) (MPL-2.0). É servido como
script clássico a partir de `public/vendor/alphatab` (criado pelo `npm run vendor`, que corre antes do `dev`
e do `build`), porque os workers do leitor reabrem esse mesmo ficheiro. A fonte Bravura (OFL) e o banco de
sons Sonivox (Apache 2.0) vêm no pacote do alphaTab; o script copia também os textos das licenças.

### Fontes

Roboto (todo o texto e títulos) e Roboto Mono (números), ambas OFL, vêm do [Fontsource](https://fontsource.org)
e são servidas pelo próprio site (`src/fonts.ts`, `src/landing.ts`). Para o PDF, `scripts/pdf-fonts.mjs` converte-as em TTF (o jsPDF só aceita TTF). Não há pedidos a servidores de terceiros, o que evita enviar o IP de quem visita à Google.

## Músicas guardadas e tutorial

Tudo fica na conta (Supabase): cada música é um ficheiro no bucket privado `songs` (pasta `<user_id>/`, nome = SHA-256 do
id título | artista | nº de compassos) e uma linha na tabela `songs`; as alterações (secções, notas, instrumento), o progresso,
o passo do Tile by Tile e as preferências ficam na tabela `user_data` (chave → valor). O site guarda tudo em memória enquanto a
página está aberta e envia as alterações a cada 1,5 s (`src/app/user-store.ts`). **No browser só fica a sessão de login.**
Na primeira vez que alguém entra num browser onde uma versão antiga deixou músicas (IndexedDB) ou dados (`localStorage`),
o site passa-os para a conta e apaga-os do browser (`src/app/library.ts`). O tutorial abre sozinho na primeira vez numa
conta (`mapa:tour-visto` em `user_data`) e pode ser revisto no menu "?" ou em Settings.

## Termos, privacidade e licenças

A página `licenses.html` (ligada no rodapé) tem os termos de utilização, a nota de privacidade e as licenças de
todos os componentes de terceiros. Se acrescentares uma dependência que vá para o site, acrescenta-a lá.

O código deste repositório é © 2026 Miguel Santos, todos os direitos reservados (ver `LICENSE`).

## Telemóvel

O site adapta-se a telemóveis e tablets (vertical e horizontal): leitor compacto numa linha (as opções abrem no botão
de ajustes), tablatura com dois compassos por linha, janela do compasso em ecrã inteiro e alvos de toque de 44 px.
Em ecrãs táteis, tocar num quadrado escolhe o compasso sem abrir o teclado; para escrever uma nota usa-se "Add note".
Pode ser adicionado ao ecrã principal (`manifest.webmanifest` e ícones em `public/`).

## Publicação

Cada push para a `main` publica o site no GitHub Pages (`.github/workflows/deploy.yml`), no domínio **https://www.chordtile.com** (DNS na OVH; domínio definido em *Settings → Pages → Custom domain*, com HTTPS obrigatório).
Na primeira vez, ativa em **Settings → Pages → Source: GitHub Actions**.

Cada PR corre os testes, a verificação de tipos e o build (`.github/workflows/ci.yml`).

## Contas e sincronização (Supabase)

Quem cria conta (email e palavra-passe, com "Forgot your password?" por email) pode carregar as suas músicas, que ficam na conta e aparecem em qualquer dispositivo. Sem configuração, o site funciona sem contas (tudo desbloqueado) e a secção de conta não aparece.

1. Cria um projeto em [supabase.com](https://supabase.com) (o plano grátis chega para começar).
2. No **SQL Editor**, corre por ordem os ficheiros de `supabase/migrations/` (001 a 004: músicas, bucket privado, planos, experiência de 7 dias, limite por conta e `user_data`).
3. Em **Authentication → URL Configuration**, põe `https://www.chordtile.com/` em *Site URL* e acrescenta `https://www.chordtile.com/player` e `https://www.chordtile.com/account` e `http://localhost:5173/player.html` em *Redirect URLs*.
4. Põe a *Project URL* e a chave pública (*publishable* ou *anon*) em `.env.production`. Esse ficheiro já tem o projeto do site e é usado no build (`npm run build` e o deploy). Para testar com outro projeto em `npm run dev`, cria um `.env.local` a partir de `.env.example`.

A chave *anon* é pública por natureza; quem protege os dados são as regras RLS do ficheiro SQL (cada pessoa só lê e escreve as suas músicas).

Como funciona "My songs" (`src/app/cloud.ts`):
- carregar uma música envia logo o ficheiro e a linha; abrir uma atualiza a data (para abrir a última em qualquer dispositivo);
- apagar apaga a linha, o ficheiro e os dados dela em `user_data`;
- o limite de músicas é imposto no servidor (`supabase/migrations/004_account_only.sql`): Gratuito 3, Premium sem limite.

## Premium

As regras de cada plano estão em `src/app/plan.ts` (o limite de músicas também no servidor).

| Sem conta | Conta grátis | Premium |
|---|---|---|
| Só a **música de exemplo** (nada fica guardado) | Até **3 músicas** na conta | Músicas ilimitadas na conta |
| Tocar, esquema e tablatura | Velocidade, metrónomo, contagem, notas nos compassos | **Tile by Tile**, **loop** (música, secção, compasso), **play along**, **solo** |
| — | — | **Expandir um compasso**, **PDF do esquema**, **progresso por secção** |

- **Experiência ("reverse trial")**: cada conta nova tem 7 dias de Premium, sem cartão (gatilho em `auth.users`, ver `supabase/migrations/002_entitlements.sql` e `003_trial_7_days.sql`). Depois passa para Free e mantém tudo o que já tinha.
- **Preços** (em `src/app/billing.ts`): 3,99 €/mês, 29 €/ano, 49 € vitalício (preço de fundador).
- **Código**: regras do plano em `src/app/plan.ts`; progresso em `src/app/practice.ts` (testado); pagamentos em `src/app/billing.ts`; função do servidor em `supabase/functions/stripe-webhook`.

### Estado atual (Stripe, conta ChordTile)

Já criado em **modo live** (pagamentos reais): produto *ChordTile Premium* (`prod_VZH1CnBUMOkyDZ`), os 3 preços (`lookup_key`: `premium_monthly` 3,99 €, `premium_yearly` 29 €, `premium_lifetime` 49 €, IVA incluído), os 3 Payment Links (em `.env.production`, com regresso a `https://www.chordtile.com/player?checkout=success`), o portal do cliente e o webhook para a função `stripe-webhook`. Os mesmos objetos existem em **modo de teste** para experimentar. No Supabase (**Edge Functions → Secrets**) os segredos `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` têm de ser os de **live**.

### Ativar os pagamentos (Stripe)

A tabela, as regras e a função `stripe-webhook` já estão no projeto Supabase. Falta a parte da Stripe:

1. Na Stripe, cria um produto **Premium** com 3 preços: 3,99 € mensal, 29 € anual (recorrentes) e 49 € único.
2. Cria um **Payment Link** para cada preço. Em *After payment*, escolhe "Don't show confirmation page" e redireciona para `https://www.chordtile.com/player?checkout=success`. Ativa a recolha de morada/IVA se usares o Stripe Tax.
3. Em **Settings → Billing → Customer portal**, ativa o portal e copia o *link de login*.
4. Põe os 3 links e o do portal em `.env.production` (`VITE_STRIPE_LINK_*` e `VITE_STRIPE_PORTAL_URL`).
5. Em **Developers → Webhooks**, adiciona o endpoint `https://dgxmxzhkbbosiadexayy.supabase.co/functions/v1/stripe-webhook` com os eventos `checkout.session.completed`, `customer.subscription.updated` e `customer.subscription.deleted`.
6. No Supabase, em **Edge Functions → Secrets**, cria `STRIPE_SECRET_KEY` (chave secreta da Stripe, `sk_...` ou uma *restricted key* com leitura de subscrições) e `STRIPE_WEBHOOK_SECRET` (o `whsec_...` do passo 5).

O site junta o id da conta a cada link (`client_reference_id`); a função recebe o pagamento e ativa o Premium dessa conta. Ao voltar do pagamento (`?checkout=success`), o site espera uns segundos até o Premium aparecer.
