/**
 * `getNextPageParam` for zero-based `?page=` endpoints that return bare arrays: a short page
 * means the end was reached.
 */
export function nextPageParam(pageSize: number) {
  return (lastPage: readonly unknown[], allPages: readonly unknown[][]): number | undefined =>
    lastPage.length < pageSize ? undefined : allPages.length;
}
