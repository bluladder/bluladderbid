# Public booking launch control

`PUBLIC_BOOKING_ENABLED` is the server-authoritative containment switch for
both public write paths:

- `jobber-create-booking`
- `jobber-create-service-request`

Only the exact value `true` admits a new public booking or service request.
Missing, empty, `false`, whitespace-padded, case-changed, or otherwise
malformed values fail closed with HTTP 503 and `PUBLIC_BOOKING_DISABLED`.
Before rejecting, the functions may parse, validate, and perform the read-only
idempotency lookup needed to return an already-completed exact replay. They
cannot resolve a new organization/service decision, reserve capacity, persist
an intervention/customer/quote/booking, or call a provider while paused.

The one exception is the existing controlled booking-test runner. It must use
the service-role bearer, a server-only run header, an active `execute` or
`duplicate` run, the exact run idempotency key, the protected identity, and the
already-consumed unexpired single-use Jobber authorization. Every mismatch
fails closed. The recurring service-request path has no bypass.
For an authorized protected run, the booking and cleanup endpoints synchronously
acknowledge suppression and skip every SMS, email, owner-notification, and
campaign side effect. The runner fails if either endpoint omits that receipt.

The mutable service-area singleton may narrow the DFW launch area, but it cannot
change the launch state away from Texas or expand eligibility outside the
canonical DFW metropolitan counties. A configuration mismatch, eligible Oregon
result, or eligible non-DFW Texas result fails closed.

Every rejection emits one structured, PII-free Edge Function log entry:

```json
{
  "event": "public_booking_launch_gate_rejected",
  "workflow": "one_time_booking",
  "reason_code": "operator_paused",
  "correlation_id": "server-generated UUID",
  "authoritative_write_attempted": false
}
```

The same correlation ID is returned in the response body and
`X-Correlation-Id` header. It is an operator diagnostic reference, not proof of
a durable intervention or booking.

## Protected deployment and containment commands

These commands are operator instructions only. They are not authorized by
their presence in the repository.

Set the setting false first. If the currently deployed functions predate this
control, the setting is not yet containment; treat booking state as UNKNOWN
until both gate-bearing functions are deployed and probed:

```bash
supabase secrets set PUBLIC_BOOKING_ENABLED=false \
  EXPECTED_SUPABASE_PROJECT_REF="$SUPABASE_PROJECT_REF" \
  --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy jobber-create-booking \
  --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy jobber-create-service-request \
  --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy admin-diagnostics \
  --project-ref "$SUPABASE_PROJECT_REF"
```

After deployment, record the returned `admin-diagnostics` deployment ID and,
under the same separately authorized configuration window, pin it:

```bash
supabase secrets set \
  PUBLIC_BOOKING_GATE_DEPLOYMENT_ID="$ADMIN_DIAGNOSTICS_DEPLOYMENT_ID" \
  --project-ref "$SUPABASE_PROJECT_REF"
```

The admin UI reports `UNKNOWN — RELEASE BLOCKED` unless the project ref, exact
gate-bearing deployment ID, production environment, successful diagnostics
reads, and two-minute freshness window all verify.

Supabase documents that updated Edge Function secrets are available
immediately to function invocations, so an emergency pause does not require a
code deployment:

```bash
supabase secrets set PUBLIC_BOOKING_ENABLED=false \
  --project-ref "$SUPABASE_PROJECT_REF"
```

Enable only after database release, deployment verification, provider
configuration verification, and the controlled synthetic booking gate have
all produced reviewed evidence:

```bash
supabase secrets set PUBLIC_BOOKING_ENABLED=true \
  --project-ref "$SUPABASE_PROJECT_REF"
```

After either change, invoke both functions with a non-customer, non-mutating
probe that cannot match an existing idempotency key. Disabled proof must be 503
with `PUBLIC_BOOKING_DISABLED`. Enabled proof must not use a real booking
payload; perform the separately authorized synthetic workflow instead.

This is admission control, not cancellation of an invocation that already
passed the gate. Before declaring containment, wait for the Edge Function
maximum in-flight window, reconcile booking/reservation/provider outcomes
started before the pause timestamp, and require zero uncertain outcomes.
Rollback is allowed only to a known gate-bearing deployment. Reverting to a
pre-gate function would make the false setting inert and is not containment.

## Stop and containment conditions

Immediately set `PUBLIC_BOOKING_ENABLED=false` if any of these occurs:

- organization or service-area identity is missing, ambiguous, or unexpected;
- a rejected request produces an authoritative write or communication;
- duplicate submissions produce multiple business or provider effects;
- the booking response claims confirmation without a provider visit ID;
- provider uncertainty advances booking state;
- operator diagnostics cannot correlate the outcome.

Capture the UTC timestamp, project reference, operator identity, command
approval, secret-name-only command output, correlation IDs, function deployment
IDs, and post-change probe result. Never capture a secret value.

## Other launch controls

| Workflow | Initial-launch containment |
|---|---|
| Voice booking | Live mutation is structurally absent. The adapter accepts only `disabled` or `dry_run`; `VOICE_LIVE_BOOKING_ENABLED` cannot make a provider write. |
| Campaign enrollment/delivery | `campaign_launch_controls.enrollment_paused` and `delivery_paused` stop new campaign work and queue claims. |
| AI autonomous SMS/booking | Existing safety gates fail closed when required configuration is absent or disabled. |
| Bid delivery | Provider submission is guarded by durable claims, suppression, authorization, and fail-closed provider configuration. There is no independent global bid-delivery switch; containment is provider/configuration-level and must be verified before launch. Adding a second stateful switch is deferred until an operational need is proven. |

No control here activates Oregon or changes organization routing.
