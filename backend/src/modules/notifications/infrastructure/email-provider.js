import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Provider boundary: a future real adapter MUST honor this durable idempotency
// key across timeouts/restarts. Capture is explicitly not an external delivery.
@Injectable()
export class EmailProvider {
  messages = new Map();
  constructor(config) {
    this.mode = config.getOrThrow('notification').emailProvider;
  }
  async send(message) {
    if (this.mode !== 'capture') return { outcome: 'SUPPRESSED', code: 'EMAIL_DISABLED' };
    if (!this.messages.has(message.idempotencyKey)) {
      if (this.messages.size >= 1000) this.messages.delete(this.messages.keys().next().value);
      this.messages.set(message.idempotencyKey, { ...message });
    }
    return { outcome: 'SENT', providerMessageId: `capture-${message.idempotencyKey}` };
  }
}
Inject(ConfigService)(EmailProvider, undefined, 0);
