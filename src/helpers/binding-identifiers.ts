import ts from "typescript";

export const collectBindingIdentifiersFromName = (name: ts.BindingName): ts.Identifier[] => {
  const identifiers: ts.Identifier[] = [];

  const visitBindingName = (bindingName: ts.BindingName): void => {
    if (ts.isIdentifier(bindingName)) {
      identifiers.push(bindingName);
      return;
    }

    if (ts.isObjectBindingPattern(bindingName)) {
      for (const element of bindingName.elements) {
        visitBindingName(element.name);
      }
      return;
    }

    if (ts.isArrayBindingPattern(bindingName)) {
      for (const element of bindingName.elements) {
        if (ts.isOmittedExpression(element)) {
          continue;
        }
        visitBindingName(element.name);
      }
    }
  };

  visitBindingName(name);
  return identifiers;
};

export const collectBindingElementsFromDeclarations = (
  declarations: ts.NodeArray<ts.VariableDeclaration>,
): Array<{ identifier: ts.Identifier; element: ts.BindingElement }> => {
  const identifiers: Array<{ identifier: ts.Identifier; element: ts.BindingElement }> = [];

  const visitBindingElement = (element: ts.BindingElement): void => {
    if (ts.isIdentifier(element.name)) {
      identifiers.push({ identifier: element.name, element });
      return;
    }

    if (ts.isObjectBindingPattern(element.name)) {
      for (const child of element.name.elements) {
        visitBindingElement(child);
      }
      return;
    }

    if (ts.isArrayBindingPattern(element.name)) {
      for (const child of element.name.elements) {
        if (ts.isOmittedExpression(child)) {
          continue;
        }
        visitBindingElement(child);
      }
    }
  };

  for (const decl of declarations) {
    if (ts.isIdentifier(decl.name)) {
      continue;
    }

    if (ts.isObjectBindingPattern(decl.name)) {
      for (const element of decl.name.elements) {
        visitBindingElement(element);
      }
    } else if (ts.isArrayBindingPattern(decl.name)) {
      for (const element of decl.name.elements) {
        if (ts.isOmittedExpression(element)) {
          continue;
        }
        visitBindingElement(element);
      }
    }
  }

  return identifiers;
};

export const hasBindingPatternInitializer = (declarations: ts.NodeArray<ts.VariableDeclaration>): boolean => {
  const visitBindingElement = (element: ts.BindingElement): boolean => {
    if (element.initializer) {
      return true;
    }

    if (ts.isObjectBindingPattern(element.name)) {
      return element.name.elements.some(visitBindingElement);
    }

    if (ts.isArrayBindingPattern(element.name)) {
      return element.name.elements.some((child) => !ts.isOmittedExpression(child) && visitBindingElement(child));
    }

    return false;
  };

  return declarations.some((decl) => {
    if (ts.isIdentifier(decl.name)) {
      return false;
    }

    if (ts.isObjectBindingPattern(decl.name)) {
      return decl.name.elements.some(visitBindingElement);
    }

    if (ts.isArrayBindingPattern(decl.name)) {
      return decl.name.elements.some((child) => !ts.isOmittedExpression(child) && visitBindingElement(child));
    }

    return false;
  });
};
