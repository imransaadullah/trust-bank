const { SelfIssuedNubanProvider, computeNubanCheckDigit } = require('../src/providers/selfIssuedNuban');

describe('computeNubanCheckDigit', () => {
  test("matches the CBN circular's own worked example (First Bank, code 011)", () => {
    expect(computeNubanCheckDigit('011', '000000022')).toBe(0);
  });

  test('rejects a bank code that is not exactly 3 digits', () => {
    expect(() => computeNubanCheckDigit('11', '000000022')).toThrow('bankCode');
    expect(() => computeNubanCheckDigit('0011', '000000022')).toThrow('bankCode');
  });

  test('rejects a serial that is not exactly 9 digits', () => {
    expect(() => computeNubanCheckDigit('011', '22')).toThrow('serial');
  });

  test('is deterministic for the same input', () => {
    expect(computeNubanCheckDigit('058', '123456789')).toBe(computeNubanCheckDigit('058', '123456789'));
  });
});

describe('SelfIssuedNubanProvider.provisionAccount', () => {
  test('returns a 10-digit account number whose check digit is independently verifiable', async () => {
    const provider = new SelfIssuedNubanProvider({ bankCode: '011', bankName: 'Test MFB' });
    const result = await provider.provisionAccount({ externalCustomerId: 'customer-1' });
    expect(result.accountNumber).toMatch(/^\d{10}$/);
    const serial = result.accountNumber.slice(0, 9);
    const checkDigit = Number(result.accountNumber.slice(9));
    expect(checkDigit).toBe(computeNubanCheckDigit('011', serial));
    expect(result.bankCode).toBe('011');
    expect(result.bankName).toBe('Test MFB');
  });

  test('is deterministic — the same customer always gets the same account number', async () => {
    const provider = new SelfIssuedNubanProvider({ bankCode: '011' });
    const first = await provider.provisionAccount({ externalCustomerId: 'customer-2' });
    const second = await provider.provisionAccount({ externalCustomerId: 'customer-2' });
    expect(first.accountNumber).toBe(second.accountNumber);
  });

  test('different customers get different account numbers', async () => {
    const provider = new SelfIssuedNubanProvider({ bankCode: '011' });
    const a = await provider.provisionAccount({ externalCustomerId: 'customer-a' });
    const b = await provider.provisionAccount({ externalCustomerId: 'customer-b' });
    expect(a.accountNumber).not.toBe(b.accountNumber);
  });

  test('throws clearly if no bank code is configured for the tenant', async () => {
    const provider = new SelfIssuedNubanProvider({});
    await expect(provider.provisionAccount({ externalCustomerId: 'x' })).rejects.toThrow('bankCode');
  });

  test('every other contract method still rejects as not-implemented', async () => {
    const provider = new SelfIssuedNubanProvider({ bankCode: '011' });
    await expect(provider.verifyIdentity({})).rejects.toThrow('does not implement');
    await expect(provider.initiateOutbound({})).rejects.toThrow('does not implement');
    await expect(provider.getBankList()).rejects.toThrow('does not implement');
  });
});
