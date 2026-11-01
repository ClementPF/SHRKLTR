import { API_URL } from './config';

export interface HealthResponse {
  status: string;
  database: string;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/health`, { signal });
  if (!response.ok) {
    throw new Error(`Health check failed (HTTP ${response.status})`);
  }
  return (await response.json()) as HealthResponse;
}
