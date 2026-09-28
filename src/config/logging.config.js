import { registerAs } from '@nestjs/config';
import { parseEnvironment } from './env.schema.js';
export default registerAs('logging', () => ({ level: parseEnvironment(process.env).LOG_LEVEL }));
