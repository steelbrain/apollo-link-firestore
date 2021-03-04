import type firebase from 'firebase'
import { concat, ApolloLink } from '@apollo/client'

import QueryLink from './QueryLink'
import SubscriptionLink from './SubscriptionLink'

export default function createFirestoreLink({ firestore }: { firestore: firebase.firestore.Firestore }): ApolloLink {
  return concat(
    new QueryLink({
      firestore,
    }),
    new SubscriptionLink({
      firestore,
    }),
  )
}
