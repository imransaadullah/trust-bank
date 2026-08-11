const crypto = require('crypto');
const { PaystackProvider } = require('../src/providers/paystack');

function sign(secret, rawBody) {
  return crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
}

describe('PaystackProvider webhook signature verification', () => {
  const secret = 'test-webhook-secret';
  const provider = new PaystackProvider({ secretKey: 'sk_test_x', webhookSecret: secret });

  test('accepts a correctly signed payload', () => {
    const rawBody = JSON.stringify({ event: 'charge.success', data: { reference: 'ref-1' } });
    const signature = sign(secret, rawBody);
    expect(provider.verifyWebhookSignature(rawBody, signature)).toBe(true);
  });

  test('rejects a tampered payload', () => {
    const rawBody = JSON.stringify({ event: 'charge.success', data: { reference: 'ref-1' } });
    const signature = sign(secret, rawBody);
    const tampered = JSON.stringify({ event: 'charge.success', data: { reference: 'ref-2' } });
    expect(provider.verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  test('rejects a missing signature', () => {
    expect(provider.verifyWebhookSignature('{}', undefined)).toBe(false);
  });

  test('rejects a signature of the wrong length without throwing', () => {
    expect(provider.verifyWebhookSignature('{}', 'short')).toBe(false);
  });
});

describe('PaystackProvider.parseWebhookEvent', () => {
  const provider = new PaystackProvider({ secretKey: 'sk_test_x' });

  test('maps charge.success to a deposit event, amount passed through in kobo', () => {
    const eventBody = {
      event: 'charge.success',
      data: {
        reference: 'trx_123',
        amount: 500000,
        authorization: { dedicated_account: { account_number: '1234567890' } },
      },
    };
    const event = provider.parseWebhookEvent(eventBody);
    expect(event).toMatchObject({
      type: 'deposit', accountNumber: '1234567890', amount: 500000, providerRef: 'trx_123',
    });
  });

  test('maps transfer.success to withdrawal_success', () => {
    const event = provider.parseWebhookEvent({
      event: 'transfer.success', data: { reference: 'trf_1', amount: 10000 },
    });
    expect(event).toMatchObject({ type: 'withdrawal_success', providerRef: 'trf_1', amount: 10000 });
  });

  test('maps transfer.failed to withdrawal_failed with a reason', () => {
    const event = provider.parseWebhookEvent({
      event: 'transfer.failed', data: { reference: 'trf_2', amount: 5000, reason: 'Insufficient pool balance' },
    });
    expect(event).toMatchObject({ type: 'withdrawal_failed', providerRef: 'trf_2', failureReason: 'Insufficient pool balance' });
  });

  test('maps an unrecognized event to unknown', () => {
    const event = provider.parseWebhookEvent({ event: 'customer.created', data: {} });
    expect(event.type).toBe('unknown');
  });
});
