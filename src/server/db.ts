// One Postgres pool per function instance. On Vercel that is Neon's pooled
// connection string; locally it is whatever DATABASE_URL points at.

import pg from "pg";

const holder = globalThis as { quickmockPool?: pg.Pool };

function pool(): pg.Pool {
  if (!holder.quickmockPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    holder.quickmockPool = new pg.Pool({ connectionString: url, ssl: local ? undefined : true, max: 5, idleTimeoutMillis: 10000 });
  }
  return holder.quickmockPool;
}

export async function query<Row extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<Row[]> {
  return (await pool().query<Row>(text, values)).rows;
}

/** Run several statements together, or none of them. */
export async function transaction<T>(work: (q: typeof query) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await work(async (text, values = []) => (await client.query(text, values)).rows as never);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
