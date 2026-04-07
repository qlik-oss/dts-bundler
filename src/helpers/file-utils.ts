import { type Node, type SourceFile, isSourceFile } from "typescript";

/**
 * Attempt to get the SourceFile node from any given node by traversing up the parent chain.
 * @param node - The starting node from which to attempt to find the SourceFile
 * @returns The SourceFile node if found, otherwise null
 */
export function tryGetSourceFile(node: Node): SourceFile | null {
  let current: Node | undefined = node;

  while (current) {
    if (isSourceFile(current)) {
      return current;
    }

    current = (current as Omit<Node, "parent"> & { parent?: Node }).parent;
  }

  return null;
}
