# Apollo Link Firestore

Query Google Firebase Firestore with GraphQL in Apollo. Allows doing joins in Firebase via GQL syntax.

#### Installation

```
yarn add apollo-link @steelbrain/apollo-link-firestore
# or
npm install apollo-link @steelbrain/apollo-link-firestore
```

To use this Apollo Link adapter, modify your Apollo client creation like so

```js
import { from } from 'apollo-link'
import { ApolloClient, InMemoryCache } from '@apollo/client'
import createFirestoreLink from '@steelbrain/apollo-link-firestore'

const client = new ApolloClient({
  link: from([
    createFirestoreLink({
      firestore: firebase.firestore(),
    }),
  ]),
  cache: new InMemoryCache(),
})
```

#### Usage

To activate Firestore link on a GraphQL node, simply add the @firestore directive with the relevant arguments.
This package supports both `Query` and `Subscription` in GQL.

Here is an example query that showcases the API

```js
const query = gql`
  subscription Test {
    conversations @firestore(collection: "conversations", where: [["id", ">", 0]]) {
      title
      type
      fancyMembers {
        user: id @firestore(collection: "users") {
          id
          display_name
          z
        }
      }
      members @firestore(collection: "users") {
        id
        user: id @firestore(collection: "users") {
          id
          display_name
        }
        display_name
        y
      }
      messages @firestore(subcollection: "messages", limit: 20, order: ["id", "desc"]) {
        id
        user: userId @firestore(collection: "users") {
          id
          display_name
          x
        }
      }
    }
  }
`,
```

<details>

<summary>Here's the output of the query</summary>

```json
{
  "conversations": {
    "__type": "collection",
    "NMI01qpXobQwd4HtKhgU": {
      "fancyMessages": [{"id": 1}, {"id": 2}],
      "members": [1,2],
      "title": "Joe & Jane",
      "type": "group",
      "messages": {
        "__type": "collection",
        "uFBuo6CJu1knYqlzjzWl": {
          "userId": 3
        },
        "3PUKrbtpEGe14cmanKVy": {
          "userId": 2
        }
      }
    }
  },
  "users": {
    "2": {
      "display_name": "John Doe"
    }
  }
}
```

<details>
  <summary>Here is the database state used</summary>

```json
[
  {
    "title": "Drew & Anees",
    "type": "group",
    "__typename": "conversations",
    "members": [
      {
        "id": "2",
        "display_name": "Anees B",
        "y": null,
        "__typename": "users",
        "user": {
          "id": "2",
          "display_name": "Anees B",
          "__typename": "users"
        }
      },
      null
    ],
    "fancyMembers": [
      {
        "__typename": null,
        "user": {
          "id": "2",
          "display_name": "Anees B",
          "z": null,
          "__typename": "users"
        }
      },
      {
        "__typename": null,
        "user": null
      }
    ],
    "messages": [
      {
        "id": "3PUKrbtpEGe14cmanKVy",
        "__typename": "messages",
        "user": {
          "id": "2",
          "display_name": "Anees B",
          "x": null,
          "__typename": "users"
        }
      },
      {
        "id": "uFBuo6CJu1knYqlzjzWl",
        "__typename": "messages",
        "user": null
      }
    ]
  }
]
```
</details>

</details>


#### License

This project is licensed under the terms of MIT License. See the License file for more info.
