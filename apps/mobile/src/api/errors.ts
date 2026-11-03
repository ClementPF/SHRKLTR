import type { ErrorEnvelope } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Status 0 marks a request that never got an HTTP response. */
export const NETWORK_ERROR = 'NETWORK_ERROR';
export const SESSION_EXPIRED = 'SESSION_EXPIRED';
/** The request belonged to a session that was signed out or replaced before it finished. */
export const SESSION_CHANGED = 'SESSION_CHANGED';

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value as { error: unknown };
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON error bodies fall back to a status-derived code below.
  }
  if (isErrorEnvelope(body)) {
    return new ApiError(response.status, body.error.code, body.error.message);
  }
  return new ApiError(
    response.status,
    `HTTP_${response.status}`,
    `Request failed (HTTP ${response.status})`,
  );
}
