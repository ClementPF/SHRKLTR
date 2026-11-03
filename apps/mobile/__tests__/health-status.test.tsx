import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import { HealthStatus } from '@/components/health-status';

function renderWithClient() {
  const client = new QueryClient({
    // gcTime Infinity avoids GC timers that keep jest alive after the run.
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HealthStatus />
    </QueryClientProvider>,
  );
}

function mockFetch(response: Partial<Response>) {
  const fn = jest.fn().mockResolvedValue(response);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('HealthStatus', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows the backend status returned by GET /health', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', database: 'up' }),
    });

    await renderWithClient();

    expect(await screen.findByText('Backend: ok (database up)')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3100/health', expect.anything());
  });

  it('shows an unreachable state when the request fails', async () => {
    mockFetch({ ok: false, status: 503, json: async () => ({}) });

    await renderWithClient();

    expect(
      await screen.findByText('Backend unreachable: Health check failed (HTTP 503)'),
    ).toBeTruthy();
  });
});
