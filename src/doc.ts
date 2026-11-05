// Páginas de ajuda, termos, privacidade e licenças: estilos, fontes e o link da conta no cabeçalho.
import './fonts';
import './app/input-mode';
import './styles.css';
import { accountsEnabled, storedAccount } from './app/session-hint';

// Cabeçalho: "Your account" com sessão iniciada, "Sign in" sem sessão; escondido se o site não tiver contas
const docAccount = document.getElementById('docAccount');
if (docAccount) {
  if (!accountsEnabled) docAccount.hidden = true;
  else if (storedAccount()) docAccount.textContent = 'Your account';
}

// Tema escolhido (guardado na conta, não no browser): só se carrega a conta se houver sessão
if (accountsEnabled && storedAccount()) {
  void import('./app/cloud').then(c => c.loadUserData()).then(d => {
    if (d['mapa:theme'] === 'light') document.documentElement.dataset.theme = 'light';
  }).catch(() => { /* sem rede: fica o tema escuro */ });
}
