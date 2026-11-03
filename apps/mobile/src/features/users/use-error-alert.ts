import { useEffect } from 'react';

import { ApiError, SESSION_CHANGED, SESSION_EXPIRED } from '@/api/errors';
import { showAlert } from '@/components/dropdown-alert';

/** Surfaces a failed query in the dropdown alert instead of leaving a silent blank screen. */
export function useErrorAlert(error: Error | null | undefined, what: string) {
  useEffect(() => {
    if (!error) return;
    // Session loss already routes back to the login screen.
    if (error instanceof ApiError && [SESSION_CHANGED, SESSION_EXPIRED].includes(error.code)) {
      return;
    }
    showAlert('error', 'Error', `Failed to load ${what}: ${error.message}`);
  }, [error, what]);
}
