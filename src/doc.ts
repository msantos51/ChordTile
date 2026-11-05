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
