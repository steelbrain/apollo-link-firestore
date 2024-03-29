import type { Firestore } from 'firebase/firestore'
import { concat, ApolloLink } from '@apollo/client'

import QueryLink from './QueryLink'
import SubscriptionLink from './SubscriptionLink'

export default function createFirestoreLink({ firestore }: { firestore: Firestore }): ApolloLink {
  return concat(
    new QueryLink({
      firestore,
    }),
    new SubscriptionLink({
      firestore,
    }),
  )
}
