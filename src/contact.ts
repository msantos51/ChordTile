// Página de contacto: envia o formulário para a função `contact` do servidor (sem carregar o
// cliente do Supabase). Com sessão iniciada, o nome e o email já vêm preenchidos.
import './doc';
import { storedAccount } from './app/session-hint';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('contactForm');
const name = $<HTMLInputElement>('cName'), email = $<HTMLInputElement>('cEmail');
const topic = $<HTMLSelectElement>('cTopic'), message = $<HTMLTextAreaElement>('cMessage');
const send = $<HTMLButtonElement>('cSend'), status = $('cStatus');

const acc = storedAccount();
if (acc) { name.value = acc.name; email.value = acc.email; }
const wanted = new URLSearchParams(location.search).get('topic');
if (wanted && [...topic.options].some(o => o.value === wanted)) topic.value = wanted;

/** Token da sessão guardada (para a mensagem ficar ligada à conta); sem sessão, nada. */
function accessToken(): string | null {
  try {
    const ref = new URL(URL_!).hostname.split('.')[0];
    return (JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) ?? 'null') as { access_token?: string } | null)?.access_token ?? null;
  } catch { return null; }
}

function say(text: string, kind: 'ok' | 'err' | '' = '') {
  status.textContent = text; status.className = 'contact-status' + (kind ? ' ' + kind : '');
}

function check(): string | null {
  if (!name.value.trim()) { name.focus(); return 'Please write your name.'; }
  if (!email.validity.valid || !email.value.trim()) { email.focus(); return 'Please check your email address.'; }
  if (message.value.trim().length < 10) { message.focus(); return 'Please write a little more (at least 10 characters).'; }
  return null;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const problem = check();
  if (problem) return say(problem, 'err');
  if (!URL_ || !KEY) return say('The contact form is not available right now.', 'err');
  send.disabled = true; say('Sending…');
  try {
    const token = accessToken();
    const r = await fetch(URL_ + '/functions/v1/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + (token ?? KEY) },
      body: JSON.stringify({ name: name.value, email: email.value, topic: topic.value, message: message.value, website: (form.elements.namedItem('website') as HTMLInputElement).value }),
    });
    const res = await r.json().catch(() => ({})) as { sent?: boolean; error?: string };
    if (!r.ok || !res.sent) throw new Error(res.error || 'Could not send the message. Please try again.');
    message.value = '';
    say('Thank you! Your message was sent. We will reply to ' + email.value.trim() + '.', 'ok');
  } catch (err) {
    say(err instanceof TypeError ? 'No connection. Check your internet and try again.' : (err as Error).message, 'err');
  } finally {
    send.disabled = false;
  }
});
