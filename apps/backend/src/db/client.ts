import { drizzle } from 'drizzle-orm/postgres-js';

export type Database = ReturnType<typeof createDb>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// drizzle 1.0-rc requires the connection string form; passing a postgres-js client is unsupported.
export function createDb(connectionString: string) {
  return drizzle({
    connection: { url: connectionString, connect_timeout: 5, onnotice: () => {} },
  });
}
