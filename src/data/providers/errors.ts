export type DataProviderErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_API_KEY"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "CORS_UNSUPPORTED"
  | "RATE_LIMITED"
  | "PARSE_ERROR"
  | "DATA_ERROR"
  | "UNSUPPORTED_SYMBOL"
  | "UNKNOWN"

export class DataProviderError extends Error {
  readonly code: DataProviderErrorCode
  readonly status?: number
  readonly details?: unknown

  constructor(
    code: DataProviderErrorCode,
    message: string,
    options?: { status?: number; details?: unknown; cause?: unknown }
  ) {
    super(message)
    this.name = "DataProviderError"
    this.code = code
    this.status = options?.status
    this.details = options?.details
    if (options?.cause) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

export function isDataProviderError(e: unknown): e is DataProviderError {
  return e instanceof DataProviderError
}

/** Detect likely CORS failure from browser fetch error */
export function isLikelyCorsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("cors") ||
    msg.includes("access-control-allow-origin")
  )
}
