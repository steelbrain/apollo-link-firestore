/* eslint-disable no-param-reassign,no-underscore-dangle */

import {
  collection,
  CollectionReference,
  doc,
  documentId,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  getDoc,
  getDocs,
  limit,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  Query,
  QueryConstraint,
  QuerySnapshot,
  where,
} from 'firebase/firestore'
import { FirestoreNode, OperationType } from './types'

function normalizeFirestoreDoc(document: DocumentSnapshot, node: FirestoreNode): Record<string, any> | null {
  const data = document.data()
  if (data == null) {
    return null
  }
  if (data.id != null) {
    data.__orig_sb_firestore_id = data.id
  }
  data.id = document.id
  data.__typename = node.collection || node.subcollection || '_'

  return data
}

function getDatabaseRef({
  cache,
  firestore,
  node,
  nodeValue,
  nodeParent,
  nodeParentSnap,
}: {
  cache: Map<string, any>
  firestore: Firestore
  node: FirestoreNode
  nodeValue: any
  nodeParent: FirestoreNode | null | undefined
  nodeParentSnap: DocumentSnapshot | null | undefined
}): DocumentReference | Query {
  let cacheKey = `${node.__cache_key}__$`
  if (node.subcollection != null) {
    if (nodeParent == null || nodeParentSnap == null) {
      throw new Error('context not found')
    }
    cacheKey += `${nodeParent.collection}:${nodeParentSnap.id}__$`
  }
  if (node.collection != null && nodeParent != null) {
    cacheKey += `${nodeValue}`
  }

  const cached = cache.get(cacheKey)
  if (cached != null) {
    return cached
  }

  let collectionRef: CollectionReference
  let ref: DocumentReference | Query | null = null
  if (node.subcollection != null) {
    if (nodeParent == null || nodeParentSnap == null) {
      throw new Error('context not found')
    }
    collectionRef = collection(nodeParentSnap.ref, node.subcollection)
  } else if (node.collection != null) {
    collectionRef = collection(firestore, node.collection)
    if (nodeParent != null) {
      ref = doc(collectionRef, `${nodeValue}`)
    }
  } else {
    throw new Error('Ref not found')
  }
  if (ref == null && node.variables != null) {
    const { order, where: whereClause, limit: limitClause, limitToLast: limitToLastClause } = node.variables
    const constraints: QueryConstraint[] = []
    if (order != null) {
      constraints.push(orderBy(order[0], order[1]))
    }
    if (whereClause != null) {
      const whereConstraints = whereClause.map((whereItem) =>
        where(whereItem[0] === '$id' ? documentId() : whereItem[0], whereItem[1], whereItem[2]),
      )
      constraints.push(...whereConstraints)
    }
    if (limitClause != null) {
      constraints.push(limit(limitClause))
    }
    if (limitToLastClause != null) {
      constraints.push(limitToLast(limitToLastClause))
    }
    ref = query(collectionRef, ...constraints)
  }

  if (ref == null) {
    throw new Error('Ref not found')
  }

  cache.set(cacheKey, ref)
  return ref
}

export default function executeFirestoreNodes({
  context,
  firestore,
  nodes,
  parentValue,
  operationType,
  cache,
  onValue,
  onError,
}: {
  context: { nodeParent: FirestoreNode; nodeParentSnap: any } | null
  firestore: Firestore
  nodes: FirestoreNode[]
  parentValue: any | null
  operationType: OperationType
  cache: Map<string, any>
  onValue: (value: any) => void
  onError: (err: Error) => void
}): {
  value: any
  totalRefs: number
  loadedRefs: number
  cleanup: () => void
} {
  let setUp = false
  let cleanedUp = false
  let cleanup: (() => void)[] = []
  const result = {
    value: null as any,
    totalRefs: 0,
    loadedRefs: 0,
    cleanup() {
      if (cleanedUp) {
        return
      }
      cleanedUp = true
      cleanup.forEach((cb) => {
        cb()
      })
      cleanup = []
    },
  }

  function notifyValueChange() {
    if (result.loadedRefs === result.totalRefs && setUp) {
      onValue(result.value)
    }
  }

  function processNode({
    node,
    nodeValue,
    nodeParent,
    nodeParentSnap,
    onNodeValue,
  }: {
    node: FirestoreNode
    nodeValue: any
    nodeParent: FirestoreNode | null | undefined
    nodeParentSnap: DocumentSnapshot | null | undefined
    onNodeValue: (valueNode: FirestoreNode, value: any) => void
  }) {
    if (node.collection != null && Array.isArray(nodeValue)) {
      const arrayValue = new Array(nodeValue.length)
      nodeValue.forEach((nodeValueItem, parentIndex) => {
        arrayValue[parentIndex] = null
        processNode({
          node,
          nodeValue: nodeValueItem,
          nodeParent,
          nodeParentSnap,
          onNodeValue(valueNode, value) {
            if (node === valueNode) {
              arrayValue[parentIndex] = value ?? null
            } else {
              arrayValue[parentIndex][valueNode.alias] = value ?? null
            }
            onNodeValue(node, arrayValue)
          },
        })
      })
      return
    }

    let loaded = false
    function handleValueSet() {
      if (!loaded) {
        loaded = true
        result.loadedRefs += 1
      }
    }

    function handleValueUnset() {
      if (loaded) {
        loaded = false
        result.loadedRefs -= 1
      }
    }

    if (node.collection == null && node.subcollection == null) {
      if (node.children == null || node.children.length === 0) {
        // Leaf node
        onNodeValue(node, nodeValue)
        return
      }
      result.totalRefs += 1
      const response = executeFirestoreNodes({
        context,
        firestore,
        operationType,
        cache,
        nodes: node.children,
        parentValue: nodeValue,
        onValue(value) {
          handleValueSet()
          onNodeValue(node, value)
        },
        onError,
      })
      cleanup.push(() => {
        response.cleanup()
      })
      return
    }

    result.totalRefs += 1
    let lastResult: ReturnType<typeof executeFirestoreNodes> | null = null
    function handleValue(value: DocumentSnapshot | QuerySnapshot) {
      const isForeginKeyReference = context != null && node.collection
      if (isForeginKeyReference && 'forEach' in value) {
        throw new Error('Unrecognized firestore snapshot signature')
      }

      let newValue: Record<string, any> | null | (Record<string, any> | null)[]
      const snap = 'forEach' in value ? value.docs : value

      if ('forEach' in value) {
        // Collection
        const newValues: (Record<string, any> | null)[] = []
        value.forEach((docSnap) => {
          newValues.push(normalizeFirestoreDoc(docSnap, node))
        })
        newValue = newValues
      } else {
        // Document with foreign key
        newValue = normalizeFirestoreDoc(value, node)
      }

      if ((Array.isArray(newValue) && newValue.length === 0) || node.children == null || node.children.length === 0) {
        handleValueSet()
        onNodeValue(node, newValue)
        return
      }
      if (lastResult != null) {
        lastResult.cleanup()
        lastResult = null
      }
      handleValueUnset()
      lastResult = executeFirestoreNodes({
        context: {
          nodeParent: node,
          nodeParentSnap: snap,
        },
        firestore,
        operationType,
        cache,
        nodes: node.children,
        parentValue: newValue,
        onValue(resolvedValue) {
          handleValueSet()
          onNodeValue(node, resolvedValue)
        },
        onError,
      })
    }

    const ref = getDatabaseRef({
      cache,
      firestore,
      node,
      nodeValue,
      nodeParent,
      nodeParentSnap,
    })
    if (operationType === 'query') {
      if (ref.type === 'document') {
        getDoc(ref).then(handleValue)
      } else {
        getDocs(ref).then(handleValue)
      }
    } else {
      const unlisten =
        ref.type === 'document' ? onSnapshot(ref, handleValue, onError) : onSnapshot(ref, handleValue, onError)
      cleanup.push(() => {
        unlisten()
        if (lastResult) {
          lastResult.cleanup()
        }
      })
    }
  }

  if (parentValue != null && Array.isArray(parentValue)) {
    result.value = new Array(parentValue.length)
    parentValue.forEach((parentValueItem, parentIndex) => {
      result.value[parentIndex] = {}
      nodes.forEach((node) => {
        processNode({
          node,
          nodeValue: parentValueItem[node.name],
          nodeParent: context?.nodeParent,
          nodeParentSnap: context?.nodeParentSnap[parentIndex],
          onNodeValue(valueNode, value) {
            result.value[parentIndex][valueNode.alias] = value ?? null
            notifyValueChange()
          },
        })
      })
    })
  } else if (parentValue != null) {
    result.value = {}
    nodes.forEach((node) => {
      processNode({
        node,
        nodeValue: parentValue[node.name],
        nodeParent: context?.nodeParent,
        nodeParentSnap: context?.nodeParentSnap,
        onNodeValue(valueNode, value) {
          result.value[valueNode.alias] = value ?? null
          notifyValueChange()
        },
      })
    })
  }

  setUp = true
  if (result.loadedRefs === result.totalRefs) {
    onValue(result.value)
  }

  return result
}
