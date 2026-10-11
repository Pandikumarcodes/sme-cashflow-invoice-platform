import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
@Injectable()
export class RequestContextStore {
  storage = new AsyncLocalStorage();
  run(metadata, callback) {
    return this.storage.run(metadata, callback);
  }
  get() {
    return this.storage.getStore();
  }
}
