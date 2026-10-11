import { environment } from '../lib/env';
import { createApiClient } from './client';

// Public transport only. Authenticated callers use the provider's session.request.
export const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });
