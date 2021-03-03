type OrderOp = 'asc' | 'desc'
type WhereOp = '<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'in' | 'array-contains-any' | 'not-in'

export interface FirestoreVariables {
  limit: number | null
  limitToLast: number | null
  order: [string, OrderOp] | null
  where: [string, WhereOp, string][] | null
}

export interface FirestoreNode {
  // eslint-disable-next-line camelcase
  __cache_key: string
  name: string
  alias: string
  collection: string | null
  subcollection: string | null
  children: FirestoreNode[] | null
  variables: FirestoreVariables | null
}

export type OperationType = 'query' | 'subscribe'
