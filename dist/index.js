#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

//#region src/declaration-utils.ts
function isDeclaration(statement) {
	return ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement);
}
function getDeclarationName(statement) {
	if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isFunctionDeclaration(statement)) return statement.name?.text ?? null;
	if (ts.isVariableStatement(statement)) {
		const declaration = statement.declarationList.declarations[0];
		if (ts.isIdentifier(declaration.name)) return declaration.name.text;
		if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) return `__binding_${statement.pos}`;
	}
	return null;
}
function hasExportModifier(statement) {
	return (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : void 0)?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}
function hasDefaultModifier(statement) {
	return (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : void 0)?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}
function isDeclareGlobal(statement) {
	return ts.isModuleDeclaration(statement) && (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
}

//#endregion
//#region src/types.ts
let ExportKind = /* @__PURE__ */ function(ExportKind) {
	ExportKind["NotExported"] = "NOT_EXPORTED";
	ExportKind["Named"] = "NAMED";
	ExportKind["Default"] = "DEFAULT";
	ExportKind["DefaultOnly"] = "DEFAULT_ONLY";
	ExportKind["Equals"] = "EQUALS";
	return ExportKind;
}({});
var TypeDeclaration = class {
	id;
	name;
	normalizedName;
	sourceFile;
	node;
	sourceFileNode;
	exportInfo;
	dependencies;
	externalDependencies;
	namespaceDependencies;
	variableDeclaration;
	text;
	constructor(name, sourceFilePath, node, sourceFileNode, exportInfo) {
		this.id = Symbol(name);
		this.name = name;
		this.normalizedName = name;
		this.sourceFile = sourceFilePath;
		this.node = node;
		this.sourceFileNode = sourceFileNode;
		this.exportInfo = exportInfo;
		this.dependencies = /* @__PURE__ */ new Set();
		this.externalDependencies = /* @__PURE__ */ new Map();
		this.namespaceDependencies = /* @__PURE__ */ new Set();
		this.text = null;
	}
	getText() {
		if (this.text) return this.text;
		let text = this.node.getFullText(this.sourceFileNode);
		const lines = text.split("\n");
		if (lines.length > 0) {
			let minIndent = Infinity;
			for (const line of lines) {
				if (line.trim().length === 0) continue;
				const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
				if (indent < minIndent) minIndent = indent;
			}
			if (minIndent > 0 && minIndent !== Infinity) text = lines.map((line) => {
				if (line.trim().length === 0) return "";
				return line.substring(minIndent);
			}).join("\n").trim();
			else text = text.trim();
		} else text = text.trim();
		text = text.replace(/\t/g, "  ");
		this.text = text;
		return this.text;
	}
};
var ExternalImport = class {
	moduleName;
	originalName;
	normalizedName;
	isTypeOnly;
	constructor(moduleName, importName, isTypeOnly = false) {
		this.moduleName = moduleName;
		this.originalName = importName;
		this.normalizedName = importName;
		this.isTypeOnly = isTypeOnly;
	}
};

//#endregion
//#region src/declaration-collector.ts
var DeclarationCollector = class {
	registry;
	fileCollector;
	options;
	constructor(registry, fileCollector, options) {
		this.registry = registry;
		this.fileCollector = fileCollector;
		this.options = options;
	}
	collectDeclarations(filePath, sourceFile, isEntry, onDefaultExportName) {
		for (const statement of sourceFile.statements) {
			if (!isDeclaration(statement)) continue;
			if (ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name) && statement.body && ts.isModuleBlock(statement.body)) {
				this.parseAmbientModule(statement, filePath, sourceFile);
				continue;
			}
			this.parseDeclaration(statement, filePath, sourceFile, isEntry, onDefaultExportName);
		}
	}
	parseAmbientModule(moduleDecl, filePath, sourceFile) {
		if (!moduleDecl.body || !ts.isModuleBlock(moduleDecl.body)) return;
		const moduleName = moduleDecl.name.text;
		if (!this.fileCollector.shouldInline(moduleName)) return;
		for (const statement of moduleDecl.body.statements) {
			if (!isDeclaration(statement)) continue;
			const name = getDeclarationName(statement);
			if (!name) continue;
			const hasExport = hasExportModifier(statement);
			const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, {
				kind: hasExport ? ExportKind.Named : ExportKind.NotExported,
				wasOriginallyExported: hasExport
			});
			this.registry.register(declaration);
		}
	}
	parseDeclaration(statement, filePath, sourceFile, isEntry, onDefaultExportName) {
		if (isDeclareGlobal(statement) && !this.options.inlineDeclareGlobals) return;
		if (ts.isVariableStatement(statement)) {
			this.parseVariableStatement(statement, filePath, sourceFile, isEntry);
			return;
		}
		const name = getDeclarationName(statement);
		if (!name) return;
		const hasExport = hasExportModifier(statement);
		const hasDefaultExport = hasDefaultModifier(statement);
		const declareGlobal = isDeclareGlobal(statement);
		let isExported = isEntry ? hasExport : false;
		let wasOriginallyExported = this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported;
		if (declareGlobal && this.options.inlineDeclareGlobals) {
			isExported = true;
			wasOriginallyExported = true;
		}
		const exportInfo = {
			kind: isExported ? ExportKind.Named : ExportKind.NotExported,
			wasOriginallyExported
		};
		if (isEntry && hasDefaultExport) {
			exportInfo.kind = ExportKind.Default;
			onDefaultExportName(name);
		}
		const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, exportInfo);
		this.registry.register(declaration);
	}
	parseVariableStatement(statement, filePath, sourceFile, isEntry) {
		const declarations = statement.declarationList.declarations;
		const hasBindingPattern = declarations.some((decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name));
		const hasExport = hasExportModifier(statement);
		const declareGlobal = isDeclareGlobal(statement);
		if (hasBindingPattern) {
			const name = `__binding_${statement.pos}`;
			let isExported = isEntry ? hasExport : false;
			let wasOriginallyExported = this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported;
			if (declareGlobal && this.options.inlineDeclareGlobals) {
				isExported = true;
				wasOriginallyExported = true;
			}
			const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, {
				kind: isExported ? ExportKind.Named : ExportKind.NotExported,
				wasOriginallyExported
			});
			this.registry.register(declaration);
			return;
		}
		for (const varDecl of declarations) {
			if (!ts.isIdentifier(varDecl.name)) continue;
			const name = varDecl.name.text;
			let isExported = isEntry ? hasExport : false;
			let wasOriginallyExported = this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported;
			if (declareGlobal && this.options.inlineDeclareGlobals) {
				isExported = true;
				wasOriginallyExported = true;
			}
			const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, {
				kind: isExported ? ExportKind.Named : ExportKind.NotExported,
				wasOriginallyExported
			});
			declaration.variableDeclaration = varDecl;
			this.registry.register(declaration);
		}
	}
};

//#endregion
//#region src/export-resolver.ts
var ExportResolver = class {
	registry;
	fileCollector;
	constructor(registry, fileCollector) {
		this.registry = registry;
		this.fileCollector = fileCollector;
	}
	handleExportAssignments(filePath, sourceFile, isEntry, importMap, onEntryExportEquals, onEntryExportDefault) {
		for (const statement of sourceFile.statements) {
			if (!ts.isExportAssignment(statement)) continue;
			if (statement.isExportEquals) {
				if (isEntry) onEntryExportEquals(statement);
				this.parseExportEquals(statement, filePath, isEntry, importMap);
				continue;
			}
			if (isEntry) {
				onEntryExportDefault(statement);
				this.parseExportDefault(statement, filePath);
			}
		}
	}
	parseReExports(filePath, sourceFile, importMap, onEntryExportDefaultName) {
		for (const statement of sourceFile.statements) {
			if (!ts.isExportDeclaration(statement)) continue;
			if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
			if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
				const importPath = statement.moduleSpecifier.text;
				if (!this.fileCollector.shouldInline(importPath)) continue;
				const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
				if (!resolvedPath) continue;
				for (const element of statement.exportClause.elements) {
					const exportedName = element.name.text;
					const originalName = element.propertyName?.text || exportedName;
					let resolvedOriginalName = originalName;
					if (originalName === "default") {
						const defaultExportName = this.resolveDefaultExportName(resolvedPath);
						if (!defaultExportName) continue;
						resolvedOriginalName = defaultExportName;
					}
					const key = `${resolvedPath}:${resolvedOriginalName}`;
					const declarationId = this.registry.nameIndex.get(key);
					if (declarationId) {
						const declaration = this.registry.getDeclaration(declarationId);
						if (declaration) {
							const isDefaultExport = exportedName === "default";
							declaration.exportInfo = {
								kind: isDefaultExport ? ExportKind.Default : ExportKind.Named,
								wasOriginallyExported: !isDefaultExport
							};
							if (isDefaultExport) onEntryExportDefaultName?.(resolvedOriginalName);
						}
					}
				}
			} else {
				const fileImports = importMap.get(filePath);
				for (const element of statement.exportClause.elements) {
					const exportedName = element.name.text;
					const originalName = element.propertyName?.text || exportedName;
					const importInfo = fileImports?.get(originalName);
					let key;
					if (importInfo && !importInfo.isExternal && importInfo.sourceFile) key = `${importInfo.sourceFile}:${importInfo.originalName}`;
					else key = `${filePath}:${originalName}`;
					const declarationId = this.registry.nameIndex.get(key);
					if (declarationId) {
						const declaration = this.registry.getDeclaration(declarationId);
						if (declaration) declaration.exportInfo = {
							kind: ExportKind.Named,
							wasOriginallyExported: true
						};
					}
				}
			}
		}
	}
	resolveDefaultExportName(resolvedPath) {
		const sourceFile = this.fileCollector.getProgram().getSourceFile(resolvedPath);
		if (!sourceFile) return null;
		for (const statement of sourceFile.statements) {
			if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
			if (ts.isIdentifier(statement.expression)) return statement.expression.text;
		}
		for (const statement of sourceFile.statements) {
			if (!hasDefaultModifier(statement)) continue;
			const name = getDeclarationName(statement);
			if (name) return name;
		}
		return null;
	}
	static resolveExportEquals(filePath, sourceFile, importMap) {
		let exportedName = null;
		for (const statement of sourceFile.statements) if (ts.isExportAssignment(statement) && statement.isExportEquals) {
			if (ts.isIdentifier(statement.expression)) {
				exportedName = statement.expression.text;
				break;
			}
		}
		if (!exportedName) return;
		for (const fileImports of importMap.values()) for (const importInfo of fileImports.values()) if (!importInfo.isExternal && importInfo.sourceFile === filePath) importInfo.originalName = exportedName;
	}
	parseExportEquals(statement, filePath, isEntry, importMap) {
		if (!ts.isIdentifier(statement.expression)) return;
		const exportedName = statement.expression.text;
		const importInfo = importMap.get(filePath)?.get(exportedName);
		let key;
		let targetFilePath;
		let targetName;
		if (importInfo && !importInfo.isExternal && importInfo.sourceFile) {
			targetFilePath = importInfo.sourceFile;
			targetName = importInfo.originalName;
			key = `${targetFilePath}:${targetName}`;
		} else {
			targetFilePath = filePath;
			targetName = exportedName;
			key = `${filePath}:${exportedName}`;
		}
		const declarationId = this.registry.nameIndex.get(key);
		if (!declarationId) return;
		const declaration = this.registry.getDeclaration(declarationId);
		if (!declaration) return;
		if (isEntry) declaration.exportInfo = {
			kind: ExportKind.Equals,
			wasOriginallyExported: declaration.exportInfo.wasOriginallyExported
		};
		else declaration.exportInfo = {
			kind: declaration.exportInfo.kind,
			wasOriginallyExported: true
		};
	}
	parseExportDefault(statement, filePath) {
		const expression = statement.expression;
		if ((ts.isClassDeclaration(expression) || ts.isFunctionDeclaration(expression) || ts.isInterfaceDeclaration(expression) || ts.isEnumDeclaration(expression)) && expression.name) {
			const name = expression.name.text;
			const hasExport = hasExportModifier(expression);
			const exportInfo = {
				kind: ExportKind.Default,
				wasOriginallyExported: hasExport
			};
			const declaration = new TypeDeclaration(name, filePath, expression, statement.getSourceFile(), exportInfo);
			this.registry.register(declaration);
			return;
		}
		if (ts.isIdentifier(expression)) {
			const key = `${filePath}:${expression.text}`;
			const declarationId = this.registry.nameIndex.get(key);
			if (declarationId) {
				const declaration = this.registry.getDeclaration(declarationId);
				if (declaration) declaration.exportInfo = {
					kind: declaration.exportInfo.kind !== ExportKind.NotExported || declaration.exportInfo.wasOriginallyExported ? ExportKind.Default : ExportKind.DefaultOnly,
					wasOriginallyExported: declaration.exportInfo.wasOriginallyExported
				};
			}
		}
	}
};

//#endregion
//#region src/import-parser.ts
var ImportParser = class {
	registry;
	fileCollector;
	constructor(registry, fileCollector) {
		this.registry = registry;
		this.fileCollector = fileCollector;
	}
	parseImports(filePath, sourceFile) {
		const fileImports = /* @__PURE__ */ new Map();
		for (const statement of sourceFile.statements) if (ts.isImportDeclaration(statement)) this.parseImport(statement, filePath, fileImports);
		else if (ts.isImportEqualsDeclaration(statement)) this.parseImportEquals(statement, filePath, fileImports);
		for (const statement of sourceFile.statements) if (ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name) && statement.body && ts.isModuleBlock(statement.body)) {
			const moduleName = statement.name.text;
			if (!this.fileCollector.shouldInline(moduleName)) continue;
			for (const moduleStatement of statement.body.statements) if (ts.isImportDeclaration(moduleStatement)) this.parseImport(moduleStatement, filePath, fileImports);
			else if (ts.isImportEqualsDeclaration(moduleStatement)) this.parseImportEquals(moduleStatement, filePath, fileImports);
		}
		return fileImports;
	}
	parseImport(statement, filePath, fileImports) {
		const moduleSpecifier = statement.moduleSpecifier;
		if (!ts.isStringLiteral(moduleSpecifier)) return;
		const importPath = moduleSpecifier.text;
		const isTypeOnly = statement.importClause?.isTypeOnly ?? false;
		if (this.fileCollector.shouldInline(importPath)) {
			const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
			if (!resolvedPath) return;
			const importClause = statement.importClause;
			if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) for (const element of importClause.namedBindings.elements) {
				const localName = element.name.text;
				const originalName = element.propertyName?.text || localName;
				fileImports.set(localName, {
					originalName,
					sourceFile: resolvedPath,
					isExternal: false,
					aliasName: localName !== originalName ? localName : null
				});
			}
			if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
				const localName = importClause.namedBindings.name.text;
				fileImports.set(localName, {
					originalName: `* as ${localName}`,
					sourceFile: resolvedPath,
					isExternal: false,
					aliasName: null
				});
				const key = `${filePath}:${localName}`;
				this.registry.namespaceImports.set(key, {
					namespaceName: localName,
					sourceFile: resolvedPath
				});
			}
			if (importClause?.name) {
				const localName = importClause.name.text;
				fileImports.set(localName, {
					originalName: "default",
					sourceFile: resolvedPath,
					isExternal: false,
					aliasName: null
				});
			}
		} else {
			const moduleName = importPath;
			if (statement.importClause?.name) {
				const localName = statement.importClause.name.text;
				fileImports.set(localName, {
					originalName: `default as ${localName}`,
					sourceFile: moduleName,
					isExternal: true,
					aliasName: null
				});
				this.registry.registerExternal(moduleName, `default as ${localName}`, isTypeOnly);
			}
			if (statement.importClause?.namedBindings) {
				if (ts.isNamedImports(statement.importClause.namedBindings)) for (const element of statement.importClause.namedBindings.elements) {
					const localName = element.name.text;
					const originalName = element.propertyName?.text || localName;
					const importName = localName !== originalName ? `${originalName} as ${localName}` : localName;
					fileImports.set(localName, {
						originalName: importName,
						sourceFile: moduleName,
						isExternal: true,
						aliasName: localName !== originalName ? localName : null
					});
					this.registry.registerExternal(moduleName, importName, isTypeOnly);
				}
				else if (ts.isNamespaceImport(statement.importClause.namedBindings)) {
					const localName = statement.importClause.namedBindings.name.text;
					fileImports.set(localName, {
						originalName: `* as ${localName}`,
						sourceFile: moduleName,
						isExternal: true,
						aliasName: null
					});
					this.registry.registerExternal(moduleName, `* as ${localName}`, isTypeOnly);
				}
			}
		}
	}
	parseImportEquals(statement, filePath, fileImports) {
		if (!ts.isExternalModuleReference(statement.moduleReference)) return;
		const moduleSpecifier = statement.moduleReference.expression;
		if (!ts.isStringLiteral(moduleSpecifier)) return;
		const importPath = moduleSpecifier.text;
		const importName = statement.name.text;
		const isTypeOnly = statement.isTypeOnly;
		if (this.fileCollector.shouldInline(importPath)) {
			const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
			if (!resolvedPath) return;
			fileImports.set(importName, {
				originalName: importName,
				sourceFile: resolvedPath,
				isExternal: false,
				aliasName: null
			});
		} else {
			fileImports.set(importName, {
				originalName: `= ${importName}`,
				sourceFile: importPath,
				isExternal: true,
				aliasName: null
			});
			this.registry.registerExternal(importPath, `= ${importName}`, isTypeOnly);
		}
	}
};

//#endregion
//#region src/declaration-parser.ts
var DeclarationParser = class {
	importMap;
	entryExportEquals = null;
	entryExportDefaultName = null;
	entryExportDefault = null;
	registry;
	fileCollector;
	options;
	importParser;
	declarationCollector;
	exportResolver;
	constructor(registry, fileCollector, options) {
		this.registry = registry;
		this.fileCollector = fileCollector;
		this.importMap = /* @__PURE__ */ new Map();
		this.options = { inlineDeclareGlobals: options?.inlineDeclareGlobals ?? false };
		this.importParser = new ImportParser(registry, fileCollector);
		this.declarationCollector = new DeclarationCollector(registry, fileCollector, this.options);
		this.exportResolver = new ExportResolver(registry, fileCollector);
	}
	parseFiles(files) {
		for (const [filePath, { sourceFile }] of files.entries()) {
			const fileImports = this.importParser.parseImports(filePath, sourceFile);
			this.importMap.set(filePath, fileImports);
		}
		for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
			this.declarationCollector.collectDeclarations(filePath, sourceFile, isEntry, (name) => {
				this.entryExportDefaultName = name;
			});
			this.exportResolver.handleExportAssignments(filePath, sourceFile, isEntry, this.importMap, (statement) => {
				this.entryExportEquals = statement;
			}, (statement) => {
				this.entryExportDefault = statement;
			});
		}
		for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
			if (isEntry) this.exportResolver.parseReExports(filePath, sourceFile, this.importMap, (name) => {
				if (!this.entryExportDefaultName) this.entryExportDefaultName = name;
			});
			ExportResolver.resolveExportEquals(filePath, sourceFile, this.importMap);
		}
	}
};

//#endregion
//#region src/dependency-analyzer.ts
var DependencyAnalyzer = class DependencyAnalyzer {
	registry;
	importMap;
	constructor(registry, importMap) {
		this.registry = registry;
		this.importMap = importMap;
	}
	analyze() {
		this.trackEntryFileAliases();
		for (const declaration of this.registry.declarations.values()) this.analyzeDependencies(declaration);
	}
	trackEntryFileAliases() {
		const entryFiles = /* @__PURE__ */ new Set();
		for (const declaration of this.registry.declarations.values()) if (declaration.exportInfo.kind !== ExportKind.NotExported) entryFiles.add(declaration.sourceFile);
		for (const entryFile of entryFiles) {
			const fileImports = this.importMap.get(entryFile);
			if (!fileImports) continue;
			for (const [, importInfo] of fileImports.entries()) if (!importInfo.isExternal && importInfo.aliasName) {
				const key = `${importInfo.sourceFile}:${importInfo.originalName}`;
				const declId = this.registry.nameIndex.get(key);
				if (declId) {
					const decl = this.registry.getDeclaration(declId);
					if (decl) decl.normalizedName = importInfo.aliasName;
				}
			}
		}
	}
	analyzeDependencies(declaration) {
		const fileImports = this.importMap.get(declaration.sourceFile) ?? /* @__PURE__ */ new Map();
		const references = /* @__PURE__ */ new Set();
		this.extractTypeReferences(declaration.node, references);
		for (const refName of references) {
			const importInfo = fileImports.get(refName);
			if (importInfo) {
				if (!importInfo.isExternal && importInfo.originalName.startsWith("* as ")) {
					declaration.namespaceDependencies.add(refName);
					const sourceFileDecls = this.registry.declarationsByFile.get(importInfo.sourceFile);
					if (sourceFileDecls) for (const declId of sourceFileDecls) declaration.dependencies.add(declId);
				} else if (importInfo.isExternal) {
					const moduleName = importInfo.sourceFile ? importInfo.sourceFile.split(":")[0] : "";
					if (!declaration.externalDependencies.has(moduleName)) declaration.externalDependencies.set(moduleName, /* @__PURE__ */ new Set());
					const importName = importInfo.originalName;
					declaration.externalDependencies.get(moduleName)?.add(importName);
				} else if (importInfo.sourceFile) {
					const key = `${importInfo.sourceFile}:${importInfo.originalName}`;
					const depId = this.registry.nameIndex.get(key);
					if (depId) declaration.dependencies.add(depId);
				}
			} else {
				const localKey = `${declaration.sourceFile}:${refName}`;
				const localId = this.registry.nameIndex.get(localKey);
				if (localId && localId !== declaration.id) declaration.dependencies.add(localId);
			}
		}
	}
	extractTypeReferences(node, references) {
		if (ts.isTypeReferenceNode(node)) {
			const typeName = node.typeName;
			if (ts.isIdentifier(typeName)) references.add(typeName.text);
			else if (ts.isQualifiedName(typeName)) DependencyAnalyzer.extractQualifiedName(typeName, references);
		}
		if (ts.isTypeQueryNode(node)) {
			const exprName = node.exprName;
			if (ts.isIdentifier(exprName)) references.add(exprName.text);
			else if (ts.isQualifiedName(exprName)) DependencyAnalyzer.extractQualifiedName(exprName, references);
		}
		if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer)) references.add(node.initializer.text);
		if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.heritageClauses) {
			for (const clause of node.heritageClauses) for (const type of clause.types) if (ts.isIdentifier(type.expression)) references.add(type.expression.text);
			else if (ts.isPropertyAccessExpression(type.expression)) DependencyAnalyzer.extractPropertyAccess(type.expression, references);
		}
		node.forEachChild((child) => {
			this.extractTypeReferences(child, references);
		});
	}
	static extractQualifiedName(qualifiedName, references) {
		let current = qualifiedName;
		while (ts.isQualifiedName(current)) current = current.left;
		if (ts.isIdentifier(current)) references.add(current.text);
	}
	static extractPropertyAccess(propAccess, references) {
		let current = propAccess;
		while (ts.isPropertyAccessExpression(current)) current = current.expression;
		if (ts.isIdentifier(current)) references.add(current.text);
	}
};

//#endregion
//#region src/helpers/node-modules.ts
/**
* Helper functions for working with node_modules paths and library names
* Ported from dts-bundle-generator
*/
const nodeModulesFolderName = "node_modules/";
const libraryNameRegex = /node_modules\/((?:(?=@)[^/]+\/[^/]+|[^/]+))\//;
/**
* Extract library name from a file path that contains node_modules
* @param fileName - File path that may contain node_modules
* @returns Library name (e.g., "typescript", "@types/node") or null if not in node_modules
*/
function getLibraryName(fileName) {
	const lastNodeModulesIndex = fileName.lastIndexOf(nodeModulesFolderName);
	if (lastNodeModulesIndex === -1) return null;
	const match = libraryNameRegex.exec(fileName.slice(lastNodeModulesIndex));
	if (match === null) return null;
	return match[1];
}

//#endregion
//#region src/helpers/typescript-config.ts
const parseConfigHost = {
	useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
	readDirectory: ts.sys.readDirectory,
	fileExists: ts.sys.fileExists,
	readFile: ts.sys.readFile
};
/**
* Find tsconfig.json for a given input file by walking up the directory tree
* @param inputFile - The input TypeScript file
* @returns Path to the tsconfig.json file
*/
function findTsConfig(inputFile) {
	const absolutePath = path.resolve(inputFile);
	let currentDir = path.dirname(absolutePath);
	while (true) {
		const configPath = path.join(currentDir, "tsconfig.json");
		if (fs.existsSync(configPath)) return configPath;
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) throw new Error(`Cannot find tsconfig.json for file: ${inputFile}`);
		currentDir = parentDir;
	}
}
/**
* Get TypeScript compiler options from a tsconfig file
* @param configPath - Path to tsconfig.json
* @returns Parsed compiler options
*/
function getCompilerOptions(configPath) {
	const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
	if (configFile.error) throw new Error(`Error reading tsconfig.json: ${configFile.error.messageText}`);
	const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, parseConfigHost, path.dirname(configPath), void 0, configPath);
	if (parsedConfig.errors.length > 0) {
		const errors = parsedConfig.errors.filter((d) => d.code !== 18003).map((d) => d.messageText).join("\n");
		if (errors) throw new Error(`Error parsing tsconfig.json: ${errors}`);
	}
	return parsedConfig.options;
}

//#endregion
//#region src/file-collector.ts
var FileCollector = class FileCollector {
	inlinedLibraries;
	program;
	typeChecker;
	entryFile;
	inlinedLibrariesSet;
	modulePathCache;
	moduleFilesByLibrary;
	moduleResolveCache;
	constructor(entryFile, options = {}) {
		this.entryFile = path.resolve(entryFile);
		this.inlinedLibraries = options.inlinedLibraries ?? [];
		this.program = this.createProgram();
		this.typeChecker = this.program.getTypeChecker();
		this.inlinedLibrariesSet = this.computeInlinedLibrariesSet();
		this.modulePathCache = /* @__PURE__ */ new Map();
		this.moduleFilesByLibrary = /* @__PURE__ */ new Map();
		this.moduleResolveCache = /* @__PURE__ */ new Map();
		this.buildModuleCaches();
	}
	createProgram() {
		const compilerOptions = getCompilerOptions(findTsConfig(this.entryFile));
		compilerOptions.declaration = true;
		compilerOptions.skipLibCheck = true;
		compilerOptions.skipDefaultLibCheck = true;
		return ts.createProgram([this.entryFile], compilerOptions);
	}
	/**
	* Compute the transitive closure of libraries that should be inlined.
	* If library A is in inlinedLibraries and it imports from library B,
	* then library B should also be inlined (unless it's external).
	*/
	computeInlinedLibrariesSet() {
		return new Set(this.inlinedLibraries);
	}
	buildModuleCaches() {
		for (const sourceFile of this.program.getSourceFiles()) {
			const fileName = sourceFile.fileName;
			if (!fileName.includes("node_modules")) continue;
			const libName = getLibraryName(fileName);
			if (!libName) continue;
			if (!this.modulePathCache.has(libName)) this.modulePathCache.set(libName, fileName);
			const list = this.moduleFilesByLibrary.get(libName);
			if (list) list.push(fileName);
			else this.moduleFilesByLibrary.set(libName, [fileName]);
		}
	}
	static getLibraryNameFromImportPath(importPath) {
		if (importPath.startsWith("@")) {
			const parts = importPath.split("/");
			return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : importPath;
		}
		const [first] = importPath.split("/");
		return first;
	}
	shouldInline(importPath) {
		if (importPath.startsWith(".")) return true;
		return this.inlinedLibraries.some((lib) => importPath === lib || importPath.startsWith(`${lib}/`));
	}
	shouldInlineFile(sourceFile) {
		const fileName = sourceFile.fileName;
		if (fileName === this.entryFile) return true;
		if (this.program.isSourceFileDefaultLibrary(sourceFile)) return false;
		const libraryName = getLibraryName(fileName);
		if (libraryName === null) return true;
		if (this.inlinedLibrariesSet.has(libraryName)) return true;
		for (const statement of sourceFile.statements) if (ts.isModuleDeclaration(statement)) {
			const moduleName = statement.name.text;
			if (this.inlinedLibrariesSet.has(moduleName)) return true;
		}
		return false;
	}
	getProgram() {
		return this.program;
	}
	getTypeChecker() {
		return this.typeChecker;
	}
	/**
	* Check if a given file path belongs to an inlined library
	*/
	isFromInlinedLibrary(filePath) {
		const libraryName = getLibraryName(filePath);
		return libraryName !== null && this.inlinedLibrariesSet.has(libraryName);
	}
	/**
	* Resolve an import path from a given source file
	* Uses the TypeScript Program's module resolution
	*/
	resolveImport(fromFile, importPath) {
		if (importPath.startsWith(".")) {
			const dir = path.dirname(fromFile);
			const resolved = path.resolve(dir, importPath);
			const basePaths = [resolved];
			if (importPath.endsWith(".mjs")) basePaths.push(resolved.slice(0, -4));
			if (importPath.endsWith(".cjs")) basePaths.push(resolved.slice(0, -4));
			if (importPath.endsWith(".js")) basePaths.push(resolved.slice(0, -3));
			const extensions = [
				"",
				".ts",
				".tsx",
				".d.ts",
				".mts",
				".cts",
				".d.mts",
				".d.cts",
				"/index.ts",
				"/index.tsx",
				"/index.d.ts",
				"/index.mts",
				"/index.d.mts",
				"/index.cts",
				"/index.d.cts"
			];
			for (const base of basePaths) for (const ext of extensions) {
				const fullPath = base + ext;
				if (fs.existsSync(fullPath)) return fullPath;
			}
			return null;
		}
		const cached = this.moduleResolveCache.get(importPath);
		if (cached !== void 0) return cached;
		const direct = this.modulePathCache.get(importPath);
		if (direct) {
			this.moduleResolveCache.set(importPath, direct);
			return direct;
		}
		const libraryName = FileCollector.getLibraryNameFromImportPath(importPath);
		const list = this.moduleFilesByLibrary.get(libraryName);
		if (list) {
			const match = list.find((fileName) => fileName.includes(`/${importPath}/`) || fileName.includes(`/${importPath}.`) || fileName.endsWith(`/${importPath}`));
			if (match) {
				this.moduleResolveCache.set(importPath, match);
				return match;
			}
		}
		this.moduleResolveCache.set(importPath, null);
		return null;
	}
	collectFiles() {
		const files = /* @__PURE__ */ new Map();
		const sourceFiles = this.program.getSourceFiles();
		for (const sourceFile of sourceFiles) {
			if (!this.shouldInlineFile(sourceFile)) continue;
			const filePath = sourceFile.fileName;
			const isEntry = filePath === this.entryFile;
			let content;
			if (fs.existsSync(filePath)) content = fs.readFileSync(filePath, "utf-8");
			else content = sourceFile.text;
			const hasEmptyExport = sourceFile.statements.some((statement) => {
				if (!ts.isExportDeclaration(statement)) return false;
				if (statement.moduleSpecifier) return false;
				if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return false;
				return statement.exportClause.elements.length === 0;
			});
			const referencedTypes = /* @__PURE__ */ new Set();
			const typeRefs = sourceFile.typeReferenceDirectives;
			for (const ref of typeRefs) if (ref.preserve === true) referencedTypes.add(ref.fileName);
			files.set(filePath, {
				content,
				sourceFile,
				isEntry,
				hasEmptyExport,
				referencedTypes
			});
		}
		return files;
	}
};

//#endregion
//#region src/name-normalizer.ts
var NameNormalizer = class NameNormalizer {
	registry;
	nameCounter;
	constructor(registry) {
		this.registry = registry;
		this.nameCounter = /* @__PURE__ */ new Map();
	}
	normalize() {
		const byName = /* @__PURE__ */ new Map();
		for (const declaration of this.registry.declarations.values()) {
			const name = declaration.normalizedName;
			if (!byName.has(name)) byName.set(name, []);
			byName.get(name)?.push(declaration);
		}
		for (const [name, declarations] of byName.entries()) if (declarations.length > 1) for (let i = 1; i < declarations.length; i++) {
			const counter = this.nameCounter.get(name) || 1;
			this.nameCounter.set(name, counter + 1);
			declarations[i].normalizedName = `${name}_${counter}`;
		}
		this.normalizeExternalImports();
	}
	normalizeExternalImports() {
		const importNameCounts = /* @__PURE__ */ new Map();
		for (const moduleImports of this.registry.externalImports.values()) for (const externalImport of moduleImports.values()) {
			const name = NameNormalizer.extractImportName(externalImport.originalName);
			if (!importNameCounts.has(name)) importNameCounts.set(name, []);
			importNameCounts.get(name)?.push(externalImport);
		}
		for (const [name, imports] of importNameCounts.entries()) if (imports.length > 1) for (let i = 1; i < imports.length; i++) {
			const counter = this.nameCounter.get(name) || 1;
			this.nameCounter.set(name, counter + 1);
			const newName = `${name}_${counter}`;
			if (imports[i].originalName.startsWith("default as ")) imports[i].normalizedName = `default as ${newName}`;
			else if (imports[i].originalName.startsWith("* as ")) imports[i].normalizedName = `* as ${newName}`;
			else if (imports[i].originalName.includes(" as ")) {
				const [original] = imports[i].originalName.split(" as ");
				imports[i].normalizedName = `${original} as ${newName}`;
			} else imports[i].normalizedName = `${imports[i].originalName} as ${newName}`;
		}
	}
	static extractImportName(importStr) {
		if (importStr.startsWith("default as ")) return importStr.replace("default as ", "");
		if (importStr.startsWith("* as ")) return importStr.replace("* as ", "");
		if (importStr.includes(" as ")) return importStr.split(" as ")[1].trim();
		return importStr;
	}
};

//#endregion
//#region package.json
var package_default = {
	name: "@qlik/dts-bundler",
	description: "Bundle TypeScript declaration files into a single file",
	keywords: [],
	license: "ISC",
	author: "nilzona",
	type: "module",
	exports: { ".": {
		"types": "./dist/index.d.ts",
		"import": "./dist/index.js"
	} },
	main: "dist/index.js",
	types: "dist/index.d.ts",
	bin: { "bundle-types": "./dist/index.js" },
	scripts: {
		"build": "tsdown src/index.ts --outDir dist --format esm --dts",
		"check-types": "tsc --noEmit",
		"format:check": "prettier --check '**' --ignore-unknown",
		"format:write": "prettier --write '**' --ignore-unknown",
		"lint": "eslint .",
		"test": "vitest run",
		"test:update": "vitest run -u",
		"test:watch": "vitest"
	},
	prettier: "@qlik/prettier-config",
	dependencies: { "typescript": "^5.9.3" },
	devDependencies: {
		"@qlik/eslint-config": "^1.4.15",
		"@qlik/prettier-config": "^0.4.32",
		"@qlik/tsconfig": "^0.3.1",
		"@types/node": "^22.13.1",
		"eslint": "^9.39.2",
		"prettier": "^3.8.0",
		"tsdown": "^0.20.1",
		"vitest": "^4.0.17"
	},
	packageManager: "pnpm@10.28.1",
	engines: { "node": ">=20" }
};

//#endregion
//#region src/ast-printer.ts
var AstPrinter = class AstPrinter {
	printer;
	constructor() {
		this.printer = ts.createPrinter({
			newLine: ts.NewLineKind.LineFeed,
			removeComments: false
		});
	}
	printNode(node, sourceFile, options = {}) {
		const transformed = options.renameMap ? AstPrinter.applyRenameTransformer(node, options.renameMap) : node;
		return this.printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile);
	}
	printStatement(statement, sourceFile, options = {}) {
		const transformed = options.renameMap ? AstPrinter.applyRenameTransformer(statement, options.renameMap) : statement;
		return this.printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile);
	}
	static applyRenameTransformer(node, renameMap) {
		const transformer = (context) => {
			const visit = (current) => {
				if (ts.isIdentifier(current)) {
					const parent = current.parent;
					if (parent && ts.isModuleDeclaration(parent) && parent.name === current) return current;
					const renamed = renameMap.get(current.text);
					if (renamed && renamed !== current.text) {
						const replacement = ts.factory.createIdentifier(renamed);
						ts.setTextRange(replacement, current);
						return replacement;
					}
				}
				if (ts.isQualifiedName(current)) {
					const left = ts.visitNode(current.left, visit);
					const right = ts.visitNode(current.right, visit);
					if (left !== current.left || right !== current.right) {
						const replacement = ts.factory.createQualifiedName(left, right);
						ts.setTextRange(replacement, current);
						return replacement;
					}
				}
				if (ts.isPropertyAccessExpression(current)) {
					const expression = ts.visitNode(current.expression, visit);
					const name = ts.visitNode(current.name, visit);
					if (expression !== current.expression || name !== current.name) {
						const replacement = ts.factory.createPropertyAccessExpression(expression, name);
						ts.setTextRange(replacement, current);
						return replacement;
					}
				}
				return ts.visitEachChild(current, visit, context);
			};
			return (rootNode) => ts.visitNode(rootNode, visit);
		};
		const result = ts.transform(node, [transformer]);
		const transformed = result.transformed[0];
		result.dispose();
		return transformed;
	}
};

//#endregion
//#region src/helpers/ast-transformer.ts
const modifiersPriority = {
	[ts.SyntaxKind.ExportKeyword]: 4,
	[ts.SyntaxKind.DefaultKeyword]: 3,
	[ts.SyntaxKind.DeclareKeyword]: 2,
	[ts.SyntaxKind.AsyncKeyword]: 1,
	[ts.SyntaxKind.ConstKeyword]: 1
};
function getModifiers(node) {
	if (!ts.canHaveModifiers(node)) return;
	return ts.getModifiers(node);
}
function modifiersToMap(modifiers) {
	const safe = modifiers ?? [];
	const result = {};
	for (const modifier of safe) result[modifier.kind] = true;
	return result;
}
function modifiersMapToArray(modifiersMap) {
	return Object.entries(modifiersMap).filter(([, include]) => include).map(([kind]) => ts.factory.createModifier(Number(kind))).sort((a, b) => {
		const aValue = modifiersPriority[a.kind] || 0;
		return (modifiersPriority[b.kind] || 0) - aValue;
	});
}
function recreateRootLevelNodeWithModifiers(node, modifiersMap, newName, keepComments = true) {
	const newNode = recreateRootLevelNodeWithModifiersImpl(node, modifiersMap, newName);
	if (keepComments) ts.setCommentRange(newNode, ts.getCommentRange(node));
	ts.setTextRange(newNode, node);
	return newNode;
}
function recreateRootLevelNodeWithModifiersImpl(node, modifiersMap, newName) {
	const modifiers = modifiersMapToArray(modifiersMap);
	if (ts.isClassDeclaration(node)) return ts.factory.createClassDeclaration(modifiers, newName || node.name, node.typeParameters, node.heritageClauses, node.members);
	if (ts.isEnumDeclaration(node)) return ts.factory.createEnumDeclaration(modifiers, newName || node.name, node.members);
	if (ts.isExportAssignment(node)) return ts.factory.createExportAssignment(modifiers, node.isExportEquals, node.expression);
	if (ts.isExportDeclaration(node)) return ts.factory.createExportDeclaration(modifiers, node.isTypeOnly, node.exportClause, node.moduleSpecifier, node.attributes || node.assertClause);
	if (ts.isFunctionDeclaration(node)) return ts.factory.createFunctionDeclaration(modifiers, node.asteriskToken, newName || node.name, node.typeParameters, node.parameters, node.type, node.body);
	if (ts.isImportDeclaration(node)) return ts.factory.createImportDeclaration(modifiers, node.importClause, node.moduleSpecifier, node.attributes || node.assertClause);
	if (ts.isImportEqualsDeclaration(node)) return ts.factory.createImportEqualsDeclaration(modifiers, node.isTypeOnly, newName || node.name, node.moduleReference);
	if (ts.isInterfaceDeclaration(node)) return ts.factory.createInterfaceDeclaration(modifiers, newName || node.name, node.typeParameters, node.heritageClauses, node.members);
	if (ts.isModuleDeclaration(node)) return ts.factory.createModuleDeclaration(modifiers, node.name, node.body, node.flags);
	if (ts.isTypeAliasDeclaration(node)) return ts.factory.createTypeAliasDeclaration(modifiers, newName || node.name, node.typeParameters, node.type);
	if (ts.isVariableStatement(node)) return ts.factory.createVariableStatement(modifiers, node.declarationList);
	throw new Error(`Unknown top-level node kind (with modifiers): ${ts.SyntaxKind[node.kind]}`);
}

//#endregion
//#region src/helpers/print-normalizer.ts
function normalizeIndentation(text) {
	return text.split("\n").map((line) => {
		const indent = line.match(/^(\s*)/)?.[1] ?? "";
		const spaces = indent.replace(/\t/g, "  ");
		const normalizedIndentSize = spaces.length < 2 ? spaces.length : Math.floor(spaces.length / 2);
		return `${" ".repeat(normalizedIndentSize)}${line.slice(indent.length)}`;
	}).join("\n");
}
function collapseEmptyBlocks(text) {
	return text.replace(/\{\n\s*\}/g, "{}");
}
function collapseSimpleTypeLiterals(text, originalText) {
	if (originalText && originalText.includes("\n")) return text;
	return text.replace(/\{\n([\s\S]*?)\n\s*\}/g, (match, body) => {
		const lines = body.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
		if (lines.length === 0) return "{}";
		if (!lines.every((line) => /^[A-Za-z_$][\w$]*\??\s*:\s*.+;$/.test(line))) return match;
		return `{ ${lines.map((line, index) => {
			if (index === lines.length - 1) return line.replace(/;$/, "");
			return line;
		}).join(" ")} }`;
	});
}
function collapseGenericArguments(text) {
	return text.replace(/<([\s\S]*?)>/g, (match, body) => {
		if (!body.includes("\n")) return match;
		return `<${body.replace(/\s*\n\s*/g, " ")}>`;
	});
}
function normalizePrintedStatement(text, node, originalText) {
	let result = text.replace(/\t/g, "  ");
	result = normalizeIndentation(result);
	result = collapseGenericArguments(result);
	result = result.replace(/<([^>]*?)\n\s*([^>]*?)>/g, (match, first, second) => {
		return `<${String(first).trim()} ${String(second).trim()}>`;
	});
	if (ts.isVariableStatement(node) && originalText && /,\s*\n/.test(originalText)) result = result.replace(/,\s+/g, ",\n  ");
	if (ts.isVariableStatement(node)) {
		result = result.replace(/^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*\n)*/, "");
		result = result.replace(/:\s*([^;]+);/g, (match, typeText) => {
			return `: ${String(typeText).replace(/\s*\n\s*/g, " ").trim()};`;
		});
	}
	if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) result = collapseEmptyBlocks(result);
	if (ts.isModuleDeclaration(node)) result = collapseEmptyBlocks(result);
	if (ts.isTypeAliasDeclaration(node)) result = collapseSimpleTypeLiterals(result, originalText);
	return result;
}

//#endregion
//#region src/variable-declaration-emitter.ts
var VariableDeclarationEmitter = class VariableDeclarationEmitter {
	checker;
	addExtraDefaultExport;
	printer;
	getRenameMap;
	constructor(checker, addExtraDefaultExport, printer, getRenameMap) {
		this.checker = checker;
		this.addExtraDefaultExport = addExtraDefaultExport;
		this.printer = printer;
		this.getRenameMap = getRenameMap;
	}
	generateVariableStatementLines(statement, declarations) {
		const orderedDeclarations = [...declarations].sort((a, b) => {
			return (a.variableDeclaration?.pos ?? 0) - (b.variableDeclaration?.pos ?? 0);
		});
		if (orderedDeclarations.some((decl) => decl.exportInfo.kind === ExportKind.DefaultOnly)) {
			for (const decl of orderedDeclarations) if (VariableDeclarationEmitter.shouldExportDeclaration(decl)) this.addExtraDefaultExport(decl.normalizedName);
			const statementNode = this.buildVariableStatement(statement, orderedDeclarations, false);
			if (!statementNode) return [];
			return [this.printStatement(statementNode, statement, orderedDeclarations)];
		}
		const groups = /* @__PURE__ */ new Map();
		for (const decl of orderedDeclarations) {
			const shouldExport = VariableDeclarationEmitter.shouldExportDeclaration(decl);
			const group = groups.get(shouldExport);
			if (group) group.push(decl);
			else groups.set(shouldExport, [decl]);
		}
		const lines = [];
		for (const shouldExport of [false, true]) {
			const group = groups.get(shouldExport);
			if (!group || group.length === 0) continue;
			const statementNode = this.buildVariableStatement(statement, group, shouldExport);
			if (!statementNode) continue;
			lines.push(this.printStatement(statementNode, statement, group));
		}
		return lines;
	}
	buildVariableStatement(statement, declarations, shouldExport) {
		const declarationList = this.buildVariableDeclarationList(statement, declarations);
		if (!declarationList) return null;
		const modifiers = [];
		if (shouldExport) modifiers.push(ts.factory.createModifier(ts.SyntaxKind.ExportKeyword));
		modifiers.push(ts.factory.createModifier(ts.SyntaxKind.DeclareKeyword));
		const variableStatement = ts.factory.createVariableStatement(modifiers, declarationList);
		ts.setTextRange(variableStatement, {
			pos: statement.getStart(),
			end: statement.end
		});
		return variableStatement;
	}
	buildVariableDeclarationList(statement, declarations) {
		const statementDeclarations = statement.declarationList.declarations;
		if (statementDeclarations.some((decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name))) {
			if (!statementDeclarations.every((decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name))) return statement.declarationList;
			const identifiers = [];
			for (const decl of statementDeclarations) VariableDeclarationEmitter.collectBindingIdentifiers(decl.name, identifiers);
			if (identifiers.length === 0) return statement.declarationList;
			const newDeclarations = identifiers.map((identifier) => {
				const type = this.checker.getTypeAtLocation(identifier);
				const typeNode = this.checker.typeToTypeNode(type, void 0, ts.NodeBuilderFlags.NoTruncation);
				const name = ts.factory.createIdentifier(identifier.text);
				return ts.factory.createVariableDeclaration(name, void 0, typeNode, void 0);
			});
			return ts.factory.createVariableDeclarationList(newDeclarations, statement.declarationList.flags);
		}
		const newDeclarations = [];
		for (const decl of declarations) {
			const varDecl = decl.variableDeclaration;
			if (!varDecl || !ts.isIdentifier(varDecl.name)) continue;
			const name = ts.factory.createIdentifier(decl.normalizedName);
			const initializer = varDecl.initializer;
			const explicitType = varDecl.type ?? null;
			if (initializer && ts.isIdentifier(initializer) && decl.namespaceDependencies.has(initializer.text)) {
				const typeNode = ts.factory.createTypeQueryNode(ts.factory.createIdentifier(initializer.text));
				newDeclarations.push(ts.factory.createVariableDeclaration(name, void 0, typeNode, void 0));
				continue;
			}
			if (explicitType) {
				newDeclarations.push(ts.factory.createVariableDeclaration(name, void 0, explicitType, void 0));
				continue;
			}
			if (initializer && VariableDeclarationEmitter.shouldKeepInitializer(varDecl, this.checker)) {
				newDeclarations.push(ts.factory.createVariableDeclaration(name, void 0, void 0, initializer));
				continue;
			}
			const type = this.checker.getTypeAtLocation(varDecl.name);
			const typeNode = this.checker.typeToTypeNode(type, void 0, ts.NodeBuilderFlags.NoTruncation);
			newDeclarations.push(ts.factory.createVariableDeclaration(name, void 0, typeNode, void 0));
		}
		if (newDeclarations.length === 0) return statement.declarationList;
		return ts.factory.createVariableDeclarationList(newDeclarations, statement.declarationList.flags);
	}
	printStatement(statementNode, sourceStatement, declarations) {
		const renameMap = this.getRenameMap(declarations);
		return normalizePrintedStatement(this.printer.printStatement(statementNode, sourceStatement.getSourceFile(), { renameMap }), sourceStatement, sourceStatement.getText(sourceStatement.getSourceFile()));
	}
	static shouldExportDeclaration(decl) {
		const kind = decl.exportInfo.kind;
		if (kind === ExportKind.Equals || kind === ExportKind.DefaultOnly) return false;
		return kind === ExportKind.Named || decl.exportInfo.wasOriginallyExported;
	}
	static shouldKeepInitializer(decl, checker) {
		if (!decl.initializer) return false;
		if (decl.type) return false;
		const type = checker.getTypeAtLocation(decl.initializer);
		if (type.isLiteral()) return true;
		if (type.isUnion()) return type.types.every((member) => member.isLiteral());
		return false;
	}
	static collectBindingIdentifiers(name, identifiers) {
		if (ts.isIdentifier(name)) {
			identifiers.push(name);
			return;
		}
		if (ts.isObjectBindingPattern(name)) {
			for (const element of name.elements) if (ts.isBindingElement(element)) VariableDeclarationEmitter.collectBindingIdentifiers(element.name, identifiers);
			return;
		}
		if (ts.isArrayBindingPattern(name)) for (const element of name.elements) {
			if (ts.isOmittedExpression(element)) continue;
			if (ts.isBindingElement(element)) VariableDeclarationEmitter.collectBindingIdentifiers(element.name, identifiers);
		}
	}
};

//#endregion
//#region src/output-generator.ts
const version = package_default.version ?? "development";
var OutputGenerator = class OutputGenerator {
	registry;
	usedDeclarations;
	usedExternals;
	nameMap;
	extraDefaultExports;
	variableDeclarationEmitter;
	astPrinter;
	options;
	constructor(registry, usedDeclarations, usedExternals, options = {}) {
		this.registry = registry;
		this.usedDeclarations = usedDeclarations;
		this.usedExternals = usedExternals;
		this.nameMap = /* @__PURE__ */ new Map();
		this.extraDefaultExports = /* @__PURE__ */ new Set();
		this.astPrinter = new AstPrinter();
		this.variableDeclarationEmitter = options.typeChecker ? new VariableDeclarationEmitter(options.typeChecker, (name) => this.extraDefaultExports.add(name), this.astPrinter, (declarations) => this.buildRenameMapForDeclarations(declarations)) : null;
		this.options = options;
	}
	generate() {
		const lines = [];
		const banner = !this.options.noBanner ? `// Generated by @qlik/dts-bundler@${version}` : null;
		const referenceDirectives = this.generateReferenceDirectives();
		const externalImports = this.usedExternals.size > 0 ? this.generateExternalImports() : [];
		this.buildNameMap();
		const declarations = this.generateDeclarations();
		const namespaces = this.generateNamespaces();
		const exportEquals = this.generateExportEquals();
		const exportDefault = this.generateExportDefault();
		const umdDeclaration = this.options.umdModuleName ? [`export as namespace ${this.options.umdModuleName};`] : [];
		const emptyExport = this.options.includeEmptyExport ? ["export {};"] : [];
		const appendSection = (section) => {
			if (section.length === 0) return;
			if (lines.length > 0) lines.push("");
			lines.push(...section);
		};
		if (banner) lines.push(banner);
		appendSection(referenceDirectives);
		appendSection(externalImports);
		appendSection(namespaces);
		appendSection(declarations);
		if (exportEquals.length > 0) lines.push(...exportEquals);
		if (exportDefault.length > 0) {
			if (lines.length > 0) lines.push("");
			lines.push(...exportDefault);
		}
		appendSection(umdDeclaration);
		appendSection(emptyExport);
		return `${lines.join("\n")}\n`;
	}
	buildNameMap() {
		for (const id of this.usedDeclarations) {
			const declaration = this.registry.getDeclaration(id);
			if (declaration && declaration.name !== declaration.normalizedName) {
				const key = `${declaration.sourceFile}:${declaration.name}`;
				this.nameMap.set(key, declaration.normalizedName);
			}
		}
	}
	generateExternalImports() {
		const lines = [];
		const sortedModules = Array.from(this.usedExternals.keys()).sort();
		for (const moduleName of sortedModules) {
			const imports = Array.from(this.usedExternals.get(moduleName) ?? []);
			if (imports.length === 0) continue;
			const cjsImports = imports.filter((imp) => imp.normalizedName.startsWith("= "));
			const esImports = imports.filter((imp) => !imp.normalizedName.startsWith("= "));
			for (const cjsImport of cjsImports) {
				const importName = cjsImport.normalizedName.substring(2);
				lines.push(`import ${importName} = require("${moduleName}");`);
			}
			if (esImports.length === 0) continue;
			const typePrefix = esImports.every((imp) => imp.isTypeOnly) ? "type " : "";
			const hasNamespace = esImports.some((imp) => imp.normalizedName.startsWith("* as "));
			const defaultImports = esImports.filter((imp) => imp.normalizedName.startsWith("default as "));
			const namedImports = esImports.filter((imp) => !imp.normalizedName.startsWith("* as ") && !imp.normalizedName.startsWith("default as "));
			if (hasNamespace) {
				const importList = esImports.map((imp) => imp.normalizedName).sort();
				lines.push(`import ${typePrefix}${importList.join(", ")} from "${moduleName}";`);
			} else if (defaultImports.length > 0 && namedImports.length > 0) {
				const defaultName = defaultImports[0].normalizedName.substring(11);
				const namedList = namedImports.map((imp) => imp.normalizedName).sort();
				lines.push(`import ${typePrefix}${defaultName}, { ${namedList.join(", ")} } from "${moduleName}";`);
			} else if (defaultImports.length > 0) for (const defaultImport of defaultImports) {
				const defaultName = defaultImport.normalizedName.substring(11);
				lines.push(`import ${typePrefix}${defaultName} from "${moduleName}";`);
			}
			else if (namedImports.length > 0) {
				const importList = namedImports.map((imp) => imp.normalizedName).sort();
				lines.push(`import ${typePrefix}{ ${importList.join(", ")} } from "${moduleName}";`);
			}
		}
		return lines;
	}
	generateDeclarations() {
		const lines = [];
		const sorted = this.topologicalSort();
		const ordered = this.options.sortNodes ? [...sorted].sort((a, b) => {
			const rank = OutputGenerator.getSortRank(a) - OutputGenerator.getSortRank(b);
			if (rank !== 0) return rank;
			return a.normalizedName.localeCompare(b.normalizedName);
		}) : sorted;
		const variableStatementGroups = /* @__PURE__ */ new Map();
		for (const declaration of ordered) if (ts.isVariableStatement(declaration.node)) {
			const statement = declaration.node;
			const key = OutputGenerator.getVariableStatementKey(declaration.sourceFile, statement);
			const group = variableStatementGroups.get(key);
			if (group) group.declarations.push(declaration);
			else variableStatementGroups.set(key, {
				statement,
				declarations: [declaration]
			});
		}
		const processedVariableStatements = /* @__PURE__ */ new Set();
		for (const declaration of ordered) {
			if (ts.isVariableStatement(declaration.node)) {
				const statement = declaration.node;
				const key = OutputGenerator.getVariableStatementKey(declaration.sourceFile, statement);
				if (processedVariableStatements.has(key)) continue;
				processedVariableStatements.add(key);
				const group = variableStatementGroups.get(key);
				if (group && this.variableDeclarationEmitter) {
					const groupLines = this.variableDeclarationEmitter.generateVariableStatementLines(group.statement, group.declarations);
					if (groupLines.length > 0) {
						lines.push(...groupLines);
						continue;
					}
				}
			}
			const hasDefaultModifier = ts.canHaveModifiers(declaration.node) && (ts.getModifiers(declaration.node)?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword) ?? false);
			const suppressExportForDefault = declaration.exportInfo.kind === ExportKind.Default && hasDefaultModifier;
			const shouldHaveExport = declaration.exportInfo.kind !== ExportKind.Equals && !suppressExportForDefault && declaration.exportInfo.kind !== ExportKind.DefaultOnly && (declaration.exportInfo.kind === ExportKind.Named || declaration.exportInfo.wasOriginallyExported);
			const transformedStatement = OutputGenerator.transformStatementForOutput(declaration, shouldHaveExport, suppressExportForDefault);
			const renameMap = this.buildRenameMap(declaration);
			const printed = this.astPrinter.printStatement(transformedStatement, declaration.sourceFileNode, { renameMap });
			lines.push(normalizePrintedStatement(printed, declaration.node, declaration.getText()));
		}
		return lines;
	}
	generateNamespaces() {
		const lines = [];
		const usedNamespaces = /* @__PURE__ */ new Map();
		for (const declId of this.usedDeclarations) {
			const decl = this.registry.getDeclaration(declId);
			if (!decl) continue;
			for (const namespaceName of decl.namespaceDependencies) {
				const key = `${decl.sourceFile}:${namespaceName}`;
				const nsInfo = this.registry.namespaceImports.get(key);
				if (nsInfo && !usedNamespaces.has(namespaceName)) {
					const fileDeclarations = this.registry.declarationsByFile.get(nsInfo.sourceFile);
					if (fileDeclarations) {
						const usedFromFile = Array.from(fileDeclarations).filter((id) => this.usedDeclarations.has(id));
						if (usedFromFile.length > 0) usedNamespaces.set(namespaceName, {
							sourceFile: nsInfo.sourceFile,
							declarations: usedFromFile
						});
					}
				}
			}
		}
		for (const [namespaceName, info] of usedNamespaces.entries()) {
			lines.push(`declare namespace ${namespaceName} {`);
			for (const declId of info.declarations) {
				const declaration = this.registry.getDeclaration(declId);
				if (!declaration) continue;
				lines.push(`  export { ${declaration.name} };`);
			}
			lines.push(`}`);
		}
		return lines;
	}
	generateExportEquals() {
		if (!this.options.entryExportEquals) return [];
		const statement = this.options.entryExportEquals;
		if (!ts.isIdentifier(statement.expression)) return [];
		const exportedName = statement.expression.text;
		return [`export = ${this.nameMap.get(exportedName) || exportedName};`];
	}
	generateExportDefault() {
		if (this.options.entryExportDefaultName) return [this.buildDefaultExportLine(this.options.entryExportDefaultName)];
		if (!this.options.entryExportDefault) return [];
		const expression = this.options.entryExportDefault.expression;
		let exportedName;
		if (ts.isIdentifier(expression)) {
			exportedName = expression.text;
			return [this.buildDefaultExportLine(exportedName)];
		}
		if ((ts.isClassDeclaration(expression) || ts.isFunctionDeclaration(expression) || ts.isInterfaceDeclaration(expression) || ts.isEnumDeclaration(expression)) && expression.name) exportedName = expression.name.text;
		else return [];
		return [`export { ${this.nameMap.get(exportedName) || exportedName} as default };`];
	}
	buildDefaultExportLine(exportedName) {
		const normalizedName = this.nameMap.get(exportedName) || exportedName;
		const extraExports = Array.from(this.extraDefaultExports).filter((name) => name !== normalizedName);
		return `export { ${[`${normalizedName} as default`, ...extraExports].join(", ")} };`;
	}
	static stripExportModifier(text) {
		text = text.replace(/export\s+default\s+/, "");
		text = text.replace(/export\s+/, "");
		return text;
	}
	static addDeclareKeyword(text) {
		const match = text.match(/^((?:\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*)(?:export\s+)?)(class|enum|function|namespace|module)(?:\s|$)/);
		if (match) return `${match[1]}declare ${match[2]}${text.substring(match[0].length - 1)}`;
		return text;
	}
	static stripNamespaceMemberExports(text) {
		const openBraceIndex = text.indexOf("{");
		const closeBraceIndex = text.lastIndexOf("}");
		if (openBraceIndex === -1 || closeBraceIndex === -1 || closeBraceIndex <= openBraceIndex) return text;
		const prefix = text.slice(0, openBraceIndex + 1);
		const body = text.slice(openBraceIndex + 1, closeBraceIndex);
		const suffix = text.slice(closeBraceIndex);
		return `${prefix}${body.replace(/(^|\n)(\s*)export\s+(?=(?:declare\s+)?(?:namespace|module|interface|type|class|enum|const|let|var|function)\b)/g, "$1$2")}${suffix}`;
	}
	static stripDeclareGlobalMemberExports(text) {
		const openBraceIndex = text.indexOf("{");
		const closeBraceIndex = text.lastIndexOf("}");
		if (openBraceIndex === -1 || closeBraceIndex === -1 || closeBraceIndex <= openBraceIndex) return text;
		const prefix = text.slice(0, openBraceIndex + 1);
		const body = text.slice(openBraceIndex + 1, closeBraceIndex);
		const suffix = text.slice(closeBraceIndex);
		return `${prefix}${body.replace(/(^|\n)(\s*)export\s+(?=(?:declare\s+)?(?:interface|type|class|enum|const|let|var|function)\b)/g, "$1$2")}${suffix}`;
	}
	static stripImplementationDetails(text) {
		text = text.replace(/^(\s*)(public|private|protected)\s+/gm, "$1");
		text = text.replace(/^(\s*)([a-zA-Z_$][\w$]*)\s*:\s*([^;=()]+?)\s*=\s*[^;]+;/gm, "$1$2: $3;");
		text = text.replace(/^((?:export\s+)?(?:declare\s+)?function\s+[^{]+?)\s*\{[^}]*\}/gm, "$1;");
		return text;
	}
	static getVariableStatementKey(sourceFile, statement) {
		return `${sourceFile}:${statement.pos}:${statement.end}`;
	}
	topologicalSort() {
		const sorted = [];
		const visited = /* @__PURE__ */ new Set();
		const visiting = /* @__PURE__ */ new Set();
		const visit = (id) => {
			if (visited.has(id)) return;
			if (visiting.has(id)) return;
			visiting.add(id);
			const declaration = this.registry.getDeclaration(id);
			if (declaration) {
				for (const depId of declaration.dependencies) if (this.usedDeclarations.has(depId)) visit(depId);
				visiting.delete(id);
				visited.add(id);
				sorted.push(declaration);
			}
		};
		const used = Array.from(this.usedDeclarations);
		const exported = used.filter((id) => {
			const decl = this.registry.getDeclaration(id);
			return decl && decl.exportInfo.kind !== ExportKind.NotExported;
		});
		const nonExported = used.filter((id) => {
			const decl = this.registry.getDeclaration(id);
			return decl && decl.exportInfo.kind === ExportKind.NotExported;
		});
		for (const id of nonExported) visit(id);
		for (const id of exported) visit(id);
		return sorted;
	}
	buildRenameMap(declaration) {
		const renameMap = /* @__PURE__ */ new Map();
		if (declaration.name !== declaration.normalizedName && (ts.isTypeAliasDeclaration(declaration.node) || ts.isInterfaceDeclaration(declaration.node) || ts.isClassDeclaration(declaration.node) || ts.isEnumDeclaration(declaration.node))) renameMap.set(declaration.name, declaration.normalizedName);
		for (const depId of declaration.dependencies) {
			const depDecl = this.registry.getDeclaration(depId);
			if (depDecl && depDecl.name !== depDecl.normalizedName) renameMap.set(depDecl.name, depDecl.normalizedName);
		}
		for (const [moduleName, importNames] of declaration.externalDependencies.entries()) {
			const moduleImports = this.registry.externalImports.get(moduleName);
			if (!moduleImports) continue;
			for (const importName of importNames) {
				const externalImport = moduleImports.get(importName);
				if (!externalImport) continue;
				const originalName = OutputGenerator.extractImportName(externalImport.originalName);
				const normalizedName = OutputGenerator.extractImportName(externalImport.normalizedName);
				if (originalName !== normalizedName) renameMap.set(originalName, normalizedName);
			}
		}
		return renameMap;
	}
	buildRenameMapForDeclarations(declarations) {
		const merged = /* @__PURE__ */ new Map();
		for (const declaration of declarations) for (const [name, normalized] of this.buildRenameMap(declaration)) merged.set(name, normalized);
		return merged;
	}
	static extractImportName(importStr) {
		if (importStr.startsWith("default as ")) return importStr.replace("default as ", "");
		if (importStr.startsWith("* as ")) return importStr.replace("* as ", "");
		if (importStr.includes(" as ")) return importStr.split(" as ")[1].trim();
		return importStr;
	}
	static getSortRank(declaration) {
		const node = declaration.node;
		if (ts.isInterfaceDeclaration(node)) return 1;
		if (ts.isTypeAliasDeclaration(node)) return 2;
		if (ts.isClassDeclaration(node)) return 3;
		if (ts.isEnumDeclaration(node)) return 4;
		if (ts.isModuleDeclaration(node)) return 5;
		return 10;
	}
	generateReferenceDirectives() {
		const directives = [];
		const { referencedTypes, allowedTypesLibraries } = this.options;
		if (!referencedTypes || referencedTypes.size === 0 || !allowedTypesLibraries) return directives;
		const sortedTypes = Array.from(referencedTypes).sort();
		for (const typeName of sortedTypes) if (allowedTypesLibraries.includes(typeName)) directives.push(`/// <reference types="${typeName}" />`);
		return directives;
	}
	static transformStatementForOutput(declaration, shouldHaveExport, suppressExportForDefault) {
		let statement = declaration.node;
		const modifiersMap = modifiersToMap(getModifiers(statement));
		const hadExport = Boolean(modifiersMap[ts.SyntaxKind.ExportKeyword]);
		modifiersMap[ts.SyntaxKind.ExportKeyword] = hadExport && shouldHaveExport;
		if (suppressExportForDefault) modifiersMap[ts.SyntaxKind.DefaultKeyword] = false;
		if (OutputGenerator.shouldAddDeclareKeyword(statement)) modifiersMap[ts.SyntaxKind.DeclareKeyword] = true;
		statement = recreateRootLevelNodeWithModifiers(statement, modifiersMap);
		const result = ts.transform(statement, [OutputGenerator.createOutputTransformer()]);
		const transformed = result.transformed[0];
		result.dispose();
		return transformed;
	}
	static createOutputTransformer() {
		return (context) => {
			const visit = (node) => {
				if (OutputGenerator.shouldStripNamespaceMemberExport(node)) return OutputGenerator.stripExportFromStatement(node, false);
				if (ts.isFunctionDeclaration(node) && node.body) {
					const updated = ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, void 0);
					ts.setTextRange(updated, node);
					return updated;
				}
				if (ts.isClassDeclaration(node)) {
					const members = node.members.map((member) => OutputGenerator.stripClassMemberImplementation(member));
					const updated = ts.factory.updateClassDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, members);
					ts.setTextRange(updated, node);
					return updated;
				}
				if (ts.isModuleDeclaration(node)) {
					const isDeclareGlobal = (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
					let body = node.body;
					if (body && ts.isModuleBlock(body)) {
						const statements = body.statements.map((statement) => OutputGenerator.stripExportFromStatement(statement, isDeclareGlobal));
						body = ts.factory.updateModuleBlock(body, statements);
					}
					let flags = node.flags;
					if (!isDeclareGlobal && ts.isIdentifier(node.name)) flags |= ts.NodeFlags.Namespace;
					const updated = ts.factory.createModuleDeclaration(node.modifiers, node.name, body, flags);
					ts.setTextRange(updated, node);
					return ts.visitEachChild(updated, visit, context);
				}
				return ts.visitEachChild(node, visit, context);
			};
			return (rootNode) => ts.visitNode(rootNode, visit);
		};
	}
	static stripClassMemberImplementation(member) {
		const modifiers = getModifiers(member);
		if (ts.isPropertyDeclaration(member)) {
			const filteredModifiers = OutputGenerator.stripAccessModifiers(modifiers);
			const updated = ts.factory.updatePropertyDeclaration(member, filteredModifiers, member.name, member.questionToken ?? member.exclamationToken, member.type, void 0);
			ts.setTextRange(updated, member);
			return updated;
		}
		if (modifiers) {
			const filteredModifiers = OutputGenerator.stripAccessModifiers(modifiers);
			if (filteredModifiers !== modifiers) {
				if (ts.isMethodDeclaration(member)) {
					const updated = ts.factory.updateMethodDeclaration(member, filteredModifiers, member.asteriskToken, member.name, member.questionToken, member.typeParameters, member.parameters, member.type, member.body);
					ts.setTextRange(updated, member);
					return updated;
				}
			}
		}
		return member;
	}
	static stripExportFromStatement(statement, preserveNamespaceExport) {
		if (preserveNamespaceExport && ts.isModuleDeclaration(statement)) return statement;
		const modifiers = getModifiers(statement);
		if (!modifiers) return statement;
		const modifiersMap = modifiersToMap(modifiers);
		if (!modifiersMap[ts.SyntaxKind.ExportKeyword]) return statement;
		modifiersMap[ts.SyntaxKind.ExportKeyword] = false;
		return recreateRootLevelNodeWithModifiers(statement, modifiersMap);
	}
	static shouldStripNamespaceMemberExport(node) {
		if (!ts.isStatement(node)) return false;
		const parentBlock = node.parent;
		if (!parentBlock) return false;
		if (!ts.isModuleBlock(parentBlock)) return false;
		const moduleDecl = parentBlock.parent;
		if (!ts.isModuleDeclaration(moduleDecl)) return false;
		return !ts.isModuleDeclaration(node);
	}
	static shouldAddDeclareKeyword(statement) {
		if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isFunctionDeclaration(statement) || ts.isModuleDeclaration(statement)) return true;
		return false;
	}
	static stripAccessModifiers(modifiers) {
		if (!modifiers || modifiers.length === 0) return modifiers;
		const filtered = modifiers.filter((modifier) => modifier.kind !== ts.SyntaxKind.PublicKeyword && modifier.kind !== ts.SyntaxKind.PrivateKeyword && modifier.kind !== ts.SyntaxKind.ProtectedKeyword);
		return filtered.length === modifiers.length ? modifiers : filtered;
	}
};

//#endregion
//#region src/registry.ts
var TypeRegistry = class {
	declarations;
	declarationsByFile;
	nameIndex;
	externalImports;
	namespaceImports;
	constructor() {
		this.declarations = /* @__PURE__ */ new Map();
		this.declarationsByFile = /* @__PURE__ */ new Map();
		this.nameIndex = /* @__PURE__ */ new Map();
		this.externalImports = /* @__PURE__ */ new Map();
		this.namespaceImports = /* @__PURE__ */ new Map();
	}
	register(declaration) {
		this.declarations.set(declaration.id, declaration);
		if (!this.declarationsByFile.has(declaration.sourceFile)) this.declarationsByFile.set(declaration.sourceFile, /* @__PURE__ */ new Set());
		this.declarationsByFile.get(declaration.sourceFile)?.add(declaration.id);
		const key = `${declaration.sourceFile}:${declaration.name}`;
		this.nameIndex.set(key, declaration.id);
	}
	registerExternal(moduleName, importName, isTypeOnly) {
		if (!this.externalImports.has(moduleName)) this.externalImports.set(moduleName, /* @__PURE__ */ new Map());
		const moduleImports = this.externalImports.get(moduleName);
		if (!moduleImports.has(importName)) moduleImports.set(importName, new ExternalImport(moduleName, importName, isTypeOnly));
		return moduleImports.get(importName);
	}
	lookup(name, fromFile) {
		const localKey = `${fromFile}:${name}`;
		if (this.nameIndex.has(localKey)) {
			const id = this.nameIndex.get(localKey);
			return this.declarations.get(id) ?? null;
		}
		return null;
	}
	getDeclaration(id) {
		return this.declarations.get(id);
	}
	getAllExported() {
		return Array.from(this.declarations.values()).filter((d) => d.exportInfo.kind !== ExportKind.NotExported);
	}
};

//#endregion
//#region src/tree-shaker.ts
var TreeShaker = class {
	registry;
	used;
	usedExternals;
	exportReferencedTypes;
	constructor(registry, options = {}) {
		this.registry = registry;
		this.used = /* @__PURE__ */ new Set();
		this.usedExternals = /* @__PURE__ */ new Set();
		this.exportReferencedTypes = options.exportReferencedTypes ?? true;
	}
	shake() {
		const exported = this.registry.getAllExported();
		for (const declaration of exported) this.markUsed(declaration.id);
		return {
			declarations: this.used,
			externalImports: this.collectUsedExternalImports()
		};
	}
	markUsed(declarationId) {
		if (this.used.has(declarationId)) return;
		this.used.add(declarationId);
		const declaration = this.registry.getDeclaration(declarationId);
		if (!declaration) return;
		if (this.exportReferencedTypes) for (const depId of declaration.dependencies) this.markUsed(depId);
		for (const [moduleName, importNames] of declaration.externalDependencies.entries()) for (const importName of importNames) this.usedExternals.add(`${moduleName}:${importName}`);
	}
	collectUsedExternalImports() {
		const result = /* @__PURE__ */ new Map();
		for (const [moduleName, moduleImports] of this.registry.externalImports.entries()) for (const [importName, externalImport] of moduleImports.entries()) {
			const key = `${moduleName}:${importName}`;
			if (this.usedExternals.has(key)) {
				if (!result.has(moduleName)) result.set(moduleName, /* @__PURE__ */ new Set());
				result.get(moduleName)?.add(externalImport);
			}
		}
		return result;
	}
};

//#endregion
//#region src/index.ts
function bundle(entry, inlinedLibraries = [], options = {}) {
	const entryFile = path.resolve(entry);
	if (!fs.existsSync(entryFile)) throw new Error(`Entry file ${entryFile} does not exist`);
	const collector = new FileCollector(entryFile, { inlinedLibraries });
	const files = collector.collectFiles();
	const includeEmptyExport = files.get(entryFile)?.hasEmptyExport ?? false;
	const allReferencedTypes = /* @__PURE__ */ new Set();
	for (const file of files.values()) for (const refType of file.referencedTypes) allReferencedTypes.add(refType);
	const registry = new TypeRegistry();
	const parser = new DeclarationParser(registry, collector, { inlineDeclareGlobals: options.inlineDeclareGlobals ?? false });
	parser.parseFiles(files);
	new DependencyAnalyzer(registry, parser.importMap).analyze();
	new NameNormalizer(registry).normalize();
	const { declarations: usedDeclarations, externalImports: usedExternals } = new TreeShaker(registry, { exportReferencedTypes: options.exportReferencedTypes }).shake();
	return new OutputGenerator(registry, usedDeclarations, usedExternals, {
		...options,
		includeEmptyExport,
		referencedTypes: allReferencedTypes,
		entryExportEquals: parser.entryExportEquals,
		entryExportDefault: parser.entryExportDefault,
		entryExportDefaultName: parser.entryExportDefaultName,
		typeChecker: collector.getTypeChecker()
	}).generate();
}
/**
* Bundle TypeScript declaration files
* @param options - Bundling options
* @returns The bundled TypeScript declaration content
*/
function bundleDts(options) {
	const { entry, inlinedLibraries = [], allowedTypesLibraries, importedLibraries, noBanner, sortNodes, umdModuleName, exportReferencedTypes, inlineDeclareGlobals } = options;
	if (!entry) throw new Error("The 'entry' option is required");
	return bundle(entry, inlinedLibraries, {
		noBanner,
		sortNodes,
		umdModuleName,
		exportReferencedTypes,
		allowedTypesLibraries,
		importedLibraries,
		inlineDeclareGlobals
	});
}
function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		entry: null,
		output: null,
		inlinedLibraries: []
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-e" || arg === "--entry") options.entry = args[++i] ?? null;
		else if (arg === "-o" || arg === "--output") options.output = args[++i] ?? null;
		else if (arg === "-i" || arg === "--inlinedLibraries") {
			const libs = args[++i];
			options.inlinedLibraries = libs ? libs.split(",").map((s) => s.trim()).filter(Boolean) : [];
		} else if (arg === "-h" || arg === "--help") {
			console.log("TypeScript Type Bundler v2");
			console.log("\nUsage: bundle-types -e <entry> -o <output> [-i <inlinedLibraries>]");
			console.log("\nOptions:");
			console.log("  -e, --entry <file>              Entry TypeScript file");
			console.log("  -o, --output <file>             Output bundled file");
			console.log("  -i, --inlinedLibraries <list>   Comma-separated libraries to inline");
			console.log("  -h, --help                      Show this help message");
			process.exit(0);
		}
	}
	if (!options.entry || !options.output) {
		console.error("Error: Missing required arguments");
		console.error("\nUsage: bundle-types -e <entry> -o <output> [-i <inlinedLibraries>]");
		process.exit(1);
	}
	return options;
}
if (import.meta.url === `file://${process.argv[1]}`) {
	const options = parseArgs();
	console.log(`Bundling types from ${path.resolve(options.entry)}...`);
	try {
		const bundledContent = bundleDts({
			entry: options.entry,
			inlinedLibraries: options.inlinedLibraries
		});
		const outputPath = path.resolve(options.output);
		const outputDir = path.dirname(outputPath);
		if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
		fs.writeFileSync(outputPath, bundledContent, "utf-8");
		console.log(`✓ Types bundled successfully to ${outputPath}`);
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

//#endregion
export { bundleDts };