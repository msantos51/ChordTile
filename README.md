# ChordTile

Plataforma para aprender músicas a partir de ficheiros Guitar Pro. Carregas o ficheiro e o site:

- divide a música pelas **secções** marcadas no ficheiro (Intro, Verso, Refrão…);
- deteta o **tom de cada compasso** e mostra-o num quadrado com a **cor da nota** (convenção Boomwhackers: Dó vermelho … Si rosa);
- mostra a **tablatura** sincronizada e toca a música, com **loop por secção**, velocidade de 25 % a 150 %, metrónomo, contagem e "tocar por cima" (silencia a tua pista) ou "só o meu instrumento" (ouve-se só a tua pista);
- deixa **editar** tudo (tons, nomes, dividir secções) e **exportar o esquema para PDF**;
- **guarda as músicas importadas** neste browser ("My songs") e abre a última ao voltar;
- tem um **tutorial** na primeira visita e uma página **How it works** (`help.html`).

O site está em **inglês**; o código e esta documentação continuam em português.

Os ficheiros são lidos só no browser. Só são enviados para um servidor se a pessoa **iniciar sessão** para sincronizar "My songs" entre dispositivos (opcional, ver abaixo).

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
index.html                 Página inicial (apresentação)
player.html                O leitor: esquema, tablatura e leitor (estrutura e ícones)
licenses.html              Termos, privacidade e licenças
help.html                  Página "How it works" (guia e perguntas frequentes)
public/leitor.html, ajuda.html, licencas.html   Redirecionam os endereços antigos para os novos
src/
  main.ts                  Interface: esquema, tablatura sincronizada, leitor, ajustes
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
    pdf.ts                 Exportar o esquema para PDF (jsPDF, carregado só quando se exporta)
    sync.ts                Atraso do cursor/esquema para compensar a latência do áudio
    theme.ts               Tema claro/escuro (guardado no browser) e cores da tablatura
    audio-unlock.ts        Som no iPhone mesmo com o interruptor de silêncio ligado
    library.ts             "My songs": ficheiros importados guardados no browser (IndexedDB)
    tour.ts                Tutorial da primeira visita (passos e destaques)
tests/                     Testes (Vitest) e ficheiro .gp5 de teste
public/sample.gp5          Música de exemplo do site (gerada com `make-fixture.py --en`)
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

DM Sans (texto), Anton (títulos e logótipo) e Geist Mono (números), todas OFL, vêm do [Fontsource](https://fontsource.org)
e são servidas pelo próprio site (`src/fonts.ts`, `src/landing.ts`). Não há pedidos a servidores de terceiros, o que evita enviar o IP de quem visita à Google.

## Músicas guardadas e tutorial

Cada ficheiro importado é guardado no IndexedDB do browser (base `mapa-de-compassos`, identificado por
título | artista | nº de compassos), junto com as correções que já ficavam no `localStorage`. Nada vai para um
servidor. O tutorial aparece só na primeira visita (`mapa:tour-visto`) e pode ser revisto no menu "?".

## Termos, privacidade e licenças

A página `licenses.html` (ligada no rodapé) tem os termos de utilização, a nota de privacidade e as licenças de
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

## Contas e sincronização (Supabase)

Quem inicia sessão (link mágico por email, sem palavra-passe) tem "My songs" em todos os dispositivos. É a base para a futura versão Premium. Sem configuração, o site funciona como antes e a secção de conta não aparece.

1. Cria um projeto em [supabase.com](https://supabase.com) (o plano grátis chega para começar).
2. No **SQL Editor**, corre `supabase/migrations/001_songs.sql` (tabela `songs`, bucket privado `songs` e regras de acesso por utilizador).
3. Em **Authentication → URL Configuration**, põe o endereço do site em *Site URL* e acrescenta `https://<utilizador>.github.io/learnfast/player.html` e `http://localhost:5173/player.html` em *Redirect URLs*.
4. Põe a *Project URL* e a chave pública (*publishable* ou *anon*) em `.env.production`. Esse ficheiro já tem o projeto do site e é usado no build (`npm run build` e o deploy). Para testar com outro projeto em `npm run dev`, cria um `.env.local` a partir de `.env.example`.

A chave *anon* é pública por natureza; quem protege os dados são as regras RLS do ficheiro SQL (cada pessoa só lê e escreve as suas músicas).

Como funciona a sincronização (`src/app/cloud.ts`, plano em `src/app/cloud-plan.ts`, testado):
- ao iniciar sessão, ao voltar ao separador e em "Sync now", junta as duas bibliotecas: o que falta de cada lado passa para o outro;
- importar uma música envia-a logo; apagar marca-a como apagada na conta, e os outros dispositivos apagam-na também;
- uma música reimportada depois de apagada volta para a conta.

## Premium

Praticar é sempre grátis. O Premium é para quem quer guardar e acompanhar o que pratica.

| Free | Premium |
|---|---|
| Abrir qualquer ficheiro, esquema, tablatura, loop, velocidade | Tudo o do Free |
| Guardar até **3 músicas** em "My songs" (as seguintes abrem, mas não ficam guardadas) | Músicas ilimitadas |
| — | **Sincronização** entre dispositivos (também imposta no servidor, nas regras RLS) |
| — | **Treino de velocidade**: começa devagar e sobe a cada volta do loop (Ajustes → Speed trainer) |
| Progresso registado, mas escondido | **Progresso por secção**: tempo, melhor velocidade, "Mastered" (3 voltas a 100 %) |
| PDF com marca de água | PDF limpo |

- **Experiência ("reverse trial")**: cada conta nova tem 14 dias de Premium, sem cartão (gatilho em `auth.users`, ver `supabase/migrations/002_entitlements.sql`). Depois passa para Free e mantém tudo o que já tinha.
- **Preços** (em `src/app/billing.ts`): 3,99 €/mês, 29 €/ano, 49 € vitalício (preço de fundador).
- **Código**: regras do plano em `src/app/plan.ts`; treino e progresso em `src/app/practice.ts` (ambos testados); pagamentos em `src/app/billing.ts`; função do servidor em `supabase/functions/stripe-webhook`.

### Estado atual (Stripe, conta ChordTile)

Já criado em **modo de teste**: produto *ChordTile Premium* (`prod_VYmkdXicLzFWxf`), os 3 preços (`lookup_key`: `premium_monthly`, `premium_yearly`, `premium_lifetime`, IVA incluído), os 3 Payment Links (em `.env.production`), o portal do cliente e o webhook para a função `stripe-webhook`. Falta criar no Supabase os segredos `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET`. Para passar a live, repetir estes objetos com a conta ativada e trocar os links.

### Ativar os pagamentos (Stripe)

A tabela, as regras e a função `stripe-webhook` já estão no projeto Supabase. Falta a parte da Stripe:

1. Na Stripe, cria um produto **Premium** com 3 preços: 3,99 € mensal, 29 € anual (recorrentes) e 49 € único.
2. Cria um **Payment Link** para cada preço. Em *After payment*, escolhe "Don't show confirmation page" e redireciona para `https://msantos51.github.io/learnfast/player.html?checkout=success`. Ativa a recolha de morada/IVA se usares o Stripe Tax.
3. Em **Settings → Billing → Customer portal**, ativa o portal e copia o *link de login*.
4. Põe os 3 links e o do portal em `.env.production` (`VITE_STRIPE_LINK_*` e `VITE_STRIPE_PORTAL_URL`).
5. Em **Developers → Webhooks**, adiciona o endpoint `https://dgxmxzhkbbosiadexayy.supabase.co/functions/v1/stripe-webhook` com os eventos `checkout.session.completed`, `customer.subscription.updated` e `customer.subscription.deleted`.
6. No Supabase, em **Edge Functions → Secrets**, cria `STRIPE_SECRET_KEY` (chave secreta da Stripe, `sk_...` ou uma *restricted key* com leitura de subscrições) e `STRIPE_WEBHOOK_SECRET` (o `whsec_...` do passo 5).

O site junta o id da conta a cada link (`client_reference_id`); a função recebe o pagamento e ativa o Premium dessa conta. Ao voltar do pagamento (`?checkout=success`), o site espera uns segundos até o Premium aparecer.
