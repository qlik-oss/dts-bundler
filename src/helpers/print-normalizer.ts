import ts from "typescript";

type NormalizeOptions = {
  preserveJsDoc?: boolean;
};

function normalizeIndentation(text: string): string {
  const lines = text.split("\n");
  const normalized = lines.map((line) => {
    const match = line.match(/^(\s*)/);
    const indent = match?.[1] ?? "";
    const spaces = indent.replace(/\t/g, "  ");
    const normalizedIndentSize = spaces.length < 2 ? spaces.length : Math.floor(spaces.length / 2);
    const normalizedIndent = " ".repeat(normalizedIndentSize);
    const content = line.slice(indent.length);
    return `${normalizedIndent}${content}`;
  });

  return normalized.join("\n");
}

function collapseEmptyBlocks(text: string): string {
  return text.replace(/\{\n\s*\}/g, "{}");
}

function collapseSimpleTypeLiterals(text: string, originalText?: string): string {
  if (originalText && originalText.includes("\n")) {
    return text;
  }

  return text.replace(/\{\n([\s\S]*?)\n\s*\}/g, (match, body) => {
    const lines = body
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);

    if (lines.length === 0) {
      return "{}";
    }

    const isSimple = lines.every((line: string) => /^[A-Za-z_$][\w$]*\??\s*:\s*.+;$/.test(line));
    if (!isSimple) {
      return match;
    }

    const normalizedLines = lines.map((line: string, index: number) => {
      if (index === lines.length - 1) {
        return line.replace(/;$/, "");
      }
      return line;
    });

    return `{ ${normalizedLines.join(" ")} }`;
  });
}

function collapseGenericArguments(text: string): string {
  return text.replace(/<([\s\S]*?)>/g, (match, body) => {
    if (!body.includes("\n")) {
      return match;
    }
    const flattened = body.replace(/\s*\n\s*/g, " ");
    return `<${flattened}>`;
  });
}

function stripLeadingJsDoc(text: string): string {
  return text.replace(/^(?:\s*\/\*\*[\s\S]*?\*\/\s*\n)*/, "");
}

function stripLeadingNonJsDoc(text: string): string {
  return text.replace(/^(?:\s*\/\/[^\n]*\n|\s*\/\*(?!\*)[\s\S]*?\*\/\s*\n)*/, "");
}

function stripLeadingAllComments(text: string): string {
  return text.replace(/^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*\n)*/, "");
}

export function normalizePrintedStatement(
  text: string,
  node: ts.Node,
  originalText?: string,
  options: NormalizeOptions = {},
): string {
  const preserveJsDoc = options.preserveJsDoc ?? true;
  let result = text.replace(/\t/g, "  ");
  result = normalizeIndentation(result);
  result = collapseGenericArguments(result);
  result = result.replace(/<([^>]*?)\n\s*([^>]*?)>/g, (match, first, second) => {
    return `<${String(first).trim()} ${String(second).trim()}>`;
  });

  if (!preserveJsDoc) {
    result = stripLeadingJsDoc(result);
  }

  if (ts.isVariableStatement(node) && originalText && /,\s*\n/.test(originalText)) {
    result = result.replace(/,\s+/g, ",\n  ");
  }

  if (ts.isVariableStatement(node)) {
    result = preserveJsDoc ? stripLeadingNonJsDoc(result) : stripLeadingAllComments(result);
    result = result.replace(/:\s*([^;]+);/g, (match, typeText) => {
      const collapsed = String(typeText)
        .replace(/\s*\n\s*/g, " ")
        .trim();
      return `: ${collapsed};`;
    });
    result = result.replace(/\{\s*([A-Za-z_$][\w$]*\??\s*:\s*[^;{}]+)\s*;\s*\}/g, "{ $1 }");
  }

  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) {
    result = collapseEmptyBlocks(result);
  }

  if (ts.isModuleDeclaration(node)) {
    result = preserveJsDoc ? stripLeadingNonJsDoc(result) : stripLeadingAllComments(result);
    if (originalText) {
      const header = originalText.split("{")[0] ?? originalText;
      const isDeclareModule = /\bdeclare\s+module\b/.test(header);
      const isNamespace = /\bnamespace\b/.test(header);
      const isModule = /\bmodule\b/.test(header);
      if (!isDeclareModule && isModule && !isNamespace) {
        result = result.replace(/^(\s*(?:export\s+)?(?:declare\s+)?)(module)(\b)/, "$1namespace$3");
      }
    }
    result = collapseEmptyBlocks(result);
  }

  if (ts.isEnumDeclaration(node)) {
    const printedBody = result.split("{")[1] ?? "";
    if (printedBody.includes("\n")) {
      result = result.replace(/(^\s*[^\n{}]+)(\n)(?=\s*(?:[^\n{}]|\}))/gm, (match, line, newline) => {
        const trimmed = String(line).trim();
        if (trimmed.length === 0) {
          return match;
        }
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("/*") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("*/")
        ) {
          return match;
        }
        if (trimmed.endsWith(",") || trimmed.endsWith("{") || trimmed.endsWith("}")) {
          return match;
        }
        return `${line},${newline}`;
      });
    }
  }

  if (ts.isTypeAliasDeclaration(node)) {
    result = collapseSimpleTypeLiterals(result, originalText);
  }

  return result;
}
