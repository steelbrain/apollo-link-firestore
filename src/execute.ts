/* eslint-disable no-param-reassign,no-underscore-dangle */

import type firebase from 'firebase'

import { FirestoreNode, OperationType } from './types'

function normalizeFirestoreDoc(
  document: firebase.firestore.DocumentSnapshot,
  node: FirestoreNode,
): Record<string, any> | null {
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
  firestore: firebase.firestore.Firestore
  node: FirestoreNode
  nodeValue: any
  nodeParent: FirestoreNode | null | undefined
  nodeParentSnap: firebase.firestore.DocumentSnapshot | null | undefined
}) {
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

  let ref: any
  if (node.subcollection != null) {
    if (nodeParent == null || nodeParentSnap == null) {
      throw new Error('context not found')
    }
    ref = nodeParentSnap.ref.collection(node.subcollection)
  } else if (node.collection != null) {
    ref = firestore.collection(node.collection)
    if (nodeParent != null) {
      ref = ref.doc(`${nodeValue}`)
    }
  } else {
    throw new Error('Ref not found')
  }
  if (node.variables != null) {
    const { order, where, limit, limitToLast } = node.variables
    if (order != null) {
      ref = ref.orderBy(order[0], order[1])
    }
    if (where != null) {
      where.forEach((whereItem) => {
        ref = ref.where(whereItem[0], whereItem[1], whereItem[2])
      })
    }
    if (limit != null) {
      ref = ref.limit(limit)
    }
    if (limitToLast != null) {
      ref = ref.limitToLast(limitToLast)
    }
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
}: {
  context: { nodeParent: FirestoreNode; nodeParentSnap: any } | null
  firestore: firebase.firestore.Firestore
  nodes: FirestoreNode[]
  parentValue: any | null
  operationType: OperationType
  cache: Map<string, any>
  onValue: (value: any) => void
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
    nodeParentSnap: firebase.firestore.DocumentSnapshot | null | undefined
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
      })
      cleanup.push(() => {
        response.cleanup()
      })
      return
    }

    result.totalRefs += 1
    let lastResult: ReturnType<typeof executeFirestoreNodes> | null = null
    function handleValue(value: firebase.firestore.QuerySnapshot | firebase.firestore.QueryDocumentSnapshot) {
      const isForeginKeyReference = context != null && node.collection
      if (isForeginKeyReference && 'forEach' in value) {
        throw new Error('Unrecognized firestore snapshot signature')
      }

      let newValue: Record<string, any> | null | (Record<string, any> | null)[]
      const snap = 'forEach' in value ? value.docs : value

      if ('forEach' in value) {
        // Collection
        const newValues: (Record<string, any> | null)[] = []
        value.forEach((doc) => {
          newValues.push(normalizeFirestoreDoc(doc, node))
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
      ref.get().then(handleValue)
    } else {
      const unlisten = ref.onSnapshot(handleValue)
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
