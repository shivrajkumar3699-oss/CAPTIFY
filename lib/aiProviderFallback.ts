/**
 * Server-side contract for CAPTIFY's zero-cost AI provider chain.
 *
 * Deliberately contains no provider credentials or guessed endpoints. A provider
 * may enter the live chain only after its official API terms, free allowance,
 * reset window and billing behaviour have been verified.
 */

export type AiGenerationKind = "text-to-image" | "text-to-video" | "image-to-video";

export type FreeQuotaState = {
  available: boolean;
  remaining?: number;
  resetsAt?: string;
  reason?: string;
};

export type FreeProviderErrorCode =
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "UNSUPPORTED"
  | "BILLING_REQUIRED"
  | "UNKNOWN";

export class FreeProviderError extends Error {
  constructor(
    message: string,
    public readonly code: FreeProviderErrorCode,
    public readonly requestAccepted: boolean = false,
  ) {
    super(message);
    this.name = "FreeProviderError";
  }
}

export type FreeGenerationProvider<TInput, TOutput> = {
  id: string;
  enabled: boolean;
  freeTierVerified: boolean;
  supports: readonly AiGenerationKind[];
  getQuota(kind: AiGenerationKind): Promise<FreeQuotaState>;
  generate(input: TInput, kind: AiGenerationKind): Promise<TOutput>;
};

export type FreeFallbackResult<TOutput> = {
  providerId: string;
  output: TOutput;
  attemptedProviders: string[];
};

/**
 * Runs only providers explicitly enabled and verified as free.
 * It never retries a request after an ambiguous timeout where the provider may
 * already have accepted/billed the generation, and it never invokes paid tiers.
 */
export async function generateWithFreeFallback<TInput, TOutput>(
  providers: readonly FreeGenerationProvider<TInput, TOutput>[],
  kind: AiGenerationKind,
  input: TInput,
): Promise<FreeFallbackResult<TOutput>> {
  const attemptedProviders: string[] = [];
  const eligible = providers.filter(
    (provider) =>
      provider.enabled &&
      provider.freeTierVerified &&
      provider.supports.includes(kind),
  );

  for (const provider of eligible) {
    attemptedProviders.push(provider.id);

    let quota: FreeQuotaState;
    try {
      quota = await provider.getQuota(kind);
    } catch {
      // A quota lookup failure is not permission to risk a paid generation.
      continue;
    }

    if (!quota.available) continue;

    try {
      const output = await provider.generate(input, kind);
      return { providerId: provider.id, output, attemptedProviders };
    } catch (error) {
      if (!(error instanceof FreeProviderError)) {
        // Unknown failures may be ambiguous; do not duplicate the generation.
        throw error;
      }

      if (error.requestAccepted) {
        throw error;
      }

      if (
        error.code === "QUOTA_EXHAUSTED" ||
        error.code === "RATE_LIMITED" ||
        error.code === "UNAVAILABLE" ||
        error.code === "UNSUPPORTED"
      ) {
        continue;
      }

      // Billing-required and unknown errors stop the chain: never try to
      // route around a provider's billing or account restrictions.
      throw error;
    }
  }

  throw new FreeProviderError(
    eligible.length
      ? "All verified free providers are exhausted or unavailable. The request was not sent to a paid provider."
      : "No verified free provider is currently configured for this generation type.",
    "QUOTA_EXHAUSTED",
  );
}
