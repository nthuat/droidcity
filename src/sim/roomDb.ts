export const DB_QUERY_MS = 30

export interface DbState { readonly tables: Readonly<Record<string, { readonly fresh: boolean }>> }

export function createDb(): DbState {
  return { tables: { feed: { fresh: false } } }
}

export function query(s: DbState, key: string): { hit: boolean; fresh: boolean } {
  const t = s.tables[key]
  return t ? { hit: true, fresh: t.fresh } : { hit: false, fresh: false }
}

export function insert(s: DbState, key: string): DbState {
  return { tables: { ...s.tables, [key]: { fresh: true } } }
}
