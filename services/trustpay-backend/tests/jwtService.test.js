const jwtService = require('../src/services/jwtService');

describe('jwtService', () => {
  const user = { id: 'user-1', phoneNumber: '+2348011111111', kycTier: 1 };

  test('mints a token that verifies back to the same claims', () => {
    const token = jwtService.mintToken(user);
    const payload = jwtService.verifyToken(token);
    expect(payload.sub).toBe(user.id);
    expect(payload.phone).toBe(user.phoneNumber);
    expect(payload.kycTier).toBe(user.kycTier);
  });

  test('rejects a tampered token', () => {
    const token = jwtService.mintToken(user);
    const tampered = token.slice(0, -2) + (token.slice(-2) === 'aa' ? 'bb' : 'aa');
    expect(() => jwtService.verifyToken(tampered)).toThrow();
  });

  test('rejects a token signed with a different secret', () => {
    const jwt = require('jsonwebtoken');
    const foreignToken = jwt.sign({ sub: 'user-1' }, 'a-different-secret');
    expect(() => jwtService.verifyToken(foreignToken)).toThrow();
  });
});
