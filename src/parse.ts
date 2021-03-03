import { Operation } from 'apollo-link'
import type {
  OperationDefinitionNode,
  SelectionNode,
  ValueNode,
  FragmentDefinitionNode,
  DirectiveNode,
} from 'graphql/language/ast'

import { FirestoreNode } from './types'

function getDirective({ selection, name }: { selection: SelectionNode; name: string }): DirectiveNode | null {
  return (
    selection.directives?.find(
      (item) => item.kind === 'Directive' && item.name.kind === 'Name' && item.name.value === name,
    ) ?? null
  )
}

function getArgumentValue({ arg, operation }: { arg: ValueNode; operation: Operation }): any {
  if (arg.kind === 'Variable') {
    const value = operation.variables[arg.name.value]
    if (typeof value === 'undefined') {
      throw new Error(`Use of undefined variable: ${arg.name.value}`)
    }

    return value == null ? null : value
  }

  // Only process literal values
  if (arg.kind === 'StringValue') {
    return arg.value
  }
  if (arg.kind === 'BooleanValue') {
    return arg.value
  }
  if (arg.kind === 'IntValue') {
    return parseInt(arg.value, 10)
  }
  if (arg.kind === 'FloatValue') {
    return parseFloat(arg.value)
  }
  if (arg.kind === 'ListValue') {
    return arg.values.map((item) => getArgumentValue({ arg: item, operation }))
  }

  return null
}

function getDirectiveValue({
  operation,
  directive,
  key,
}: {
  operation: Operation
  directive: DirectiveNode
  key: string
}): any | null {
  if (key == null) {
    return true
  }

  if (directive.arguments == null) {
    return null
  }

  const directiveArg = directive.arguments.find((item) => item.kind === 'Argument' && item.name.value === key)

  if (directiveArg == null) {
    return null
  }

  return getArgumentValue({
    arg: directiveArg.value,
    operation,
  })
}

function processGqlSelection({
  selection,
  operation,
  fragmentsMap,
}: {
  selection: SelectionNode
  operation: Operation
  fragmentsMap: Map<string, FragmentDefinitionNode>
}): FirestoreNode | null {
  // TODO: Support nested fragments
  if (selection.kind !== 'Field') {
    return null
  }

  const directive = getDirective({
    selection,
    name: 'firestore',
  })

  const firestoreNode: FirestoreNode = {
    __cache_key: '',
    name: selection.name.value,
    alias: '',
    children: null,

    collection:
      directive != null
        ? getDirectiveValue({
            operation,
            directive,
            key: 'collection',
          })
        : null,
    subcollection:
      directive != null
        ? getDirectiveValue({
            operation,
            directive,
            key: 'subcollection',
          })
        : null,

    variables:
      directive != null
        ? {
            limit: getDirectiveValue({
              operation,
              directive,
              key: 'limit',
            }),
            limitToLast: getDirectiveValue({
              operation,
              directive,
              key: 'limitToLast',
            }),
            order: getDirectiveValue({
              operation,
              directive,
              key: 'order',
            }),
            where: getDirectiveValue({
              operation,
              directive,
              key: 'where',
            }),
          }
        : null,
  }

  firestoreNode.__cache_key = JSON.stringify(firestoreNode)
  firestoreNode.alias = selection.alias != null ? selection.alias.value : selection.name.value
  // ^ Exclude alias from caching key

  if (selection.selectionSet != null) {
    const children: FirestoreNode[] = []
    selection.selectionSet.selections.forEach((childSelection) => {
      let selections: SelectionNode[] | ReadonlyArray<SelectionNode>
      if (childSelection.kind === 'FragmentSpread') {
        const fragmentName = childSelection.name.value
        const fragment = fragmentsMap.get(fragmentName)
        if (fragment == null) {
          throw new Error(`Fragment '${fragmentName}' not found`)
        }

        selections = fragment.selectionSet.selections
      } else if (childSelection.kind === 'InlineFragment') {
        selections = childSelection.selectionSet.selections
      } else {
        selections = [childSelection]
      }

      selections.forEach((childSelectionItem) => {
        const childNode = processGqlSelection({
          operation,
          selection: childSelectionItem,
          fragmentsMap,
        })
        if (childNode != null) {
          children.push(childNode)
        }
      })
    })

    if (children.length > 0) {
      firestoreNode.children = children
    }
  }

  return firestoreNode
}

export default function parse({
  operation,
  query,
}: {
  operation: Operation
  query: OperationDefinitionNode
}): FirestoreNode[] {
  const tree: FirestoreNode[] = []
  const fragmentsMap: Map<string, FragmentDefinitionNode> = new Map()

  operation.query.definitions.forEach((item) => {
    if (item.kind !== 'FragmentDefinition') {
      return
    }

    fragmentsMap.set(item.name.value, item)
  })

  query.selectionSet.selections.forEach((selection) => {
    const firestoreNode = processGqlSelection({
      operation,
      selection,
      fragmentsMap,
    })
    if (firestoreNode != null) {
      tree.push(firestoreNode)
    }
  })

  return tree
}
