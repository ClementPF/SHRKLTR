import type { SQL } from 'drizzle-orm';

/**
 * Restricts a query joined on `tournaments` to the tournaments the viewer may read. Every
 * tournament is currently open to authenticated users, so there is no restriction yet; grouped
 * tournaments will add their membership predicate here.
 */
export function visibleTournamentsFilter(viewerId: string): SQL | undefined {
  void viewerId;
  return undefined;
}

/**
 * Restricts a query joined on `tournaments` to data an anonymous capability holder (e.g. a
 * claim-link preview) may read. Every tournament is currently open; grouped tournaments will be
 * excluded here.
 */
export function openTournamentsFilter(): SQL | undefined {
  return undefined;
}
