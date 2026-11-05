// Página da conta: entrar/criar conta, perfil, plano, segurança e apagar conta.
import './fonts';
import './app/input-mode';
import './styles.css';
import { mountAuth } from './app/auth-ui';
import { authErrorMessage, passwordProblem } from './app/auth-errors';
import { portalUrl } from './app/billing';
import { cloudEnabled, deleteAccount, fetchEntitlement, signOut, updateEmail, updateName, updatePassword, watchAccount, type Account } from './app/cloud';
import { FREE_SONG_LIMIT, daysLeft, planLabel, planState } from './app/plan';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
let timer: ReturnType<typeof setTimeout> | undefined;
function toast(t: string) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(timer); timer = setTimeout(() => (el.hidden = true), 3200); }
const show = (id: string, v: boolean) => { $(id).hidden = !v; };
const wantReset = new URLSearchParams(location.search).has('reset');

async function render(a: Account | null, recovery = false) {
  show('accLoading', false);
  if (recovery || (wantReset && a)) { show('accReset', true); show('accOn', false); show('accAuth', false); input('resetPw').focus(); return; }
  show('accReset', false);
  if (!a) {
    show('accOn', false); show('accAuth', true);
    mountAuth($('accAuth'), new URLSearchParams(location.search).has('signup') ? 'signup' : 'signin', { heading: 'h1', done: () => toast('You’re signed in. Welcome!') });
    return;
  }
  show('accAuth', false); show('accOn', true);
  $('accEmailTop').textContent = a.email; $('accEmail').textContent = a.email;
  if (document.activeElement !== input('accName')) input('accName').value = a.name;
  // Plano
  try {
    const p = planState(await fetchEntitlement());
    const badge = $('accPlanBadge'); badge.textContent = planLabel(p); badge.classList.toggle('premium', p.premium);
    const paid = p.kind === 'monthly' || p.kind === 'yearly' || p.kind === 'lifetime';
    $('accPlanInfo').textContent =
      p.kind === 'trial' ? 'Your free Premium trial ends in ' + daysLeft(p.until!) + ' days. After that you keep the free plan.'
        : p.kind === 'lifetime' ? 'Premium forever. Thank you!'
          : paid ? 'Renews or ends on ' + new Date(p.until!).toLocaleDateString() + '.'
            : 'Free plan.';
    $('accFeats').innerHTML = (p.premium
      ? ['Unlimited songs', 'Tile by Tile: learn songs by heart', 'Loop, play along and solo', 'Expand any bar up close', 'PDF charts', 'Progress per section', 'Songs kept in your account, on every device']
      : ['Up to ' + FREE_SONG_LIMIT + ' songs, saved on this device', 'Speed, metronome and count-in', 'Notes on the bars', '🔒 Tile by Tile, loop, play along, solo, expand, PDF, progress and songs in your account are Premium'])
      .map(t => '<li>' + t + '</li>').join('');
    show('accUpgrade', !paid);
    $('accUpgrade').textContent = p.kind === 'trial' ? 'Keep Premium' : 'Go Premium';
    const manage = paid && p.kind !== 'lifetime' && !!portalUrl;
    show('accManage', manage); if (manage) $<HTMLAnchorElement>('accManage').href = portalUrl!;
  } catch { $('accPlanInfo').textContent = 'Couldn’t load your plan. Check your connection.'; }
}

if (!cloudEnabled) { show('accLoading', false); $('accLoading').hidden = false; $('accLoading').textContent = 'Accounts are not available on this copy of the site.'; }
else watchAccount((a, recovery) => { void render(a, recovery); }).catch(() => { $('accLoading').textContent = 'Couldn’t reach the server. Check your connection and reload.'; });

async function run(btn: HTMLButtonElement | null, fn: () => Promise<void>, ok: string) {
  if (btn) btn.disabled = true;
  try { await fn(); toast(ok); } catch (e) { toast(authErrorMessage(e)); } finally { if (btn) btn.disabled = false; }
}
const submitBtn = (f: HTMLFormElement) => f.querySelector<HTMLButtonElement>('button[type="submit"]');

$<HTMLFormElement>('nameForm').addEventListener('submit', e => { e.preventDefault(); void run(submitBtn(e.target as HTMLFormElement), () => updateName(input('accName').value.trim()), 'Name saved.'); });
$<HTMLFormElement>('pwForm').addEventListener('submit', e => {
  e.preventDefault(); const pw = input('newPw').value, p = passwordProblem(pw);
  if (p) { toast(p); return; }
  void run(submitBtn(e.target as HTMLFormElement), async () => { await updatePassword(pw); input('newPw').value = ''; }, 'Password changed.');
});
$<HTMLFormElement>('emailForm').addEventListener('submit', e => {
  e.preventDefault(); const em = input('newEmail').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(em)) { toast('Enter a valid email address.'); return; }
  void run(submitBtn(e.target as HTMLFormElement), () => updateEmail(em), 'Check both inboxes: confirm the change with the link we sent.');
});
$<HTMLFormElement>('resetForm').addEventListener('submit', async e => {
  e.preventDefault(); const pw = input('resetPw').value, p = passwordProblem(pw), err = $('resetErr');
  err.hidden = !p; err.textContent = p; if (p) return;
  try { await updatePassword(pw); history.replaceState(null, '', location.pathname); toast('New password saved. You’re signed in.'); show('accReset', false); location.reload(); }
  catch (x) { err.hidden = false; err.textContent = authErrorMessage(x); }
});
$('signOutHere').addEventListener('click', () => void run(null, () => signOut(false), 'Signed out.'));
$('signOutAll').addEventListener('click', () => void run(null, () => signOut(true), 'Signed out on all devices.'));
input('delConfirm').addEventListener('input', () => { $<HTMLButtonElement>('delBtn').disabled = input('delConfirm').value.trim() !== 'DELETE'; });
$<HTMLFormElement>('delForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (input('delConfirm').value.trim() !== 'DELETE') return;
  const b = $<HTMLButtonElement>('delBtn'); b.disabled = true; b.textContent = 'Deleting…';
  try { await deleteAccount(); toast('Your account was deleted.'); setTimeout(() => { location.href = './'; }, 1500); }
  catch (x) { toast(authErrorMessage(x)); b.disabled = false; b.textContent = 'Delete my account'; }
});
