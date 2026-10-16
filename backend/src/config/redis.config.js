import { registerAs } from '@nestjs/config';

import { parseEnvironment } from './env.schema.js';

export default registerAs('redis', () => {
  const environment = parseEnvironment(process.env);
  return {
    url: environment.REDIS_URL,
    host: environment.REDIS_HOST,
    port: environment.REDIS_PORT,
    username: environment.REDIS_USERNAME,
    password: environment.REDIS_PASSWORD,
    db: environment.REDIS_DB,
  };
});
