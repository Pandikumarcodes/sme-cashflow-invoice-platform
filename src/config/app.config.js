import { registerAs } from '@nestjs/config';
import { parseEnvironment } from './env.schema.js';
export default registerAs('app', () => {
  const environment = parseEnvironment(process.env);
  return {
    nodeEnv: environment.NODE_ENV,
    port: environment.PORT,
    apiPrefix: environment.API_PREFIX,
    apiVersion: environment.API_VERSION,
    corsOrigins: environment.CORS_ORIGINS,
    trustProxy: environment.TRUST_PROXY,
  };
});
