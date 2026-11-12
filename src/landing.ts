// Página inicial (estática): apresenta o problema, o método Tile by Tile e o leitor. Não guarda nada no browser:
// "Pick a song to learn" leva ao leitor, onde a música é carregada e guardada na conta (sem conta, pede primeiro para criar uma grátis).
import './fonts';
import './landing.css';
import { accountsEnabled, storedAccount } from './app/session-hint';

// Menu de cima (ícone da conta): com sessão iniciada, "Your account" em vez de "Sign in"; sem contas (cópia local), nada
const navAccount = document.getElementById('navAccount') as HTMLAnchorElement;
if (!accountsEnabled) navAccount.hidden = true;
else if (storedAccount()) { navAccount.setAttribute('aria-label', 'Your account'); navAccount.title = 'Your account'; }

/** Para onde vai quem quer carregar uma música: o leitor ("My songs"), ou criar conta primeiro. */
const loadUrl = () => (accountsEnabled && !storedAccount() ? '/player?signup' : '/player?load');
document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach(b => b.addEventListener('click', () => { location.href = loadUrl(); }));
