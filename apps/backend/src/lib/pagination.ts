import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Zero-based `page` and `pageSize` query parameters shared by every paginated route. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0).describe('Zero-based page index'),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(`Items per page (max ${MAX_PAGE_SIZE})`),
});

export interface PageWindow {
  offset: number;
  limit: number;
}

export function parsePage(query: { page?: number; pageSize?: number } = {}): PageWindow {
  const { page, pageSize } = pageQuerySchema.parse(query);
  return { offset: page * pageSize, limit: pageSize };
}
