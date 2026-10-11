import { EmailProvider } from './email-provider.js';
describe('provider-gated development email capture', () => {
  it('does not send or claim delivery when disabled', async () => {
    const provider = new EmailProvider({ getOrThrow: () => ({ emailProvider: 'disabled' }) });
    expect(await provider.send({ idempotencyKey: 'delivery-id' })).toEqual({
      outcome: 'SUPPRESSED',
      code: 'EMAIL_DISABLED',
    });
    expect(provider.messages.size).toBe(0);
  });
  it('captures one message per provider key without logging contents', async () => {
    const provider = new EmailProvider({ getOrThrow: () => ({ emailProvider: 'capture' }) });
    const message = {
      idempotencyKey: 'delivery-id',
      to: 'test@example.com',
      body: 'Private content',
    };
    expect(await provider.send(message)).toEqual(await provider.send(message));
    expect(provider.messages.size).toBe(1);
  });
});
