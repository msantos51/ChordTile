// Mensagens claras para os erros ao pedir o link de entrada (em vez de "verifica o email" para tudo).

export function signInErrorMessage(e: unknown): string {
  const err = (e ?? {}) as { code?: string; status?: number; name?: string; message?: string };
  if (err.code === 'over_email_send_rate_limit' || err.code === 'over_request_rate_limit' || err.status === 429) {
    return 'Too many sign-in emails were sent recently. Please wait a while and try again.';
  }
  if (err.code === 'email_address_invalid' || err.code === 'validation_failed' || /invalid.*email|email.*invalid/i.test(err.message ?? '')) {
    return 'That email address doesn’t look right. Check it and try again.';
  }
  if (err.name === 'TypeError' || err.name === 'AuthRetryableFetchError' || /fetch|network/i.test(err.message ?? '')) {
    return 'Couldn’t reach the server. Check your connection and try again.';
  }
  return 'Couldn’t send the link. Please try again in a moment.';
}
