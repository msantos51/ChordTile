// Mensagens claras para os erros de conta (entrar, criar conta, palavra-passe, email).

type AuthErr = { code?: string; status?: number; name?: string; message?: string };

export function authErrorMessage(e: unknown): string {
  const err = (e ?? {}) as AuthErr, msg = err.message ?? '';
  const code = err.code ?? '';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || err.status === 429) {
    return 'Too many attempts or emails in a short time. Please wait a while and try again.';
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'Please confirm your email first: open the link we sent you.';
  if (code === 'user_already_exists' || /already registered/i.test(msg)) return 'There’s already an account with this email. Sign in instead (or reset your password).';
  if (code === 'weak_password' || /password should be/i.test(msg)) return 'Choose a stronger password: at least 8 characters.';
  if (code === 'same_password') return 'The new password must be different from the current one.';
  if (code === 'email_address_invalid' || code === 'validation_failed' || /invalid.*email|email.*invalid/i.test(msg)) {
    return 'That email address doesn’t look right. Check it and try again.';
  }
  if (err.name === 'TypeError' || err.name === 'AuthRetryableFetchError' || /fetch|network/i.test(msg)) {
    return 'Couldn’t reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again in a moment.';
}

/** Mantido para o resto do código (e testes): o mesmo mapeamento. */
export const signInErrorMessage = authErrorMessage;

/** Regras da palavra-passe (também verificadas no servidor). Vazio = válida. */
export function passwordProblem(pw: string): string {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letters and at least one number.';
  return '';
}
