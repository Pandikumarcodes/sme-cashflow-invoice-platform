# Frontend foundation

React, TypeScript and Vite application for the SME Cash Flow platform. The foundation now includes authentication, session recovery and accessible login/registration forms. Business modules and organization navigation remain deferred.

## Local development

Use Node 22.22.2+, 24.15.0+, or 26+ (supported even-numbered releases). The installed test tooling sets this requirement above [Vite's minimum](https://vite.dev/guide/). From `frontend/`:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173`. Run the backend separately from `backend/` using the [backend README](../backend/README.md). Frontend commands still run from `frontend/`. The only required public setting is `VITE_API_BASE_URL`, defaulting in the example to `http://localhost:3000/api/v1`. Configuration rejects missing values, other API paths, embedded credentials, query strings and fragments. Vite variables are public build inputs; never put secrets in them. Supply the deployed API URL at build time.

The backend allows this development origin and credentialed requests. Use `localhost` consistently for both apps. The backend owns its host-only HttpOnly refresh cookie, scoped to `/api/v1/auth`, with SameSite=Lax and Secure in production. Production requires HTTPS and an explicitly approved origin. No security settings or CORS policies are weakened by this frontend. Preview runs on port 4173 and requires its own approved backend origin if API calls are made there.

## Checks

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

MSW runs only in Vitest's Node test environment. Tests require no backend, PostgreSQL or Redis. There is no browser service worker or production mock.

## Contracts and extension points

`src/api/client.ts` accepts resource paths such as `/health`, relative to the configured `/api/v1` root. Responses retain their complete body, status, headers and request ID; `{data}` and `{data,meta}` envelopes are not unwrapped. Decimal strings, business date strings and opaque cursor metadata are preserved.

```ts
const client = createApiClient({
  baseUrl: environment.apiBaseUrl,
  getAccessToken: () => currentMemoryToken,
});
const response = await client.request('/resource', {
  method: 'PATCH',
  body: { description: 'Updated' },
  ifMatch: '"3"',
  signal,
});
```

The low-level transport accepts an accessor evaluated on each request. Authenticated callers use `useAuth().session.request`, which wraps it with bounded session recovery. `apiClient` remains public transport. Requests include credentials; omitted bodies stay absent and explicit `{}` bodies use JSON Content-Type. Optional idempotency keys and If-Match values are forwarded without inventing domain rules. The transport supports PUT, but the existing backend has no PUT routes and does not allow PUT in CORS.

Use explicit `responseType: 'text'` or `'blob'` for non-JSON responses. Empty responses, including 204/205, return `body: undefined`. Request IDs, ETags and idempotency replay headers are exposed by backend CORS. `Content-Disposition` is not exposed across origins; future download UI will need a documented fallback filename or an approved backend change.

`ApiError` retains status, canonical code, request ID, field paths/codes and optional structured details. User-facing messages are allowlisted; backend free text is discarded. Details are not rendered or logged. Network failures and unexpected responses have safe fallbacks. Cancellation remains cancellation.

The shared QueryClient uses 30-second stale time, five-minute garbage collection, and at most one retry for network/server read failures. Authorization/client errors, malformed responses and cancellation are not retried. Mutations never retry automatically. Query functions must pass their supplied signal into the API client. Query-key helpers can include organization IDs later; no tenant selection or domain queries exist yet.

CSS Modules style components; `src/styles/tokens.css` defines shared colors, typography, spacing, radii, shadows and breakpoints. Authentication forms use React Hook Form with its [Zod resolver](https://github.com/react-hook-form/resolvers). decimal.js-light, date-fns and Recharts remain deferred until a milestone uses them. Frontend TypeScript is isolated from the JavaScript backend.

## Authentication and recovery

- `/login` signs in with `{email,password}`. `/register` creates a global user with `{email,password,firstName,lastName}`, then returns to sign-in; registration creates no organization, cookie or authenticated session.
- `/session` is a minimal protected confirmation page with sign-out. It is not a dashboard. `/` and not-found routes stay public. Protected routes show a checking state before resolving authentication. Return-to navigation accepts only the implemented local `/session` destination, with optional query/hash.
- Startup performs exactly one `POST /auth/refresh` with `{}`, including under React StrictMode. A valid token response is followed by `GET /me`; authentication is established only after profile verification. Tokens and profiles are runtime-validated. The profile lives in TanStack Query; React Context exposes session status/actions and reads that profile. Tokens never enter query data, browser storage, client cookies or logs. JWTs are not decoded for authority.
- Backend refresh credentials rotate once; reuse returns `401 SESSION_COMPROMISED` and compromises the family. Missing/expired refresh returns `401 INVALID_SESSION`. There is no client retry of rotation, including uncertain network outcomes. Failed restoration leaves a safe sign-in state. Failed logout clears the local session but reports that server revocation could not be confirmed, with an explicit retry action.
- The backend does not distinguish expired access JWTs from other invalid access contexts: both return `401 UNAUTHENTICATED`. With an existing access token, eligible requests may recover once through one shared in-flight refresh promise per application instance. Concurrent and late old-token failures share recovery; the refreshed `/me` identity must match the current account. New requests wait until that identity check completes. 403, noncanonical 401, network failures and uncertain mutation outcomes do not trigger automatic recovery/replay.
- GET reads may replay once. Mutations require explicit `replay: 'idempotent'` and their existing valid 16–128-character printable idempotency key. Future feature owners must verify their endpoint's idempotency contract before opting in. The body, method, If-Match, key, query and caller cancellation remain unchanged. No key is regenerated. A second 401 ends the session, without another refresh.
- Logout/account changes clear credentials and all account-specific query/mutation cache immediately and abort pending resource requests. A generation check prevents old requests from caching results or replaying with a new account. Logout waits for in-flight login/refresh Set-Cookie responses before sending its own revocation/clear-cookie request; an old response cannot restore local authentication. Authentication commands cannot use the recovery wrapper.
- Cancellation stops that caller's wait/replay without aborting shared single-use rotation. Auth cookie operations are serialized against login/logout; access tokens are held in one private in-memory controller. Deduplication is within one application instance; simultaneous refresh in independent tabs remains subject to the backend's strict replay policy.

All authentication POSTs send JSON, including `{}` for refresh/logout. Login failures use generic messages; registration exposes only the backend's safe `EMAIL_UNAVAILABLE` disclosure. Password validation follows 12–128 Unicode characters and a 512-byte UTF-8 ceiling. No password reset, verification, MFA, logout-all UI or tenant administration is added.
