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

import { authErrorMessage, passwordProblem } from '../src/app/auth-errors';

describe('erros de conta e palavra-passe', () => {
  it('mensagens certas para cada caso', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('Wrong email or password.');
    expect(authErrorMessage({ code: 'email_not_confirmed' })).toMatch(/confirm your email/);
    expect(authErrorMessage({ code: 'user_already_exists' })).toMatch(/Sign in instead/);
    expect(authErrorMessage({ code: 'weak_password' })).toMatch(/8 characters/);
  });
  it('palavra-passe: 8+ caracteres, letras e um número', () => {
    expect(passwordProblem('abc1')).toMatch(/8/);
    expect(passwordProblem('abcdefgh')).toMatch(/number/);
    expect(passwordProblem('guitar2026')).toBe('');
  });
});
