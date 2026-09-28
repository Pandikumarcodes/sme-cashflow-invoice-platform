import { registerAs } from '@nestjs/config';

import { parseEnvironment } from './env.schema.js';

export default registerAs('queue', () => {
  const environment = parseEnvironment(process.env);
  return { prefix: environment.QUEUE_PREFIX };
});
