import { describe, expect, it } from 'vitest';
import { signInErrorMessage } from '../src/app/auth-errors';

describe('erros ao pedir o link de entrada', () => {
  it('limite de emails: pede para esperar (não para verificar o endereço)', () => {
    expect(signInErrorMessage({ code: 'over_email_send_rate_limit', status: 429 })).toMatch(/wait/);
    expect(signInErrorMessage({ status: 429 })).toMatch(/wait/);
  });
  it('endereço inválido, sem rede e outros', () => {
    expect(signInErrorMessage({ code: 'email_address_invalid' })).toMatch(/email address/);
    expect(signInErrorMessage({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toMatch(/connection/);
    expect(signInErrorMessage(null)).toMatch(/try again/);
  });
});
