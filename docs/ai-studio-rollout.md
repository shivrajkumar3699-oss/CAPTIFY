# CAPTIFY AI Studio rollout

## Current state

- The existing clip-extraction home page remains unchanged.
- A separate `/studio` workspace has been added for text-to-image, text-to-video and image-to-video request setup.
- The workspace exposes the requested fixed duration choices (10s, 30s, 45s, 1m, 2m, 5m, 10m), aspect ratios and four video export format choices.
- `lib/aiProviderFallback.ts` defines a fail-closed provider contract. It only permits providers explicitly marked as enabled and free-tier-verified.
- No paid provider is configured or called by this change.

## Provider admission rules

A provider must not be marked `freeTierVerified` until all of the following are checked against current official documentation and a real account/API test:

1. An official API is available for the required generation type (not merely a free consumer website).
2. The free allowance applies to API use and its quantity is recorded.
3. The quota reset cadence and timezone are known. Monthly or one-time credits must not be presented as daily credits.
4. The provider's billing behaviour is understood; no automatic paid overage or paid fallback is possible.
5. Commercial/website use is permitted by the provider's terms.
6. A real request and resulting media can be retrieved and validated.

A consumer website's free credits do not automatically grant API access. Do not automate account creation, evade limits, scrape private endpoints, or use browser automation to bypass provider restrictions.

## Next integration work

- Verify official API access and free quota for each candidate provider.
- Implement one adapter per provider using its documented API only.
- Store credentials in server-side environment variables; never expose them to browser code.
- Persist quota observations in the database with provider-defined reset timestamps. Do not assume every provider resets daily at midnight UTC.
- Route image and video requests through separate fallback chains.
- Treat ambiguous network timeouts as non-retryable until request status is reconciled, to avoid duplicate generation or accidental billing.
- Add provider health/quota dashboard and integration tests before enabling a provider.

## Important limitation

The current `/studio` route is a front-end workspace and the fallback module is an integration contract, not a working generation backend. Actual generation, provider adapters, timeline editing, FFmpeg export and quota persistence are not enabled yet. This is intentional: no unverified free quota or unsupported endpoint is represented as operational.
