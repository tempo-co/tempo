# Auth and sessions

Rules for `src/app/modules/auth/`, `src/app/core/session/` and `src/app/core/personal-access-token/` that the code relies on but does not state in one place.

## Bearer tokens and sessions

- Bearer-token requests are told apart by `isBearerRequest` both in `src/app/core/session/session.module.ts` (session middleware skipped) and in `src/app/modules/auth/guards/auth.guard.ts`. A new auth path needs the same discriminator at both, or token requests read and refresh sessions.
- Personal access tokens are revoked by password change, password reset and account deletion, which all call `revokeAllCredentials` in `src/app/core/session/session.service.ts`. Logout, revoking one session and revoking all other sessions (`DELETE /auth/sessions`) keep them. Extend those flow tests (`test/e2e/auth/personal-access-tokens.e2e.spec.ts`, `test/e2e/auth/sessions.e2e.spec.ts`) when changing either side.
- Emailed secrets (signup codes, reset and email-change tokens) are stored in Redis only as SHA-256 hashes under the per-account keys in `src/app/modules/account/auth-secret-keys.ts`: one live secret of each kind per account, consumed atomically. Password change, password reset and a confirmed email change end the reset link; account deletion removes all three. Verifying an email never creates a session, and changing the email requires the current password. Extend those flow tests when changing either side.

## Origin checks

- Every session-authenticated request other than GET, HEAD and OPTIONS must carry the exact origin of `WEB_BASE_URL`; `AuthGuard` refuses it with 403 otherwise. `SameSite=Strict` alone does not stop sibling hosts of the same site: `ts.net` is on the Public Suffix List, so every device on one tailnet shares a site.
- `@Public()` routes other than GET, HEAD and OPTIONS (login, signup and its verification, password reset) need the same Origin, or another site could sign a victim in to an account it controls (login CSRF), and a JSON body: anything else gets 415. The API parses only JSON bodies (`bodyParser: false` plus `useBodyParser('json')` in `src/main.ts` and `test/setup/e2e.setup.ts`), so no route reads an HTML form post.
- `isWebOriginRequest` (`src/app/modules/auth/guards/web-origin.ts`) accepts only a value that is already its own normalized origin and equals the web origin. Tests of an Origin check cover the canonical origin and a missing, `null`, malformed and mismatched one, one with a trailing slash and one with an explicit default port. After refusing a request that carries a one-time secret, retry it with the trusted origin to prove the refusal did not consume the secret.
- `loginAgent` in API E2E sends the web Origin by default; `.unset('Origin')` drops it for a request. Calls to public routes outside `loginAgent` set `.set('Origin', webOrigin())`; web E2E fixtures send the app's Origin on their API calls.
