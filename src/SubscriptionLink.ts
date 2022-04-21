/* eslint-disable class-methods-use-this */

import throttle from 'lodash/throttle'
import type { Firestore } from 'firebase/firestore'
import { hasDirectives, getOperationName, getOperationDefinition } from 'apollo-utilities'
import { ApolloLink, Operation, NextLink, Observable, FetchResult } from '@apollo/client'

import parse from './parse'
import execute from './execute'

export default class SubscriptionLink extends ApolloLink {
  firestore: Firestore
  constructor({ firestore }: { firestore: Firestore }) {
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
    if (query == null || query.operation !== 'subscription') {
      if (forward != null) {
        return forward(operation)
      }
      throw new Error(`Unsupported operation in FirestoreSubscriptionLink`)
    }

    const cache = new Map()

    return new Observable((observer) => {
      const firestoreQuery = parse({
        operation,
        query,
      })

      const debouncedNext = throttle(
        (data) => {
          observer.next({ data })
        },
        100,
        {
          leading: false,
        },
      )

      const response = execute({
        context: null,
        firestore: this.firestore,
        nodes: firestoreQuery,
        parentValue: {},
        operationType: 'subscribe',
        cache,
        onValue: debouncedNext,
        onError: observer.error,
      })
      return response.cleanup
    })
  }
}
