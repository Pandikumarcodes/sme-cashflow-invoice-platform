import { Global, Module } from '@nestjs/common';
import { RequestContextStore } from './request-context.store.js';
@Global()
@Module({ providers: [RequestContextStore], exports: [RequestContextStore] })
export class RequestContextModule {}
