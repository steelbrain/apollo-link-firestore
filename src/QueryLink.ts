/* eslint-disable class-methods-use-this */
import type firebase from 'firebase'
import { hasDirectives, getOperationName, getOperationDefinition } from 'apollo-utilities'
import { ApolloLink, Operation, NextLink, Observable, FetchResult } from 'apollo-link'

import parse from './parse'
import execute from './execute'

export default class QueryLink extends ApolloLink {
  firestore: firebase.firestore.Firestore
  constructor({ firestore }: { firestore: firebase.firestore.Firestore }) {
    super()
    this.firestore = firestore
  }
  public request(operation: Operation, forward: NextLink): Observable<FetchResult> {
    const operationName = getOperationName(operation.query) || 'Unknown'

    if (!hasDirectives(['firestore'], operation.query)) {
      if (forward != null) {
        return forward(operation)
      }
      throw new Error(`Missing @firestore directive for Operation: ${operationName}`)
    }

    const query = getOperationDefinition(operation.query)
    if (query == null || query.operation !== 'query') {
      if (forward != null) {
        return forward(operation)
      }
      throw new Error(`Unsupported operation in FirestoreQueryLink`)
    }

    return new Observable((observer) => {
      const firestoreQuery = parse({
        operation,
        query,
      })

      let complete = false
      const response = execute({
        context: null,
        firestore: this.firestore,
        nodes: firestoreQuery,
        parentValue: {},
        operationType: 'query',
        cache: new Map(),
        onValue(data) {
          if (complete) {
            return
          }
          complete = true
          observer.next({ data })
          observer.complete()
          response.cleanup()
        },
      })
      return response.cleanup
    })
  }
}
