# Inbound Email Setup (Resend + Reply Tokens)

This project ingests inbound email replies into the same canonical
`chat_conversations` timeline used by web chat and SMS. Matching is done via a
signed reply-token stored in the outbound `Reply-To` local part
(`reply+<token>@notify.bluladder.com`), NOT via subject text.

## Code state

Implemented and safe to leave in place:

- Migration `email_reply_tokens` and `email_inbound_messages` (admin-scoped RLS).
- Shared helper `supabase/functions/_shared/emailReplyToken.ts` for issuing and
  verifying HMAC-signed tokens.
- Edge function `inbound-email` that persists raw inbound payloads before
  processing, verifies the token signature, and appends the message to the
  correct conversation.

## Owner configuration required to activate

The following owner-side steps must be completed before inbound email actually
lands in the Conversations workspace. Nothing below is guessed — perform each
step with the values shown in the Lovable Cloud → Emails view for
`notify.bluladder.com`.

1. **Add a shared inbound webhook secret.** In Lovable Cloud → Secrets, add:
   - `RESEND_INBOUND_WEBHOOK_SECRET` — a strong random value
     (e.g. `openssl rand -hex 32`). The `inbound-email` function fails closed
     if this is not set.
   - `EMAIL_REPLY_TOKEN_SECRET` — a strong random value used to sign reply
     tokens. Rotating this invalidates outstanding tokens; do not rotate
     while campaigns are running.

2. **Register the inbound webhook with Resend.** In the Resend dashboard for
   `notify.bluladder.com`, under Webhooks / Inbound, add an inbound route
   pointing to the deployed `inbound-email` function URL. Include the shared
   secret as either the `x-webhook-secret` header or the `?token=` query
   string. Allow at least three retries with exponential backoff.

3. **Configure the inbound MX / receiving subdomain.** Resend inbound requires
   MX records on the receiving subdomain (typically the same
   `notify.bluladder.com` subdomain used for outbound). Follow the exact MX
   values shown in the Resend inbound setup screen; do not copy them from
   memory. Add any additional records Resend lists.

4. **Verify the inbound domain.** Confirm status is verified in Resend before
   sending a live reply. Until then inbound emails silently bounce and the
   Conversations timeline will not receive them.

5. **Adopt the reply-token in outbound emails.** When outbound
   transactional / campaign email templates are ready to move to threaded
   replies, call `issueReplyToken()` at send time, persist the row in
   `email_reply_tokens` with the target `conversation_id` (and optional
   `quote_id` / `booking_id`), and set the outbound `Reply-To` header to
   `reply+<token>@notify.bluladder.com`. This is a wire-up step in the
   outbound send path; it is intentionally not enabled in this build so that
   no live emails go out.

## Verifying end-to-end (once the above is done)

1. Send a test outbound email with a valid `Reply-To: reply+<token>@…`.
2. Reply from the recipient's mailbox.
3. Confirm a row appears in `email_inbound_messages` with `processed_at` set
   and `conversation_id` populated.
4. Confirm the reply appears in the Conversations timeline for that
   conversation.

## Failure modes and safety

- Missing shared secret → `inbound-email` returns HTTP 503 and ingests
  nothing.
- Token signature does not verify → the message is still persisted (audit
  trail) but marked `processing_error = "no_valid_token"` and is not
  appended to any conversation.
- Revoked / expired tokens are treated the same as unknown tokens.
- Duplicate `provider_message_id` values are handled idempotently.