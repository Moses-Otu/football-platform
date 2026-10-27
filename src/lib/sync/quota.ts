export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export interface QuotaGuardOptions {
  /** The plan's requests per day (100 on the free plan). */
  dailyLimit: number;
  /** Share of the daily limit to always leave unused, e.g. 0.1 = keep 10%. */
  reserveShare: number;
  /** Most requests this one job may spend, whatever is left for the day. */
  maxRequestsThisRun: number;
}

/**
 * Stops a sync job before it uses up the day's quota. It trusts the
 * provider's remaining-requests header once one has been seen.
 */
export class QuotaGuard {
  requestsUsed = 0;
  remaining: number | null = null;

  constructor(private readonly opts: QuotaGuardOptions) {}

  static fromEnv(maxRequestsThisRun: number): QuotaGuard {
    return new QuotaGuard({
      dailyLimit: Number(process.env.API_FOOTBALL_DAILY_LIMIT ?? 100),
      reserveShare: 0.1,
      maxRequestsThisRun,
    });
  }

  private get reserve(): number {
    return Math.ceil(this.opts.dailyLimit * this.opts.reserveShare);
  }

  assertCanSpend(): void {
    if (this.requestsUsed >= this.opts.maxRequestsThisRun) {
      throw new QuotaExceededError(`Run budget of ${this.opts.maxRequestsThisRun} requests used`);
    }
    if (this.remaining !== null && this.remaining <= this.reserve) {
      throw new QuotaExceededError(
        `Only ${this.remaining} requests left today; keeping ${this.reserve} in reserve`,
      );
    }
  }

  recordRequest(remainingHeader: string | null): void {
    this.requestsUsed++;
    const parsed = remainingHeader === null ? NaN : Number(remainingHeader);
    if (Number.isFinite(parsed)) this.remaining = parsed;
  }
}
