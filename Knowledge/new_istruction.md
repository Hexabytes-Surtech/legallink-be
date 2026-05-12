Here's the complete plan, broken into numbered steps with precise instructions for each API:

---

## Auth Flow

**API 1 — POST `/api/auth/register`**
- Accept `email`, `role` (`citizen | advocate`), `preferred_language` (optional, default `en`) in the body.
- Validate that `role` is one of the allowed values. If `role = advocate`, proceed; block `admin` role from self-registration.
- Check `users` table — if email already exists and `email_verified = true`, return a conflict error. If exists but unverified, treat as a re-registration attempt (overwrite OTP fields).
- Generate a 6-digit OTP. Hash it (bcrypt or SHA-256). Store `otp_code` (hashed) and `otp_expires_at` (now + 10 minutes) into the `users` row. Set `email_verified = false`.
- If new user, `INSERT` into `users` with the provided fields. If existing unverified user, `UPDATE` only the OTP fields.
- Send the plain OTP to the provided email via your email service.
- **Do not** issue any token here. Respond with `202` and `expiresInSeconds`.

---

**API 2 — POST `/api/auth/verify-otp`**
- Accept `email` and `otp` in the body.
- Fetch the user row by email. If not found, return `404`.
- Check `otp_expires_at` — if past current time, return `OTP_EXPIRED`.
- Hash the incoming `otp` and compare with stored `otp_code`. If mismatch, return `INVALID_OTP`.
- On match:
  - Set `email_verified = true`, clear `otp_code = NULL`, `otp_expires_at = NULL`.
  - Generate an `accessToken` (JWT, short-lived, e.g. 15 min) — payload: `{ userId, role }`.
  - Generate a `refreshToken` (JWT or random UUID, 7 days). Hash it and store in `users.refresh_token` + set `refresh_token_expires_at`.
  - If `role = advocate`, create a row in the `advocates` table with `user_id` set and all array fields defaulting to `{}`, `verification_status = 'pending'`. Only do this if no `advocates` row already exists for this `user_id`.
  - Set the refresh token as a cookie exactly as you specified (`httpOnly`, `secure`, `sameSite: strict`, `maxAge: 7 days`).
  - Return `accessToken` and basic `user` object (`userId`, `email`, `role`, `preferred_language`) in the response body.

---

**API 3 — POST `/api/auth/logout`**
- Protected route — requires valid `accessToken` in `Authorization: Bearer` header.
- Read `userId` from the JWT payload.
- `UPDATE users SET refresh_token = NULL, refresh_token_expires_at = NULL WHERE id = $userId`.
- Call `res.clearCookie('refreshToken')` with the same cookie options (path, sameSite, secure) so the browser drops it.
- Respond `200`.

---

**API 4 — POST `/api/auth/refresh-token`**
- Read the `refreshToken` from `req.cookies.refreshToken`. If missing, return `401`.
- Hash the incoming token and look up `users` table: `WHERE refresh_token = $hashed AND refresh_token_expires_at > now()`. If not found or expired, return `401`.
- Issue a new `accessToken` (JWT, 15 min). Do **not** rotate the refresh token unless you want to implement refresh token rotation (optional for Phase 1).
- Return the new `accessToken` in the response body.

---

## Profile APIs

**API 5 — PUT `/api/user/profile`**
- Protected. Any authenticated user (`citizen` or `advocate`).
- Accept these fields (all optional, update only what's provided): `phone`, `preferred_language`, `avatar_url` — but `avatar_url` should **not** be set here; it comes from the upload API below.
- `UPDATE users SET phone = $phone, preferred_language = $lang, updated_at = now() WHERE id = $userId`.
- Do not allow `email` or `role` changes via this endpoint.
- Return updated user object (without sensitive fields like `otp_code`, `refresh_token`).

---

**API 6 — POST `/api/user/avatar`** (Cloudinary upload)
- Protected.
- Use your existing multer + Cloudinary setup. The file comes in as `multipart/form-data` with field name `avatar`.
- After Cloudinary returns the URL, `UPDATE users SET avatar_url = $cloudinaryUrl, updated_at = now() WHERE id = $userId`.
- Return `{ avatar_url }` in the response.

---

**API 7 — PUT `/api/advocate/profile`**
- Protected. Requires `role = advocate` (middleware guard: check JWT payload `role`).
- Accept the following fields from the `advocates` table — all can be partial updates:
  - `name`, `address`, `phone`, `email` (advocate's CoP contact, separate from `users.email`)
  - `bar_enrolment_number`, `state_bar`
  - `practice_areas` (array), `courts` (array), `languages` (array), `districts` (array)
- Look up the `advocates` row via `user_id = $userId` from JWT. If no row found (shouldn't happen after verify-otp, but guard it), return `404`.
- `UPDATE advocates SET ... WHERE user_id = $userId`.
- Return the updated `advocates` row merged with relevant `users` fields.

---

**API 8 — POST `/api/advocate/documents`** (Certificate of Practice upload)
- Protected. `role = advocate` guard.
- `multipart/form-data` with field name `document`. Accept `application/pdf`, `image/jpeg`, `image/png` only.
- As of now upload to cloudinary specified folder and save the url into database.
- Insert into `advocate_verification_documents`: `{ advocate_id, file_path (S3 key), file_type, uploaded_at }`.
  - Get `advocate_id` by querying `advocates WHERE user_id = $userId`.
- Return `{ documentId, file_path, file_type, uploaded_at }`.

---

## Key Implementation Notes

- **Middleware order**: build a `requireAuth` middleware (verify `accessToken`, attach `req.user`) and a `requireRole('advocate')` middleware that checks `req.user.role`. Stack them on routes 5–8.
- **`advocates` row creation** happens in `verify-otp` (API 2), not in a separate register step. This means by the time the advocate hits API 7, the row always exists.
- **Never return** `otp_code`, `refresh_token`, or their expiry fields in any response.
- **`updated_at` trigger**: make sure your DB trigger fires on `UPDATE` for both `users` and `advocates` tables, otherwise manually set `updated_at = now()` in every update query.
- **Partial updates**: use `COALESCE($incoming, existing_value)` pattern or build the SET clause dynamically — only include fields the client actually sent.

 Here's the login flow:

---

**API — POST `/api/auth/login`**
- Accept `email` in the body. No password — your schema uses email OTP as the auth mechanism (there is no `password` column in `users`).
- Look up user by email. If not found, return `404 USER_NOT_FOUND`.
- Check `email_verified = true`. If false, they never completed registration — return `403 EMAIL_NOT_VERIFIED`.
- Generate a fresh 6-digit OTP. Hash it. `UPDATE users SET otp_code = $hashed, otp_expires_at = now() + 10min WHERE email = $email`.
- Send the plain OTP to the email.
- Respond `202` with `expiresInSeconds`.

Then the user calls the **existing API 2 (`verify-otp`)** with their email + OTP — same endpoint as registration. It already handles issuing tokens, setting the cookie, and returning the access token.

---

**So the full flows are:**

- **First time (Register):** `register` → `verify-otp`
- **Returning user (Login):** `login` → `verify-otp`

The `verify-otp` endpoint is the single token-issuing gate for both cases. The only difference between register and login internally is:
- `register` creates the user row + advocate row
- `login` finds the existing verified user row

Both end at `verify-otp` which does the token work.