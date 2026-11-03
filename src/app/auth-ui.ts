// Janela de conta: "Sign in", "Create account" e "Forgot password", igual no leitor e na página
// da conta. Desenha o formulário dentro de um contentor; `openAuthDialog` mostra-o numa janela.

import { authErrorMessage, passwordProblem } from './auth-errors';
import { sendPasswordReset, signIn, signUp } from './cloud';

export type AuthMode = 'signin' | 'signup' | 'reset';

const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

/** Desenha o formulário de conta em `box`. `done` é chamado quando a pessoa entra. */
export function mountAuth(box: HTMLElement, mode: AuthMode, opts: { message?: string; done?: () => void } = {}): void {
  const titles: Record<AuthMode, string> = { signin: 'Sign in', signup: 'Create your free account', reset: 'Reset your password' };
  const subs: Record<AuthMode, string> = {
    signin: 'Welcome back. Your songs and plan are waiting.',
    signup: 'Keep up to 3 songs and unlock all practice tools. Includes 14 days of Premium, no card needed.',
    reset: 'We’ll email you a link to choose a new password.',
  };
  box.innerHTML = `
    <form class="auth" novalidate>
      <h2 class="auth-title">${titles[mode]}</h2>
      ${opts.message ? `<p class="auth-why">${opts.message}</p>` : ''}
      <p class="auth-sub">${subs[mode]}</p>
      ${mode === 'signup' ? '<label class="auth-field"><span>Name</span><input name="name" autocomplete="name" maxlength="60" placeholder="Your name"></label>' : ''}
      <label class="auth-field"><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
      ${mode !== 'reset' ? `<label class="auth-field"><span>Password</span><span class="auth-pw"><input name="password" type="password" required minlength="8"
        autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="${mode === 'signup' ? 'At least 8 characters, with a number' : 'Your password'}">
        <button type="button" class="auth-eye" aria-label="Show password">${EYE}</button></span></label>` : ''}
      ${mode === 'signin' ? '<button type="button" class="auth-link auth-forgot" data-go="reset">Forgot your password?</button>' : ''}
      <p class="auth-err" role="alert" hidden></p>
      <p class="auth-ok" role="status" hidden></p>
      <button type="submit" class="btn primary auth-submit">${mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}</button>
      <p class="auth-switch">${mode === 'signin' ? 'New to ChordTile? <button type="button" class="auth-link" data-go="signup">Create a free account</button>'
        : 'Already have an account? <button type="button" class="auth-link" data-go="signin">Sign in</button>'}</p>
      ${mode === 'signup' ? '<p class="auth-fine">By creating an account you accept the <a href="./licenses.html">terms and privacy policy</a>.</p>' : ''}
    </form>`;
  const form = box.querySelector('form')!;
  const field = (n: string) => form.querySelector<HTMLInputElement>(`[name="${n}"]`);
  const err = form.querySelector<HTMLElement>('.auth-err')!, ok = form.querySelector<HTMLElement>('.auth-ok')!;
  const submit = form.querySelector<HTMLButtonElement>('.auth-submit')!;
  const show = (el: HTMLElement, t: string) => { el.textContent = t; el.hidden = !t; };
  form.querySelectorAll<HTMLButtonElement>('[data-go]').forEach(b => b.addEventListener('click', () => {
    const email = field('email')?.value ?? '';
    mountAuth(box, b.dataset.go as AuthMode, { ...opts, message: undefined });
    const e2 = box.querySelector<HTMLInputElement>('[name="email"]'); if (e2) { e2.value = email; e2.focus(); }
  }));
  form.querySelector('.auth-eye')?.addEventListener('click', e => {
    const pw = field('password')!, b = e.currentTarget as HTMLButtonElement;
    pw.type = pw.type === 'password' ? 'text' : 'password';
    b.setAttribute('aria-label', pw.type === 'password' ? 'Show password' : 'Hide password');
  });
  form.addEventListener('submit', async e => {
    e.preventDefault(); show(err, ''); show(ok, '');
    const email = (field('email')?.value ?? '').trim(), pw = field('password')?.value ?? '';
    if (!/^\S+@\S+\.\S+$/.test(email)) { show(err, 'Enter a valid email address.'); field('email')?.focus(); return; }
    if (mode === 'signup') { const p = passwordProblem(pw); if (p) { show(err, p); field('password')?.focus(); return; } }
    if (mode === 'signin' && !pw) { show(err, 'Enter your password.'); field('password')?.focus(); return; }
    submit.disabled = true; const label = submit.textContent; submit.textContent = 'Please wait…';
    try {
      if (mode === 'signin') { await signIn(email, pw); opts.done?.(); }
      else if (mode === 'signup') {
        const { needsConfirm } = await signUp(email, pw, (field('name')?.value ?? '').trim());
        if (needsConfirm) show(ok, 'Almost there! We sent a confirmation link to ' + email + '. Open it to start using your account (check the spam folder too).');
        else opts.done?.();
      } else { await sendPasswordReset(email); show(ok, 'If there’s an account for ' + email + ', a reset link is on its way. Check your inbox (and spam).'); }
    } catch (x) { show(err, authErrorMessage(x)); }
    finally { submit.disabled = false; submit.textContent = label; }
  });
}

let dlg: HTMLDialogElement | null = null;
/** Mostra a janela de conta por cima da página. */
export function openAuthDialog(mode: AuthMode, message?: string, done?: () => void): void {
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.className = 'auth-dialog';
    dlg.innerHTML = '<button type="button" class="ibtn auth-close" aria-label="Close">✕</button><div class="auth-box"></div>';
    document.body.append(dlg);
    dlg.querySelector('.auth-close')!.addEventListener('click', () => dlg!.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg!.close(); });
  }
  mountAuth(dlg.querySelector<HTMLElement>('.auth-box')!, mode, { message, done: () => { dlg!.close(); done?.(); } });
  dlg.showModal();
  dlg.querySelector<HTMLInputElement>('input')?.focus();
}
