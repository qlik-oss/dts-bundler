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
//#region src/helpers/binding-identifiers.ts
const collectBindingIdentifiersFromName = (name) => {
	const identifiers = [];
	const visitBindingName = (bindingName) => {
		if (ts.isIdentifier(bindingName)) {
			identifiers.push(bindingName);
			return;
		}
		if (ts.isObjectBindingPattern(bindingName)) {
			for (const element of bindingName.elements) visitBindingName(element.name);
			return;
		}
		if (ts.isArrayBindingPattern(bindingName)) for (const element of bindingName.elements) {
			if (ts.isOmittedExpression(element)) continue;
			visitBindingName(element.name);
		}
	};
	visitBindingName(name);
	return identifiers;
};
const collectBindingElementsFromDeclarations = (declarations) => {
	const identifiers = [];
	const visitBindingElement = (element) => {
		if (ts.isIdentifier(element.name)) {
			identifiers.push({
				identifier: element.name,
				element
			});
			return;
		}
		if (ts.isObjectBindingPattern(element.name)) {
			for (const child of element.name.elements) visitBindingElement(child);
			return;
		}
		if (ts.isArrayBindingPattern(element.name)) for (const child of element.name.elements) {
			if (ts.isOmittedExpression(child)) continue;
			visitBindingElement(child);
		}
	};
	for (const decl of declarations) {
		if (ts.isIdentifier(decl.name)) continue;
		if (ts.isObjectBindingPattern(decl.name)) for (const element of decl.name.elements) visitBindingElement(element);
		else if (ts.isArrayBindingPattern(decl.name)) for (const element of decl.name.elements) {
			if (ts.isOmittedExpression(element)) continue;
			visitBindingElement(element);
		}
	}
	return identifiers;
};
const hasBindingPatternInitializer = (declarations) => {
	const visitBindingElement = (element) => {
		if (element.initializer) return true;
		if (ts.isObjectBindingPattern(element.name)) return element.name.elements.some(visitBindingElement);
		if (ts.isArrayBindingPattern(element.name)) return element.name.elements.some((child) => !ts.isOmittedExpression(child) && visitBindingElement(child));
		return false;
	};
	return declarations.some((decl) => {
		if (ts.isIdentifier(decl.name)) return false;
		if (ts.isObjectBindingPattern(decl.name)) return decl.name.elements.some(visitBindingElement);
		if (ts.isArrayBindingPattern(decl.name)) return decl.name.elements.some((child) => !ts.isOmittedExpression(child) && visitBindingElement(child));
		return false;
	});
};

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
	importAliases;
	variableDeclaration;
	forceInclude;
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
		this.importAliases = /* @__PURE__ */ new Map();
		this.forceInclude = false;
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
	isDefaultImport;
	constructor(moduleName, importName, isTypeOnly = false, isDefaultImport = false) {
		this.moduleName = moduleName;
		this.originalName = importName;
		this.normalizedName = importName;
		this.isTypeOnly = isTypeOnly;
		this.isDefaultImport = isDefaultImport;
	}
};

//#endregion
//#region src/declaration-collector.ts
var DeclarationCollector = class DeclarationCollector {
	registry;
	fileCollector;
	options;
	defaultExportCounter = 0;
	constructor(registry, fileCollector, options) {
		this.registry = registry;
		this.fileCollector = fileCollector;
		this.options = options;
	}
	collectDeclarations(filePath, sourceFile, isEntry, onDefaultExportName) {
		for (const statement of sourceFile.statements) {
			if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
				this.parseExportAssignment(statement, filePath, sourceFile, isEntry, onDefaultExportName);
				continue;
			}
			if (!isDeclaration(statement)) continue;
			if (ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name) && statement.body && ts.isModuleBlock(statement.body)) {
				this.parseAmbientModule(statement, filePath, sourceFile);
				continue;
			}
			if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name) && statement.body && ts.isModuleBlock(statement.body)) {
				this.parseModuleAugmentation(statement, filePath, sourceFile, isEntry);
				continue;
			}
			this.parseDeclaration(statement, filePath, sourceFile, isEntry, onDefaultExportName);
		}
	}
	parseAmbientModule(moduleDecl, filePath, sourceFile) {
		if (!moduleDecl.body || !ts.isModuleBlock(moduleDecl.body)) return;
		const moduleName = moduleDecl.name.text;
		const resolvedModule = this.fileCollector.resolveModuleSpecifier(filePath, moduleName);
		if (!(this.fileCollector.shouldInline(moduleName) || (resolvedModule ? this.fileCollector.shouldInlineFilePath(resolvedModule) : false))) {
			if (!this.options.inlineDeclareExternals) return;
			const name = getDeclarationName(moduleDecl);
			if (!name) return;
			const declaration = new TypeDeclaration(name, filePath, moduleDecl, sourceFile, {
				kind: ExportKind.Named,
				wasOriginallyExported: true
			});
			this.registry.register(declaration);
			return;
		}
		for (const statement of moduleDecl.body.statements) {
			if (!isDeclaration(statement)) continue;
			const name = getDeclarationName(statement);
			if (!name) continue;
			const hasExport = hasExportModifier(statement);
			const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, {
				kind: hasExport ? ExportKind.Named : ExportKind.NotExported,
				wasOriginallyExported: hasExport
			});
			declaration.forceInclude = true;
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
		if (!name) {
			if (hasDefaultModifier(statement)) this.registerAnonymousDefaultDeclaration(statement, filePath, sourceFile, isEntry, onDefaultExportName);
			return;
		}
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
		if (hasDefaultExport) {
			exportInfo.kind = isEntry ? ExportKind.Default : ExportKind.DefaultOnly;
			wasOriginallyExported = true;
			if (isEntry) onDefaultExportName(name);
		}
		const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, {
			...exportInfo,
			wasOriginallyExported
		});
		this.registry.register(declaration);
	}
	parseExportAssignment(statement, filePath, sourceFile, isEntry, onDefaultExportName) {
		if (ts.isIdentifier(statement.expression)) return;
		const syntheticName = this.getSyntheticDefaultExportName();
		const exportInfo = {
			kind: isEntry ? ExportKind.Default : ExportKind.DefaultOnly,
			wasOriginallyExported: true
		};
		const declarationNode = DeclarationCollector.createDefaultExportVariable(statement, syntheticName);
		const declaration = new TypeDeclaration(syntheticName, filePath, declarationNode, sourceFile, exportInfo);
		if (ts.isVariableStatement(declarationNode)) declaration.variableDeclaration = declarationNode.declarationList.declarations[0];
		this.registry.register(declaration);
		if (isEntry) onDefaultExportName(syntheticName);
	}
	registerAnonymousDefaultDeclaration(statement, filePath, sourceFile, isEntry, onDefaultExportName) {
		if (!ts.isClassDeclaration(statement) && !ts.isFunctionDeclaration(statement)) return;
		const syntheticName = this.getSyntheticDefaultExportName();
		const exportInfo = {
			kind: isEntry ? ExportKind.Default : ExportKind.DefaultOnly,
			wasOriginallyExported: true
		};
		let namedNode;
		if (ts.isClassDeclaration(statement)) {
			const modifiers = DeclarationCollector.stripDefaultModifiers(statement);
			namedNode = ts.factory.updateClassDeclaration(statement, modifiers, ts.factory.createIdentifier(syntheticName), statement.typeParameters, statement.heritageClauses, statement.members);
		} else {
			const modifiers = DeclarationCollector.stripDefaultModifiers(statement);
			namedNode = ts.factory.updateFunctionDeclaration(statement, modifiers, statement.asteriskToken, ts.factory.createIdentifier(syntheticName), statement.typeParameters, statement.parameters, statement.type, statement.body);
		}
		ts.setTextRange(namedNode, statement);
		const declaration = new TypeDeclaration(syntheticName, filePath, namedNode, sourceFile, exportInfo);
		this.registry.register(declaration);
		if (isEntry) onDefaultExportName(syntheticName);
	}
	static createDefaultExportVariable(statement, name) {
		const declaration = ts.factory.createVariableDeclaration(ts.factory.createIdentifier(name), void 0, void 0, statement.expression);
		const declarationList = ts.factory.createVariableDeclarationList([declaration], ts.NodeFlags.Const);
		const variableStatement = ts.factory.createVariableStatement(void 0, declarationList);
		ts.setTextRange(variableStatement, statement);
		return variableStatement;
	}
	getSyntheticDefaultExportName() {
		const current = this.defaultExportCounter;
		this.defaultExportCounter += 1;
		if (current === 0) return "_default";
		return `_default$${current}`;
	}
	static stripDefaultModifiers(statement) {
		if (!ts.canHaveModifiers(statement)) return;
		const filtered = (ts.getModifiers(statement) ?? []).filter((mod) => mod.kind !== ts.SyntaxKind.DefaultKeyword && mod.kind !== ts.SyntaxKind.ExportKeyword);
		return filtered.length > 0 ? filtered : void 0;
	}
	parseVariableStatement(statement, filePath, sourceFile, isEntry) {
		const declarations = statement.declarationList.declarations;
		const hasBindingPattern = declarations.some((decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name));
		const hasExport = hasExportModifier(statement);
		const declareGlobal = isDeclareGlobal(statement);
		if (hasBindingPattern) {
			const identifiers = collectBindingElementsFromDeclarations(declarations);
			if (identifiers.length === 0) return;
			for (const { identifier, element } of identifiers) {
				const name = identifier.text;
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
				const synthetic = ts.factory.createVariableDeclaration(identifier, void 0, void 0, element.initializer);
				ts.setTextRange(synthetic, element);
				declaration.variableDeclaration = synthetic;
				this.registry.register(declaration);
			}
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
	parseModuleAugmentation(moduleDecl, filePath, sourceFile, isEntry) {
		const name = getDeclarationName(moduleDecl);
		if (!name) return;
		const hasExport = hasExportModifier(moduleDecl);
		const declareGlobal = isDeclareGlobal(moduleDecl);
		let isExported = isEntry ? hasExport : false;
		let wasOriginallyExported = this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported;
		if (declareGlobal && this.options.inlineDeclareGlobals) {
			isExported = true;
			wasOriginallyExported = true;
		}
		const declaration = new TypeDeclaration(name, filePath, moduleDecl, sourceFile, {
			kind: isExported ? ExportKind.Named : ExportKind.NotExported,
			wasOriginallyExported
		});
		this.registry.register(declaration);
	}
};

//#endregion
//#region src/helpers/default-export.ts
const resolveDefaultExportNameFromRegistry = (registry, filePath) => {
	const declarations = registry.declarationsByFile.get(filePath);
	if (!declarations) return null;
	for (const declId of declarations) {
		const decl = registry.getDeclaration(declId);
		if (!decl) continue;
		if (decl.exportInfo.kind === ExportKind.Default || decl.exportInfo.kind === ExportKind.DefaultOnly) return decl.name;
		if (ts.isStatement(decl.node) && hasDefaultModifier(decl.node)) return decl.name;
	}
	return null;
};
const findSyntheticDefaultName = (registry, filePath) => {
	const declarations = registry.declarationsByFile.get(filePath);
	if (!declarations) return null;
	for (const declId of declarations) {
		const decl = registry.getDeclaration(declId);
		if (decl && decl.name.startsWith("_default")) return decl.name;
	}
	return null;
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
//#region src/export-resolver.ts
var ExportResolver = class ExportResolver {
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
			if (isEntry) onEntryExportDefault(statement);
			this.parseExportDefault(statement, filePath);
		}
	}
	collectDirectNamespaceExports(filePath, sourceFile) {
		for (const statement of sourceFile.statements) {
			if (!ts.isExportDeclaration(statement)) continue;
			if (!statement.exportClause || !ts.isNamespaceExport(statement.exportClause)) continue;
			if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
			const exportName = statement.exportClause.name.text;
			const importPath = statement.moduleSpecifier.text;
			if (this.fileCollector.shouldInline(importPath)) {
				const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
				if (!resolvedPath) continue;
				this.registry.registerNamespaceExport(filePath, {
					name: exportName,
					targetFile: resolvedPath
				}, false);
			} else {
				const importName = `* as ${exportName}`;
				this.registry.registerExternal(importPath, importName, statement.isTypeOnly);
				this.registry.registerNamespaceExport(filePath, {
					name: exportName,
					externalModule: importPath,
					externalImportName: importName
				}, false);
			}
		}
	}
	collectFileExports(filePath, sourceFile, importMap, isEntry) {
		const fileImports = importMap.get(filePath);
		for (const statement of sourceFile.statements) {
			if (isDeclaration(statement) && hasExportModifier(statement)) {
				if (ts.isVariableStatement(statement)) {
					for (const declaration of statement.declarationList.declarations) {
						if (ts.isIdentifier(declaration.name)) {
							this.registry.registerExportedName(filePath, { name: declaration.name.text });
							continue;
						}
						if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) for (const identifier of collectBindingIdentifiersFromName(declaration.name)) this.registry.registerExportedName(filePath, { name: identifier.text });
					}
					continue;
				}
				const name = getDeclarationName(statement);
				if (name) this.registry.registerExportedName(filePath, { name });
				continue;
			}
			if (!ts.isExportDeclaration(statement)) continue;
			if (!statement.exportClause) {
				if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
				const importPath = statement.moduleSpecifier.text;
				if (this.fileCollector.shouldInline(importPath)) {
					const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
					if (resolvedPath) this.registry.registerStarExport(filePath, { targetFile: resolvedPath }, isEntry);
				} else this.registry.registerStarExport(filePath, {
					externalModule: importPath,
					isTypeOnly: statement.isTypeOnly
				}, isEntry);
				continue;
			}
			if (ts.isNamespaceExport(statement.exportClause)) {
				const exportName = statement.exportClause.name.text;
				const existingNamespaceInfo = this.registry.getNamespaceExportInfo(filePath, exportName);
				if (!existingNamespaceInfo) if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
					const importPath = statement.moduleSpecifier.text;
					if (this.fileCollector.shouldInline(importPath)) {
						const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
						if (resolvedPath) this.registry.registerNamespaceExport(filePath, {
							name: exportName,
							targetFile: resolvedPath
						});
					} else {
						const importName = `* as ${exportName}`;
						this.registry.registerExternal(importPath, importName, statement.isTypeOnly);
						this.registry.registerNamespaceExport(filePath, {
							name: exportName,
							externalModule: importPath,
							externalImportName: importName
						});
					}
				} else this.registry.registerExportedName(filePath, { name: exportName });
				else this.registry.registerExportedName(filePath, {
					name: exportName,
					externalModule: existingNamespaceInfo.externalModule,
					externalImportName: existingNamespaceInfo.externalImportName
				});
				if (isEntry) this.registry.registerEntryNamespaceExport(filePath, exportName);
				continue;
			}
			if (!ts.isNamedExports(statement.exportClause)) continue;
			if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
				const importPath = statement.moduleSpecifier.text;
				const isInline = this.fileCollector.shouldInline(importPath);
				const resolvedPath = isInline ? this.fileCollector.resolveImport(filePath, importPath) : null;
				for (const element of statement.exportClause.elements) {
					const exportedName = element.name.text;
					const originalName = element.propertyName?.text || exportedName;
					if (isInline && resolvedPath) {
						const namespaceInfo = this.registry.getNamespaceExportInfo(resolvedPath, originalName);
						if (namespaceInfo) {
							this.registry.registerNamespaceExport(filePath, {
								name: exportedName,
								targetFile: namespaceInfo.targetFile,
								externalModule: namespaceInfo.externalModule,
								externalImportName: namespaceInfo.externalImportName
							});
							if (isEntry) this.registry.registerEntryNamespaceExport(filePath, exportedName);
						} else {
							const resolvedOriginalName = originalName === "default" ? this.resolveDefaultExportName(resolvedPath) ?? originalName : originalName;
							const exportedInfo = this.findExportedNameInfo(resolvedPath, resolvedOriginalName);
							if (exportedInfo?.externalModule && exportedInfo.externalImportName) {
								const externalImportName = exportedName === resolvedOriginalName ? exportedInfo.externalImportName : `${ExportResolver.getExternalImportBaseName(exportedInfo.externalImportName)} as ${exportedName}`;
								this.registry.registerExportedName(filePath, {
									name: exportedName,
									externalModule: exportedInfo.externalModule,
									externalImportName,
									exportFrom: exportedInfo.exportFrom
								});
							} else {
								this.registry.registerExportedName(filePath, {
									name: exportedName,
									sourceFile: resolvedPath,
									originalName: resolvedOriginalName
								});
								const starResolved = exportedInfo ? null : this.resolveExternalStarExport(resolvedPath, resolvedOriginalName);
								if (starResolved) {
									const starImportName = exportedName === resolvedOriginalName ? starResolved.importName : `${ExportResolver.getExternalImportBaseName(starResolved.importName)} as ${exportedName}`;
									this.registry.registerExportedName(filePath, {
										name: exportedName,
										externalModule: starResolved.moduleName,
										externalImportName: starImportName,
										exportFrom: true
									});
								}
							}
						}
					} else if (!isInline) {
						const importName = originalName === exportedName ? originalName : `${originalName} as ${exportedName}`;
						this.registry.registerExternal(importPath, importName, statement.isTypeOnly);
						this.registry.registerExportedName(filePath, {
							name: exportedName,
							externalModule: importPath,
							externalImportName: importName
						});
					}
				}
				continue;
			}
			for (const element of statement.exportClause.elements) {
				const exportedName = element.name.text;
				const originalName = element.propertyName?.text || exportedName;
				const importInfo = fileImports?.get(originalName);
				let resolvedOriginalName = originalName;
				if (importInfo && !importInfo.isExternal && importInfo.sourceFile) if (importInfo.originalName === "default") resolvedOriginalName = this.resolveDefaultExportName(importInfo.sourceFile) ?? importInfo.originalName;
				else resolvedOriginalName = importInfo.originalName;
				if (importInfo && importInfo.isExternal && importInfo.sourceFile) this.registry.registerExportedName(filePath, {
					name: exportedName,
					externalModule: importInfo.sourceFile,
					externalImportName: importInfo.originalName
				});
				else if (importInfo && importInfo.sourceFile) this.registry.registerExportedName(filePath, {
					name: exportedName,
					sourceFile: importInfo.sourceFile,
					originalName: resolvedOriginalName
				});
				else this.registry.registerExportedName(filePath, { name: exportedName });
				const namespaceInfo = this.registry.getNamespaceExportInfo(filePath, originalName);
				if (namespaceInfo && exportedName !== originalName) {
					this.registry.registerNamespaceExport(filePath, {
						name: exportedName,
						targetFile: namespaceInfo.targetFile,
						externalModule: namespaceInfo.externalModule,
						externalImportName: namespaceInfo.externalImportName
					});
					if (isEntry) this.registry.registerEntryNamespaceExport(filePath, exportedName);
				}
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
						const isDefaultExport = exportedName === "default";
						if (declaration && !(exportedName !== resolvedOriginalName && !isDefaultExport)) {
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
					let resolvedOriginalName = originalName;
					if (importInfo && !importInfo.isExternal && importInfo.sourceFile) if (importInfo.originalName === "default") resolvedOriginalName = resolveDefaultExportNameFromRegistry(this.registry, importInfo.sourceFile) ?? importInfo.originalName;
					else resolvedOriginalName = importInfo.originalName;
					let key;
					if (importInfo && !importInfo.isExternal && importInfo.sourceFile) {
						const lookupName = importInfo.originalName === "default" ? resolvedOriginalName : importInfo.originalName;
						key = `${importInfo.sourceFile}:${lookupName}`;
					} else key = `${filePath}:${originalName}`;
					const moduleAugmentation = this.findModuleAugmentationDeclaration(filePath, originalName);
					if (moduleAugmentation) moduleAugmentation.exportInfo = {
						kind: ExportKind.Named,
						wasOriginallyExported: true
					};
					const declarationId = this.registry.nameIndex.get(key);
					if (declarationId && !moduleAugmentation) {
						const declaration = this.registry.getDeclaration(declarationId);
						const isReExportedImport = Boolean(importInfo && importInfo.sourceFile && importInfo.sourceFile !== filePath);
						if (declaration && (!isReExportedImport || !(resolvedOriginalName !== exportedName))) declaration.exportInfo = {
							kind: ExportKind.Named,
							wasOriginallyExported: true
						};
					}
				}
			}
		}
	}
	findExportedNameInfo(filePath, name) {
		const list = this.registry.exportedNamesByFile.get(filePath);
		if (!list) return null;
		return list.find((item) => item.name === name) ?? null;
	}
	resolveExternalStarExport(filePath, exportName) {
		const externalModules = this.registry.getStarExports(filePath).map((star) => star.externalModule).filter((moduleName) => Boolean(moduleName));
		if (externalModules.length === 0) return null;
		const checker = this.fileCollector.getTypeChecker();
		const sourceFile = this.fileCollector.getProgram().getSourceFile(filePath);
		if (sourceFile) {
			const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
			if (moduleSymbol) {
				const exportSymbol = checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === exportName);
				if (exportSymbol) {
					const declFile = (exportSymbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exportSymbol) : exportSymbol).declarations?.[0]?.getSourceFile();
					if (declFile) {
						const moduleName = getLibraryName(declFile.fileName);
						if (moduleName && externalModules.includes(moduleName)) return {
							moduleName,
							importName: exportName
						};
					}
				}
			}
		}
		return {
			moduleName: externalModules[externalModules.length - 1],
			importName: exportName
		};
	}
	static getExternalImportBaseName(importName) {
		if (importName.startsWith("default as ")) return "default";
		if (importName.startsWith("* as ")) return importName;
		if (importName.includes(" as ")) return importName.split(" as ")[0].trim();
		return importName;
	}
	findModuleAugmentationDeclaration(filePath, name) {
		const declarations = this.registry.declarationsByFile.get(filePath);
		if (!declarations) return null;
		for (const declId of declarations) {
			const declaration = this.registry.getDeclaration(declId);
			if (!declaration) continue;
			if (!ts.isModuleDeclaration(declaration.node)) continue;
			if (!ts.isIdentifier(declaration.node.name)) continue;
			if (declaration.node.name.text !== name) continue;
			return declaration;
		}
		return null;
	}
	applyStarExports() {
		if (this.registry.entryStarExports.length === 0) return;
		const visitedFiles = /* @__PURE__ */ new Set();
		for (const entry of this.registry.entryStarExports) if (entry.info.targetFile) this.markStarExportedDeclarations(entry.info.targetFile, visitedFiles);
	}
	markStarExportedDeclarations(filePath, visitedFiles) {
		if (visitedFiles.has(filePath)) return;
		visitedFiles.add(filePath);
		const fileDeclarations = this.registry.declarationsByFile.get(filePath);
		if (fileDeclarations) for (const declId of fileDeclarations) {
			const declaration = this.registry.getDeclaration(declId);
			if (!declaration) continue;
			if (!ts.isStatement(declaration.node)) continue;
			if (!hasExportModifier(declaration.node)) continue;
			if (hasDefaultModifier(declaration.node)) continue;
			if (declaration.exportInfo.kind === ExportKind.Equals) continue;
			if (declaration.exportInfo.kind === ExportKind.Default || declaration.exportInfo.kind === ExportKind.DefaultOnly) continue;
			declaration.exportInfo = {
				kind: ExportKind.Named,
				wasOriginallyExported: true
			};
		}
		for (const starExport of this.registry.getStarExports(filePath)) if (starExport.targetFile) this.markStarExportedDeclarations(starExport.targetFile, visitedFiles);
	}
	resolveDefaultExportName(resolvedPath) {
		const registryDefault = resolveDefaultExportNameFromRegistry(this.registry, resolvedPath);
		if (registryDefault) return registryDefault;
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
	options;
	constructor(registry, fileCollector, options) {
		this.registry = registry;
		this.fileCollector = fileCollector;
		this.options = { inlineDeclareExternals: options?.inlineDeclareExternals ?? false };
	}
	parseImports(filePath, sourceFile) {
		const fileImports = /* @__PURE__ */ new Map();
		for (const statement of sourceFile.statements) if (ts.isImportDeclaration(statement)) this.parseImport(statement, filePath, fileImports);
		else if (ts.isImportEqualsDeclaration(statement)) this.parseImportEquals(statement, filePath, fileImports);
		for (const statement of sourceFile.statements) if (ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name) && statement.body && ts.isModuleBlock(statement.body)) {
			const moduleName = statement.name.text;
			if (!(this.fileCollector.shouldInline(moduleName) || this.options.inlineDeclareExternals)) continue;
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
					aliasName: localName !== originalName ? localName : null,
					isTypeOnly
				});
			}
			if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
				const localName = importClause.namedBindings.name.text;
				fileImports.set(localName, {
					originalName: `* as ${localName}`,
					sourceFile: resolvedPath,
					isExternal: false,
					aliasName: null,
					isTypeOnly
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
					aliasName: null,
					isTypeOnly
				});
				this.registry.registerExternal(moduleName, `default as ${localName}`, isTypeOnly, true);
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
						aliasName: localName !== originalName ? localName : null,
						isTypeOnly
					});
					this.registry.registerExternal(moduleName, importName, isTypeOnly);
				}
				else if (ts.isNamespaceImport(statement.importClause.namedBindings)) {
					const localName = statement.importClause.namedBindings.name.text;
					fileImports.set(localName, {
						originalName: `* as ${localName}`,
						sourceFile: moduleName,
						isExternal: true,
						aliasName: null,
						isTypeOnly
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
				aliasName: null,
				isTypeOnly
			});
		} else {
			fileImports.set(importName, {
				originalName: `= ${importName}`,
				sourceFile: importPath,
				isExternal: true,
				aliasName: null,
				isTypeOnly
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
		this.options = {
			inlineDeclareGlobals: options?.inlineDeclareGlobals ?? false,
			inlineDeclareExternals: options?.inlineDeclareExternals ?? false
		};
		this.importParser = new ImportParser(registry, fileCollector, { inlineDeclareExternals: this.options.inlineDeclareExternals });
		this.declarationCollector = new DeclarationCollector(registry, fileCollector, this.options);
		this.exportResolver = new ExportResolver(registry, fileCollector);
	}
	parseFiles(files) {
		for (const [filePath, { sourceFile }] of files.entries()) {
			const fileImports = this.importParser.parseImports(filePath, sourceFile);
			this.importMap.set(filePath, fileImports);
		}
		for (const [filePath, { sourceFile }] of files.entries()) this.exportResolver.collectDirectNamespaceExports(filePath, sourceFile);
		for (const [filePath, { sourceFile, isEntry }] of files.entries()) this.exportResolver.collectFileExports(filePath, sourceFile, this.importMap, isEntry);
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
		this.exportResolver.applyStarExports();
	}
};

//#endregion
//#region src/dependency-analyzer.ts
var DependencyAnalyzer = class DependencyAnalyzer {
	registry;
	importMap;
	entryFile;
	constructor(registry, importMap, entryFile) {
		this.registry = registry;
		this.importMap = importMap;
		this.entryFile = entryFile;
	}
	analyze() {
		this.trackEntryFileAliases();
		for (const declaration of this.registry.declarations.values()) this.analyzeDependencies(declaration);
	}
	trackEntryFileAliases() {
		if (!this.entryFile) return;
		const fileImports = this.importMap.get(this.entryFile);
		if (!fileImports) return;
		const entryTypeRefs = this.collectEntryTypeReferences(this.entryFile);
		for (const [, importInfo] of fileImports.entries()) if (!importInfo.isExternal && importInfo.aliasName && entryTypeRefs.has(importInfo.aliasName)) {
			const key = `${importInfo.sourceFile}:${importInfo.originalName}`;
			const declId = this.registry.nameIndex.get(key);
			if (declId) {
				const decl = this.registry.getDeclaration(declId);
				if (decl) decl.normalizedName = importInfo.aliasName;
			}
		}
	}
	collectEntryTypeReferences(entryFile) {
		const refs = /* @__PURE__ */ new Set();
		const declarations = this.registry.declarationsByFile.get(entryFile);
		if (!declarations) return refs;
		const visit = (node) => {
			if (ts.isTypeReferenceNode(node)) {
				const typeName = node.typeName;
				if (ts.isIdentifier(typeName)) refs.add(typeName.text);
				else if (ts.isQualifiedName(typeName)) {
					const leftmost = DependencyAnalyzer.getLeftmostEntityName(typeName);
					if (leftmost) refs.add(leftmost);
				}
			}
			if (ts.isTypeQueryNode(node)) {
				const leftmost = DependencyAnalyzer.getLeftmostEntityName(node.exprName);
				if (leftmost) refs.add(leftmost);
			}
			node.forEachChild(visit);
		};
		for (const declId of declarations) {
			const decl = this.registry.getDeclaration(declId);
			if (decl) visit(decl.node);
		}
		return refs;
	}
	static getLeftmostEntityName(entity) {
		let current = entity;
		while (ts.isQualifiedName(current)) current = current.left;
		return ts.isIdentifier(current) ? current.text : null;
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
					let originalName = importInfo.originalName;
					if (originalName === "default") {
						const defaultName = this.getDefaultExportName(importInfo.sourceFile);
						if (defaultName) originalName = defaultName;
					}
					const importedKey = `${importInfo.sourceFile}:${refName}`;
					const originalKey = `${importInfo.sourceFile}:${originalName}`;
					const hasImportedDecl = this.registry.nameIndex.has(importedKey);
					const hasOriginalDecl = this.registry.nameIndex.has(originalKey);
					if (importInfo.aliasName || refName !== originalName) {
						const aliasEntry = {
							sourceFile: importInfo.sourceFile,
							originalName
						};
						if (!importInfo.aliasName && !hasImportedDecl && hasOriginalDecl && refName !== originalName) aliasEntry.qualifiedName = `${originalName}.${refName}`;
						declaration.importAliases.set(refName, aliasEntry);
					}
					const key = `${importInfo.sourceFile}:${originalName}`;
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
	getDefaultExportName(sourceFile) {
		const declarations = this.registry.declarationsByFile.get(sourceFile);
		if (!declarations) return null;
		for (const declId of declarations) {
			const decl = this.registry.getDeclaration(declId);
			if (!decl) continue;
			if (decl.exportInfo.kind === ExportKind.Default || decl.exportInfo.kind === ExportKind.DefaultOnly || ts.isStatement(decl.node) && hasDefaultModifier(decl.node)) return decl.name;
		}
		return null;
	}
	extractTypeReferences(node, references) {
		if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) references.add(node.name.text);
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
		if (ts.isPropertyAccessExpression(node)) DependencyAnalyzer.extractPropertyAccess(node, references);
		const isCtsFile = (() => {
			const sourceFile = node.getSourceFile();
			if (!sourceFile) return false;
			const ext = path.extname(sourceFile.fileName).toLowerCase();
			return ext === ".cts" || ext === ".d.cts";
		})();
		const processHeritageClauses = () => {
			if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.heritageClauses) {
				for (const clause of node.heritageClauses) for (const type of clause.types) if (ts.isIdentifier(type.expression)) references.add(type.expression.text);
				else if (ts.isPropertyAccessExpression(type.expression)) DependencyAnalyzer.extractPropertyAccess(type.expression, references);
			}
		};
		if (!isCtsFile) processHeritageClauses();
		node.forEachChild((child) => {
			this.extractTypeReferences(child, references);
		});
		if (isCtsFile) processHeritageClauses();
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
		const entryExt = path.extname(this.entryFile).toLowerCase();
		if (entryExt === ".cts" || entryExt === ".mts" || entryExt === ".cjs" || entryExt === ".mjs") {
			compilerOptions.moduleResolution = ts.ModuleResolutionKind.NodeNext;
			if (compilerOptions.module === void 0) compilerOptions.module = ts.ModuleKind.NodeNext;
		}
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
	shouldInlineFilePath(filePath) {
		const sourceFile = this.program.getSourceFile(filePath);
		if (sourceFile) return this.shouldInlineFile(sourceFile);
		const libraryName = getLibraryName(filePath);
		if (libraryName === null) return true;
		if (this.inlinedLibrariesSet.has(libraryName)) return true;
		return false;
	}
	getProgram() {
		return this.program;
	}
	getTypeChecker() {
		return this.typeChecker;
	}
	getCompilerOptions() {
		return this.program.getCompilerOptions();
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
			const lastDotIndex = importPath.lastIndexOf(".");
			if (lastDotIndex > 0 && lastDotIndex > importPath.lastIndexOf("/")) {
				const ext = importPath.substring(lastDotIndex);
				if (![
					".ts",
					".tsx",
					".js",
					".mjs",
					".cjs",
					".mts",
					".cts"
				].includes(ext)) {
					const arbitraryDeclPath = `${resolved}.d${ext}.ts`;
					if (fs.existsSync(arbitraryDeclPath)) return arbitraryDeclPath;
				}
			}
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
	resolveModuleSpecifier(fromFile, importPath) {
		return ts.resolveModuleName(importPath, fromFile, this.program.getCompilerOptions(), ts.sys).resolvedModule?.resolvedFileName ?? null;
	}
	collectFiles() {
		const files = /* @__PURE__ */ new Map();
		const sourceFiles = this.program.getSourceFiles();
		const createCollectedFile = (sourceFile, isEntry) => {
			const filePath = sourceFile.fileName;
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
			return {
				content,
				sourceFile,
				isEntry,
				hasEmptyExport,
				referencedTypes
			};
		};
		for (const sourceFile of sourceFiles) {
			if (!this.shouldInlineFile(sourceFile)) continue;
			const filePath = sourceFile.fileName;
			const isEntry = filePath === this.entryFile;
			files.set(filePath, createCollectedFile(sourceFile, isEntry));
		}
		const queue = Array.from(files.keys());
		while (queue.length > 0) {
			const currentPath = queue.shift();
			if (!currentPath) continue;
			const current = files.get(currentPath);
			if (!current) continue;
			for (const statement of current.sourceFile.statements) {
				let moduleSpecifier;
				if (ts.isImportDeclaration(statement)) moduleSpecifier = statement.moduleSpecifier;
				else if (ts.isExportDeclaration(statement)) moduleSpecifier = statement.moduleSpecifier;
				else if (ts.isImportEqualsDeclaration(statement)) {
					if (ts.isExternalModuleReference(statement.moduleReference)) moduleSpecifier = statement.moduleReference.expression;
				}
				if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue;
				const importPath = moduleSpecifier.text;
				const resolvedPath = this.resolveImport(currentPath, importPath);
				if (!resolvedPath || files.has(resolvedPath)) continue;
				if (!fs.existsSync(resolvedPath)) continue;
				const content = fs.readFileSync(resolvedPath, "utf-8");
				const sourceFile = ts.createSourceFile(resolvedPath, content, ts.ScriptTarget.Latest, true);
				if (!this.shouldInlineFile(sourceFile)) continue;
				files.set(resolvedPath, createCollectedFile(sourceFile, false));
				queue.push(resolvedPath);
			}
		}
		return files;
	}
};

//#endregion
//#region src/name-normalizer.ts
var NameNormalizer = class NameNormalizer {
	registry;
	nameCounter;
	entryFile;
	constructor(registry, entryFile) {
		this.registry = registry;
		this.nameCounter = /* @__PURE__ */ new Map();
		this.entryFile = entryFile;
	}
	normalize() {
		const byName = /* @__PURE__ */ new Map();
		const entrySourceOrder = this.getEntrySourceOrder();
		const entryNameSourceOrder = this.getEntryNameSourceOrder();
		for (const declaration of this.registry.declarations.values()) {
			const name = declaration.normalizedName;
			if (!byName.has(name)) byName.set(name, []);
			byName.get(name)?.push(declaration);
		}
		for (const [name, declarations] of byName.entries()) if (declarations.length > 1) {
			const hasInlineAugmentation = declarations.some((decl) => decl.forceInclude);
			const allInterfaces = declarations.every((decl) => ts.isInterfaceDeclaration(decl.node));
			const hasModuleDeclaration = declarations.some((decl) => ts.isModuleDeclaration(decl.node));
			const hasInterfaceDeclaration = declarations.some((decl) => ts.isInterfaceDeclaration(decl.node));
			const allInterfacesOrModules = declarations.every((decl) => ts.isInterfaceDeclaration(decl.node) || ts.isModuleDeclaration(decl.node));
			if (hasInlineAugmentation && allInterfaces) continue;
			if (hasModuleDeclaration && hasInterfaceDeclaration && allInterfacesOrModules) continue;
			const grouped = /* @__PURE__ */ new Map();
			declarations.forEach((decl, index) => {
				const group = grouped.get(decl.sourceFile);
				const isExported = decl.exportInfo.kind !== ExportKind.NotExported || decl.exportInfo.wasOriginallyExported;
				if (!group) {
					grouped.set(decl.sourceFile, {
						sourceFile: decl.sourceFile,
						declarations: [decl],
						firstIndex: index,
						exported: isExported,
						hasExportEquals: decl.exportInfo.kind === ExportKind.Equals
					});
					return;
				}
				group.declarations.push(decl);
				if (isExported) group.exported = true;
				if (decl.exportInfo.kind === ExportKind.Equals) group.hasExportEquals = true;
			});
			const orderedGroups = Array.from(grouped.values()).sort((a, b) => {
				if (a.exported !== b.exported) return a.exported ? -1 : 1;
				if (a.hasExportEquals !== b.hasExportEquals) return a.hasExportEquals ? 1 : -1;
				const nameOrder = entryNameSourceOrder.get(name);
				const aNameOrder = nameOrder?.get(a.sourceFile);
				const bNameOrder = nameOrder?.get(b.sourceFile);
				if (aNameOrder !== void 0 && bNameOrder !== void 0 && aNameOrder !== bNameOrder) return aNameOrder - bNameOrder;
				const aEntryOrder = entrySourceOrder.get(a.sourceFile);
				const bEntryOrder = entrySourceOrder.get(b.sourceFile);
				if (aEntryOrder !== void 0 && bEntryOrder !== void 0 && aEntryOrder !== bEntryOrder) return aEntryOrder - bEntryOrder;
				if (aEntryOrder !== void 0 && bEntryOrder === void 0) return -1;
				if (aEntryOrder === void 0 && bEntryOrder !== void 0) return 1;
				return a.firstIndex - b.firstIndex;
			});
			for (let i = 1; i < orderedGroups.length; i++) {
				const counter = this.nameCounter.get(name) || 1;
				this.nameCounter.set(name, counter + 1);
				const normalized = `${name}$${counter}`;
				for (const decl of orderedGroups[i].declarations) decl.normalizedName = normalized;
			}
		}
		this.normalizeExternalImports();
		this.normalizeExternalNamespaceImports();
		const protectedExternalNames = this.getProtectedExternalNames();
		this.normalizeDeclarationProtectedExternalConflicts(protectedExternalNames);
		this.normalizeExternalImportDeclarationConflicts();
	}
	getProtectedExternalNames() {
		if (!this.entryFile) return /* @__PURE__ */ new Set();
		const protectedNames = /* @__PURE__ */ new Set();
		const exported = this.registry.exportedNamesByFile.get(this.entryFile) ?? [];
		for (const info of exported) if (info.externalModule && info.externalImportName) protectedNames.add(info.name);
		for (const entry of this.registry.entryNamespaceExports) {
			if (entry.sourceFile !== this.entryFile) continue;
			const info = this.registry.getNamespaceExportInfo(entry.sourceFile, entry.name);
			if (info?.externalModule && info.externalImportName) protectedNames.add(entry.name);
		}
		return protectedNames;
	}
	getEntrySourceOrder() {
		const order = /* @__PURE__ */ new Map();
		if (!this.entryFile) return order;
		(this.registry.exportedNamesByFile.get(this.entryFile) ?? []).forEach((info, index) => {
			if (!info.sourceFile) return;
			if (!order.has(info.sourceFile)) order.set(info.sourceFile, index);
		});
		return order;
	}
	getEntryNameSourceOrder() {
		const orderByName = /* @__PURE__ */ new Map();
		if (!this.entryFile) return orderByName;
		(this.registry.exportedNamesByFile.get(this.entryFile) ?? []).forEach((info, index) => {
			if (!info.sourceFile) return;
			const originalName = info.originalName ?? info.name;
			const perName = orderByName.get(originalName) ?? /* @__PURE__ */ new Map();
			if (!perName.has(info.sourceFile)) perName.set(info.sourceFile, index);
			orderByName.set(originalName, perName);
		});
		return orderByName;
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
	normalizeExternalNamespaceImports() {
		for (const moduleImports of this.registry.externalImports.values()) {
			const namespaceImports = Array.from(moduleImports.values()).filter((imp) => imp.originalName.startsWith("* as "));
			if (namespaceImports.length <= 1) continue;
			const canonical = namespaceImports[0];
			const canonicalName = NameNormalizer.extractImportName(canonical.normalizedName);
			for (let i = 1; i < namespaceImports.length; i++) namespaceImports[i].normalizedName = `* as ${canonicalName}`;
		}
	}
	normalizeDeclarationProtectedExternalConflicts(protectedExternalNames) {
		if (protectedExternalNames.size === 0) return;
		const usedNames = /* @__PURE__ */ new Set();
		for (const declaration of this.registry.declarations.values()) usedNames.add(declaration.normalizedName);
		for (const moduleImports of this.registry.externalImports.values()) for (const externalImport of moduleImports.values()) usedNames.add(NameNormalizer.extractImportName(externalImport.normalizedName));
		for (const declaration of this.registry.declarations.values()) {
			const current = declaration.normalizedName;
			if (!protectedExternalNames.has(current)) continue;
			let counter = 1;
			let candidate = `${current}$${counter}`;
			while (usedNames.has(candidate)) {
				counter += 1;
				candidate = `${current}$${counter}`;
			}
			declaration.normalizedName = candidate;
			usedNames.add(candidate);
		}
	}
	normalizeExternalImportDeclarationConflicts() {
		const declarationNames = /* @__PURE__ */ new Set();
		for (const declaration of this.registry.declarations.values()) declarationNames.add(declaration.normalizedName);
		if (declarationNames.size === 0) return;
		const usedNames = new Set(declarationNames);
		for (const moduleImports of this.registry.externalImports.values()) for (const externalImport of moduleImports.values()) usedNames.add(NameNormalizer.extractImportName(externalImport.normalizedName));
		for (const moduleImports of this.registry.externalImports.values()) for (const externalImport of moduleImports.values()) {
			const importName = NameNormalizer.extractImportName(externalImport.normalizedName);
			if (!declarationNames.has(importName)) continue;
			let counter = 1;
			let candidate = `${importName}$${counter}`;
			while (usedNames.has(candidate)) {
				counter += 1;
				candidate = `${importName}$${counter}`;
			}
			externalImport.normalizedName = NameNormalizer.replaceImportLocalName(externalImport.normalizedName, candidate);
			usedNames.add(candidate);
		}
	}
	static replaceImportLocalName(importStr, newLocalName) {
		if (importStr.startsWith("default as ")) return `default as ${newLocalName}`;
		if (importStr.startsWith("* as ")) return `* as ${newLocalName}`;
		if (importStr.includes(" as ")) {
			const [original] = importStr.split(" as ");
			return `${original} as ${newLocalName}`;
		}
		return `${importStr} as ${newLocalName}`;
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
		const transformed = options.renameMap || options.qualifiedNameMap ? AstPrinter.applyRenameTransformer(node, options.renameMap, options.qualifiedNameMap) : node;
		return this.printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile);
	}
	printStatement(statement, sourceFile, options = {}) {
		const transformed = options.renameMap || options.qualifiedNameMap ? AstPrinter.applyRenameTransformer(statement, options.renameMap, options.qualifiedNameMap) : statement;
		return this.printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile);
	}
	static applyRenameTransformer(node, renameMap, qualifiedNameMap) {
		const transformer = (context) => {
			const visit = (current) => {
				if (qualifiedNameMap && ts.isQualifiedName(current)) {
					const left = current.left;
					const right = current.right;
					if (ts.isIdentifier(left) && ts.isIdentifier(right)) {
						const key = `${left.text}.${right.text}`;
						const replacementName = qualifiedNameMap.get(key);
						if (replacementName) {
							const replacement = ts.factory.createIdentifier(replacementName);
							ts.setTextRange(replacement, current);
							return replacement;
						}
					}
				}
				if (qualifiedNameMap && ts.isPropertyAccessExpression(current)) {
					const expression = current.expression;
					const name = current.name;
					if (ts.isIdentifier(expression) && ts.isIdentifier(name)) {
						const key = `${expression.text}.${name.text}`;
						const replacementName = qualifiedNameMap.get(key);
						if (replacementName) {
							const replacement = ts.factory.createIdentifier(replacementName);
							ts.setTextRange(replacement, current);
							return replacement;
						}
					}
				}
				if (ts.isIdentifier(current)) {
					const parent = current.parent;
					if (parent && ts.isModuleDeclaration(parent) && parent.name === current) return current;
					const renamed = renameMap?.get(current.text);
					if (renamed && renamed !== current.text) {
						if (renamed.includes(".")) {
							if (parent && ts.isQualifiedName(parent) && parent.left === current) {
								const replacement = AstPrinter.createQualifiedNameFromString(renamed);
								ts.setTextRange(replacement, current);
								return replacement;
							}
							if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
								const replacement = AstPrinter.createPropertyAccessFromString(renamed);
								ts.setTextRange(replacement, current);
								return replacement;
							}
						}
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
	static createQualifiedNameFromString(name) {
		const parts = name.split(".");
		let current = ts.factory.createIdentifier(parts[0]);
		for (let i = 1; i < parts.length; i += 1) current = ts.factory.createQualifiedName(current, ts.factory.createIdentifier(parts[i]));
		return current;
	}
	static createPropertyAccessFromString(name) {
		const parts = name.split(".");
		let current = ts.factory.createIdentifier(parts[0]);
		for (let i = 1; i < parts.length; i += 1) current = ts.factory.createPropertyAccessExpression(current, parts[i]);
		return current;
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
//#region src/helpers/entry-exports.ts
const collectDeclarationExternalImports = (registry, usedDeclarations) => {
	const externalImports = /* @__PURE__ */ new Set();
	for (const declId of usedDeclarations) {
		const declaration = registry.getDeclaration(declId);
		if (!declaration) continue;
		for (const [moduleName, importNames] of declaration.externalDependencies.entries()) for (const importName of importNames) externalImports.add(`${moduleName}:${importName}`);
	}
	return externalImports;
};
const resolveEntryExportOriginalName = (registry, entryFile, exported) => {
	const sourceFile = exported.sourceFile ?? entryFile;
	let originalName = exported.originalName ?? exported.name;
	if (originalName === "default" && exported.sourceFile) {
		const resolvedDefault = resolveDefaultExportNameFromRegistry(registry, exported.sourceFile);
		if (resolvedDefault) originalName = resolvedDefault;
		else {
			const syntheticDefault = findSyntheticDefaultName(registry, exported.sourceFile);
			if (syntheticDefault) originalName = syntheticDefault;
		}
	}
	if (exported.sourceFile && originalName === "default") {
		const syntheticDefault = findSyntheticDefaultName(registry, exported.sourceFile);
		if (syntheticDefault) originalName = syntheticDefault;
	}
	return {
		sourceFile,
		originalName
	};
};
const shouldSkipEntryExport = (registry, entryFile, exported) => {
	const { sourceFile, originalName } = resolveEntryExportOriginalName(registry, entryFile, exported);
	if (originalName !== exported.name) return false;
	const declId = registry.nameIndex.get(`${sourceFile}:${originalName}`);
	if (!declId) return false;
	const decl = registry.getDeclaration(declId);
	if (!decl) return false;
	return decl.exportInfo.kind === ExportKind.Named || decl.exportInfo.wasOriginallyExported;
};
const buildEntryExportData = (params) => {
	const exportFromByModule = /* @__PURE__ */ new Map();
	const exportListItems = [];
	const exportListSet = /* @__PURE__ */ new Set();
	const excludedExternalImports = /* @__PURE__ */ new Set();
	const requiredExternalImports = /* @__PURE__ */ new Set();
	const entryFile = params.entryFile;
	if (!entryFile) return {
		exportFromByModule,
		exportListItems,
		excludedExternalImports,
		requiredExternalImports
	};
	const declarationExternalImports = collectDeclarationExternalImports(params.registry, params.usedDeclarations);
	const exportedNames = params.registry.exportedNamesByFile.get(entryFile) ?? [];
	const namespaceExports = new Set(params.registry.entryNamespaceExports.filter((entry) => entry.sourceFile === entryFile).map((entry) => entry.name));
	const moduleAugmentations = /* @__PURE__ */ new Set();
	const entryDeclarations = params.registry.declarationsByFile.get(entryFile);
	if (entryDeclarations) for (const declId of entryDeclarations) {
		const decl = params.registry.getDeclaration(declId);
		if (decl && ts.isModuleDeclaration(decl.node) && ts.isIdentifier(decl.node.name)) moduleAugmentations.add(decl.node.name.text);
	}
	for (const exported of exportedNames) {
		if (exported.name === "default") continue;
		if (namespaceExports.has(exported.name)) continue;
		if (moduleAugmentations.has(exported.name)) continue;
		if (exported.externalModule && exported.externalImportName) {
			const importName = params.getNormalizedExternalImportName(exported.externalModule, exported.externalImportName);
			const importKey = `${exported.externalModule}:${exported.externalImportName}`;
			if (exported.exportFrom && !declarationExternalImports.has(importKey)) {
				const list = exportFromByModule.get(exported.externalModule) ?? [];
				list.push(importName);
				exportFromByModule.set(exported.externalModule, list);
				excludedExternalImports.add(importKey);
				continue;
			}
			requiredExternalImports.add(importKey);
			const exportName = params.extractImportName(importName);
			if (!exportListSet.has(exportName)) {
				exportListSet.add(exportName);
				exportListItems.push(exportName);
			}
			continue;
		}
		const { sourceFile, originalName } = resolveEntryExportOriginalName(params.registry, entryFile, exported);
		const normalizedOriginal = params.nameMap.get(`${sourceFile}:${originalName}`) ?? originalName;
		const exportItem = normalizedOriginal === exported.name ? normalizedOriginal : `${normalizedOriginal} as ${exported.name}`;
		if (shouldSkipEntryExport(params.registry, entryFile, exported)) continue;
		if (!exportListSet.has(exportItem)) {
			exportListSet.add(exportItem);
			exportListItems.push(exportItem);
		}
	}
	const getExportedName = (item) => {
		if (item.includes(" as ")) return item.split(" as ")[1]?.trim() ?? item.trim();
		return item.trim();
	};
	exportListItems.sort((a, b) => getExportedName(a).localeCompare(getExportedName(b)));
	return {
		exportFromByModule,
		exportListItems,
		excludedExternalImports,
		requiredExternalImports
	};
};

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
function stripLeadingJsDoc(text) {
	return text.replace(/^(?:\s*\/\*\*[\s\S]*?\*\/\s*\n)*/, "");
}
function stripLeadingNonJsDoc(text) {
	return text.replace(/^(?:\s*\/\/[^\n]*\n|\s*\/\*(?!\*)[\s\S]*?\*\/\s*\n)*/, "");
}
function stripLeadingAllComments(text) {
	return text.replace(/^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*\n)*/, "");
}
function normalizePrintedStatement(text, node, originalText, options = {}) {
	const preserveJsDoc = options.preserveJsDoc ?? true;
	let result = text.replace(/\t/g, "  ");
	result = normalizeIndentation(result);
	result = collapseGenericArguments(result);
	result = result.replace(/<([^>]*?)\n\s*([^>]*?)>/g, (match, first, second) => {
		return `<${String(first).trim()} ${String(second).trim()}>`;
	});
	if (!preserveJsDoc) result = stripLeadingJsDoc(result);
	if (ts.isVariableStatement(node) && originalText && /,\s*\n/.test(originalText)) result = result.replace(/,\s+/g, ",\n  ");
	if (ts.isVariableStatement(node)) {
		result = preserveJsDoc ? stripLeadingNonJsDoc(result) : stripLeadingAllComments(result);
		result = result.replace(/:\s*([^;]+);/g, (match, typeText) => {
			return `: ${String(typeText).replace(/\s*\n\s*/g, " ").trim()};`;
		});
		result = result.replace(/\{\s*([A-Za-z_$][\w$]*\??\s*:\s*[^;{}]+)\s*;\s*\}/g, "{ $1 }");
	}
	if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) result = collapseEmptyBlocks(result);
	if (ts.isModuleDeclaration(node)) {
		result = preserveJsDoc ? stripLeadingNonJsDoc(result) : stripLeadingAllComments(result);
		if (originalText) {
			const header = originalText.split("{")[0] ?? originalText;
			const isDeclareModule = /\bdeclare\s+module\b/.test(header);
			const isNamespace = /\bnamespace\b/.test(header);
			const isModule = /\bmodule\b/.test(header);
			if (!isDeclareModule && isModule && !isNamespace) result = result.replace(/^(\s*(?:export\s+)?(?:declare\s+)?)(module)(\b)/, "$1namespace$3");
		}
		result = collapseEmptyBlocks(result);
	}
	if (ts.isEnumDeclaration(node)) {
		if ((result.split("{")[1] ?? "").includes("\n")) result = result.replace(/(^\s*[^\n{}]+)(\n)(?=\s*(?:[^\n{}]|\}))/gm, (match, line, newline) => {
			const trimmed = String(line).trim();
			if (trimmed.length === 0) return match;
			if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/")) return match;
			if (trimmed.endsWith(",") || trimmed.endsWith("{") || trimmed.endsWith("}")) return match;
			return `${line},${newline}`;
		});
	}
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
			const preserveJsDoc = VariableDeclarationEmitter.shouldPreserveJsDoc(orderedDeclarations, false);
			return [this.printStatement(statementNode, statement, orderedDeclarations, preserveJsDoc)];
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
			const preserveJsDoc = VariableDeclarationEmitter.shouldPreserveJsDoc(group, shouldExport);
			lines.push(this.printStatement(statementNode, statement, group, preserveJsDoc));
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
		if (!statement.getSourceFile()) {
			const pos = statement.pos;
			const end = statement.end;
			ts.setTextRange(variableStatement, {
				pos,
				end
			});
			return variableStatement;
		}
		const pos = statement.pos >= 0 ? statement.pos : 0;
		const end = statement.end >= 0 ? statement.end : pos;
		ts.setTextRange(variableStatement, {
			pos,
			end
		});
		return variableStatement;
	}
	buildVariableDeclarationList(statement, declarations) {
		const statementDeclarations = statement.declarationList.declarations;
		if (statementDeclarations.some((decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name))) {
			if (hasBindingPatternInitializer(statementDeclarations)) return statement.declarationList;
			if (!statementDeclarations.every((decl) => ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name))) return statement.declarationList;
			const identifiers = [];
			for (const decl of statementDeclarations) identifiers.push(...collectBindingIdentifiersFromName(decl.name));
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
			let type = this.checker.getTypeAtLocation(varDecl.name);
			let typeNode;
			if (varDecl.initializer) {
				if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) type = this.checker.getTypeAtLocation(varDecl.initializer);
				if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
					if (ts.isNumericLiteral(varDecl.initializer)) typeNode = ts.factory.createLiteralTypeNode(ts.factory.createNumericLiteral(varDecl.initializer.text));
					else if (ts.isStringLiteral(varDecl.initializer)) typeNode = ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(varDecl.initializer.text));
					else if (varDecl.initializer.kind === ts.SyntaxKind.TrueKeyword) typeNode = ts.factory.createLiteralTypeNode(ts.factory.createTrue());
					else if (varDecl.initializer.kind === ts.SyntaxKind.FalseKeyword) typeNode = ts.factory.createLiteralTypeNode(ts.factory.createFalse());
				}
			}
			if (!typeNode) typeNode = this.checker.typeToTypeNode(type, void 0, ts.NodeBuilderFlags.NoTruncation);
			newDeclarations.push(ts.factory.createVariableDeclaration(name, void 0, typeNode, void 0));
		}
		if (newDeclarations.length === 0) return statement.declarationList;
		return ts.factory.createVariableDeclarationList(newDeclarations, statement.declarationList.flags);
	}
	printStatement(statementNode, sourceStatement, declarations, preserveJsDoc) {
		const renameMap = this.getRenameMap(declarations);
		const sourceFile = sourceStatement.getSourceFile();
		if (!sourceFile) {
			const fallbackSource = statementNode.getSourceFile();
			return normalizePrintedStatement(this.printer.printStatement(statementNode, fallbackSource, { renameMap }), sourceStatement, "", { preserveJsDoc });
		}
		return normalizePrintedStatement(this.printer.printStatement(statementNode, sourceFile, { renameMap }), sourceStatement, sourceStatement.getText(sourceFile), { preserveJsDoc });
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
	static shouldPreserveJsDoc(declarations, shouldExport) {
		if (shouldExport) return true;
		return declarations.some((decl) => decl.exportInfo.kind === ExportKind.Default || decl.exportInfo.kind === ExportKind.DefaultOnly);
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
	namespaceValueAliasesByFile;
	entryExportData = null;
	options;
	constructor(registry, usedDeclarations, usedExternals, options = {}) {
		this.registry = registry;
		this.usedDeclarations = usedDeclarations;
		this.usedExternals = usedExternals;
		this.nameMap = /* @__PURE__ */ new Map();
		this.extraDefaultExports = /* @__PURE__ */ new Set();
		this.astPrinter = new AstPrinter();
		this.namespaceValueAliasesByFile = this.collectNamespaceValueAliases();
		this.variableDeclarationEmitter = options.typeChecker ? new VariableDeclarationEmitter(options.typeChecker, (name) => this.extraDefaultExports.add(name), this.astPrinter, (declarations) => this.buildRenameMapForDeclarations(declarations)) : null;
		this.options = options;
	}
	generate() {
		const lines = [];
		const banner = !this.options.noBanner ? `// Generated by @qlik/dts-bundler@${version}` : null;
		const referenceDirectives = this.generateReferenceDirectives();
		const externalPrelude = this.generateExternalPrelude();
		this.buildNameMap();
		const declarations = this.generateDeclarations();
		const namespaces = this.generateNamespaces();
		const exportEquals = this.generateExportEquals();
		const starExports = this.generateStarExports();
		const namespaceExports = this.generateNamespaceExports();
		const namedExports = this.generateNamedExports();
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
		appendSection(externalPrelude.lines);
		appendSection(namespaces);
		appendSection(declarations);
		if (exportEquals.length > 0) lines.push(...exportEquals);
		appendSection(starExports);
		appendSection(namespaceExports.blocks);
		if (namespaceExports.exportList.length > 0) {
			if (lines.length > 0) lines.push("");
			lines.push(...namespaceExports.exportList);
		}
		if (namedExports.length > 0) {
			if (lines.length > 0) lines.push("");
			lines.push(...namedExports);
		}
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
			const namespaceImports = esImports.filter((imp) => imp.normalizedName.startsWith("* as "));
			const nonNamespaceImports = esImports.filter((imp) => !imp.normalizedName.startsWith("* as "));
			const emittedNamespaces = /* @__PURE__ */ new Set();
			for (const namespaceImport of namespaceImports) {
				if (emittedNamespaces.has(namespaceImport.normalizedName)) continue;
				emittedNamespaces.add(namespaceImport.normalizedName);
				const namespacePrefix = namespaceImport.isTypeOnly ? "type " : "";
				lines.push(`import ${namespacePrefix}${namespaceImport.normalizedName} from "${moduleName}";`);
			}
			if (nonNamespaceImports.length === 0) continue;
			const defaultImports = nonNamespaceImports.filter((imp) => imp.normalizedName.startsWith("default as "));
			const namedImports = nonNamespaceImports.filter((imp) => !imp.normalizedName.startsWith("default as "));
			const primaryDefault = defaultImports.find((imp) => imp.isDefaultImport) ?? null;
			const hasDefaultImport = Boolean(primaryDefault);
			const namedListOrdered = nonNamespaceImports.filter((imp) => imp !== primaryDefault).map((imp) => imp.normalizedName);
			if (hasDefaultImport) {
				const defaultName = primaryDefault?.normalizedName.substring(11) ?? "";
				if (namedListOrdered.length > 0) if (namedListOrdered.length > 1) {
					const namedBlock = namedListOrdered.map((name) => `  ${name},`).join("\n");
					lines.push(`import ${typePrefix}${defaultName}, {\n${namedBlock}\n} from "${moduleName}";`);
				} else lines.push(`import ${typePrefix}${defaultName}, { ${namedListOrdered[0]} } from "${moduleName}";`);
				else lines.push(`import ${typePrefix}${defaultName} from "${moduleName}";`);
			} else if (defaultImports.length > 0 || namedImports.length > 0) {
				if (namedListOrdered.length > 1) {
					const namedBlock = namedListOrdered.map((name) => `  ${name},`).join("\n");
					lines.push(`import ${typePrefix}{\n${namedBlock}\n} from "${moduleName}";`);
				} else if (namedListOrdered.length === 1) lines.push(`import ${typePrefix}{ ${namedListOrdered[0]} } from "${moduleName}";`);
			}
		}
		return lines;
	}
	generateExternalPrelude() {
		const { exportFromByModule, excludedExternalImports, requiredExternalImports } = this.getEntryExportData();
		const filteredExternals = this.filterExternalImports(excludedExternalImports, requiredExternalImports);
		const lines = [];
		for (const [moduleName, exportItems] of exportFromByModule.entries()) if (exportItems.length > 0) lines.push(OutputGenerator.buildExportFromLine(moduleName, exportItems));
		const sortedModules = Array.from(filteredExternals.keys()).sort();
		for (const moduleName of sortedModules) {
			const imports = filteredExternals.get(moduleName);
			if (imports && imports.size > 0) lines.push(...OutputGenerator.buildExternalImportLines(moduleName, imports));
		}
		return { lines };
	}
	generateNamedExports() {
		const { exportListItems } = this.getEntryExportData();
		if (exportListItems.length === 0) return [];
		if (exportListItems.length <= 3) return [`export { ${exportListItems.join(", ")} };`];
		const lines = ["export {"];
		for (const item of exportListItems) lines.push(`  ${item},`);
		lines.push("};");
		return lines;
	}
	getEntryExportData() {
		if (this.entryExportData) return this.entryExportData;
		this.entryExportData = buildEntryExportData({
			registry: this.registry,
			usedDeclarations: this.usedDeclarations,
			entryFile: this.options.entryFile,
			nameMap: this.nameMap,
			getNormalizedExternalImportName: this.getNormalizedExternalImportName.bind(this),
			extractImportName: OutputGenerator.extractImportName
		});
		return this.entryExportData;
	}
	filterExternalImports(excluded, required) {
		const result = /* @__PURE__ */ new Map();
		const addImport = (moduleName, externalImport) => {
			if (!result.has(moduleName)) result.set(moduleName, /* @__PURE__ */ new Set());
			result.get(moduleName)?.add(externalImport);
		};
		for (const [moduleName, imports] of this.usedExternals.entries()) for (const externalImport of imports) {
			const key = `${moduleName}:${externalImport.originalName}`;
			if (excluded.has(key)) continue;
			addImport(moduleName, externalImport);
		}
		for (const key of required) {
			if (excluded.has(key)) continue;
			const [moduleName, importName] = key.split(":");
			const externalImport = this.registry.externalImports.get(moduleName)?.get(importName);
			if (externalImport) addImport(moduleName, externalImport);
		}
		return result;
	}
	static buildExportFromLine(moduleName, items) {
		const unique = Array.from(new Set(items));
		if (unique.length === 1) return `export { ${unique[0]} } from "${moduleName}";`;
		if (unique.length <= 2) return `export { ${unique.join(", ")} } from "${moduleName}";`;
		const lines = ["export {"];
		for (const item of unique) lines.push(`  ${item},`);
		lines.push(`} from "${moduleName}";`);
		return lines.join("\n");
	}
	static buildExternalImportLines(moduleName, imports) {
		const lines = [];
		const importsArray = Array.from(imports);
		const cjsImports = importsArray.filter((imp) => imp.normalizedName.startsWith("= "));
		const esImports = importsArray.filter((imp) => !imp.normalizedName.startsWith("= "));
		for (const cjsImport of cjsImports) {
			const importName = cjsImport.normalizedName.substring(2);
			lines.push(`import ${importName} = require("${moduleName}");`);
		}
		if (esImports.length === 0) return lines;
		const typePrefix = esImports.every((imp) => imp.isTypeOnly) ? "type " : "";
		const namespaceImports = esImports.filter((imp) => imp.normalizedName.startsWith("* as "));
		const nonNamespaceImports = esImports.filter((imp) => !imp.normalizedName.startsWith("* as "));
		const emittedNamespaces = /* @__PURE__ */ new Set();
		for (const namespaceImport of namespaceImports) {
			if (emittedNamespaces.has(namespaceImport.normalizedName)) continue;
			emittedNamespaces.add(namespaceImport.normalizedName);
			const namespacePrefix = namespaceImport.isTypeOnly ? "type " : "";
			lines.push(`import ${namespacePrefix}${namespaceImport.normalizedName} from "${moduleName}";`);
		}
		if (nonNamespaceImports.length === 0) return lines;
		const defaultImports = nonNamespaceImports.filter((imp) => imp.normalizedName.startsWith("default as "));
		const namedImports = nonNamespaceImports.filter((imp) => !imp.normalizedName.startsWith("default as "));
		const primaryDefault = defaultImports.find((imp) => imp.isDefaultImport) ?? null;
		const hasDefaultImport = Boolean(primaryDefault);
		const namedListOrdered = nonNamespaceImports.filter((imp) => imp !== primaryDefault).map((imp) => imp.normalizedName).sort((a, b) => OutputGenerator.extractImportName(a).localeCompare(OutputGenerator.extractImportName(b)));
		if (hasDefaultImport) {
			const defaultName = primaryDefault?.normalizedName.substring(11) ?? "";
			if (namedListOrdered.length > 0) if (namedListOrdered.length > 1) {
				const namedBlock = namedListOrdered.map((name) => `  ${name},`).join("\n");
				lines.push(`import ${typePrefix}${defaultName}, {\n${namedBlock}\n} from "${moduleName}";`);
			} else lines.push(`import ${typePrefix}${defaultName}, { ${namedListOrdered[0]} } from "${moduleName}";`);
			else lines.push(`import ${typePrefix}${defaultName} from "${moduleName}";`);
		} else if (defaultImports.length > 0 || namedImports.length > 0) {
			if (namedListOrdered.length > 1) {
				const namedBlock = namedListOrdered.map((name) => `  ${name},`).join("\n");
				lines.push(`import ${typePrefix}{\n${namedBlock}\n} from "${moduleName}";`);
			} else if (namedListOrdered.length === 1) lines.push(`import ${typePrefix}{ ${namedListOrdered[0]} } from "${moduleName}";`);
		}
		return lines;
	}
	getNormalizedExternalImportName(moduleName, importName) {
		return (this.registry.externalImports.get(moduleName)?.get(importName))?.normalizedName ?? importName;
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
		const exportedModuleAugmentations = /* @__PURE__ */ new Set();
		for (const declId of this.usedDeclarations) {
			const decl = this.registry.getDeclaration(declId);
			if (!decl) continue;
			if (!ts.isModuleDeclaration(decl.node)) continue;
			if (!ts.isIdentifier(decl.node.name)) continue;
			if (decl.exportInfo.kind === ExportKind.NotExported && !decl.exportInfo.wasOriginallyExported) continue;
			exportedModuleAugmentations.add(decl.node.name.text);
		}
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
			const suppressDefaultKeyword = (declaration.exportInfo.kind === ExportKind.Default || declaration.exportInfo.kind === ExportKind.DefaultOnly) && hasDefaultModifier;
			const suppressExportForModuleAugmentation = ts.isInterfaceDeclaration(declaration.node) && exportedModuleAugmentations.has(declaration.name);
			const stripConstEnum = this.shouldStripConstEnum(declaration);
			const isTypeOnlyDeclaration = ts.isInterfaceDeclaration(declaration.node) || ts.isTypeAliasDeclaration(declaration.node);
			const suppressDefaultOnlyExport = declaration.exportInfo.kind === ExportKind.DefaultOnly && !isTypeOnlyDeclaration;
			const suppressExportKeywordForDefault = declaration.exportInfo.kind === ExportKind.Default && hasDefaultModifier || suppressDefaultOnlyExport;
			const shouldHaveExport = declaration.exportInfo.kind !== ExportKind.Equals && !suppressExportKeywordForDefault && !suppressExportForModuleAugmentation && (declaration.exportInfo.kind === ExportKind.Named || declaration.exportInfo.wasOriginallyExported);
			const transformedStatement = OutputGenerator.transformStatementForOutput(declaration, shouldHaveExport, suppressDefaultKeyword, stripConstEnum, this.options.typeChecker);
			const renameMap = this.buildRenameMap(declaration);
			const qualifiedNameMap = this.buildQualifiedNameMap(declaration);
			const printed = this.astPrinter.printStatement(transformedStatement, declaration.sourceFileNode, {
				renameMap,
				qualifiedNameMap
			});
			const preserveJsDoc = OutputGenerator.shouldPreserveJsDoc(declaration, shouldHaveExport);
			lines.push(normalizePrintedStatement(printed, declaration.node, declaration.getText(), { preserveJsDoc }));
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
					if (!this.namespaceValueAliasesByFile.get(decl.sourceFile)?.has(namespaceName)) continue;
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
	generateStarExports() {
		const lines = [];
		if (this.registry.entryStarExports.length === 0) return lines;
		const seen = /* @__PURE__ */ new Set();
		const visitedFiles = /* @__PURE__ */ new Set();
		const pushExternal = (moduleName, isTypeOnly = false) => {
			const key = `${moduleName}:${isTypeOnly ? "type" : "value"}`;
			if (seen.has(key)) return;
			seen.add(key);
			const typePrefix = isTypeOnly ? "type " : "";
			lines.push(`export ${typePrefix}* from "${moduleName}";`);
		};
		const collectFromFile = (filePath) => {
			if (visitedFiles.has(filePath)) return;
			visitedFiles.add(filePath);
			for (const starExport of this.registry.getStarExports(filePath)) if (starExport.externalModule) pushExternal(starExport.externalModule, starExport.isTypeOnly ?? false);
			else if (starExport.targetFile) collectFromFile(starExport.targetFile);
		};
		for (const entry of this.registry.entryStarExports) if (entry.info.externalModule) pushExternal(entry.info.externalModule, entry.info.isTypeOnly ?? false);
		else if (entry.info.targetFile) collectFromFile(entry.info.targetFile);
		return lines;
	}
	generateNamespaceExports() {
		const blocks = [];
		const exportNames = [];
		if (this.registry.entryNamespaceExports.length === 0) return {
			blocks,
			exportList: []
		};
		const depthCache = /* @__PURE__ */ new Map();
		const entryExports = this.registry.entryNamespaceExports.map((entry) => ({
			entry,
			depth: this.getNamespaceExportDepth(entry, depthCache)
		}));
		entryExports.sort((a, b) => b.depth - a.depth);
		const visited = /* @__PURE__ */ new Set();
		for (const { entry } of entryExports) {
			const info = this.registry.getNamespaceExportInfo(entry.sourceFile, entry.name);
			if (!info) continue;
			this.buildNamespaceBlocks(entry.sourceFile, entry.name, info, visited, blocks);
		}
		for (const entry of this.registry.entryNamespaceExports) exportNames.push(entry.name);
		return {
			blocks,
			exportList: exportNames.length > 0 ? [`export { ${exportNames.join(", ")} };`] : []
		};
	}
	buildNamespaceBlocks(sourceFile, namespaceName, info, visited, blocks) {
		const key = `${sourceFile}:${namespaceName}`;
		if (visited.has(key)) return;
		visited.add(key);
		if (!info.targetFile) return;
		const exportedNames = this.registry.exportedNamesByFile.get(info.targetFile) ?? [];
		for (const exported of exportedNames) {
			const childInfo = this.registry.getNamespaceExportInfo(info.targetFile, exported.name);
			if (childInfo && childInfo.targetFile) this.buildNamespaceBlocks(info.targetFile, exported.name, childInfo, visited, blocks);
		}
		const exportList = exportedNames.map((item) => item.name);
		blocks.push(`declare namespace ${namespaceName} {`);
		if (exportList.length > 0) blocks.push(`  export { ${exportList.join(", ")} };`);
		blocks.push(`}`);
	}
	getNamespaceExportDepth(entry, depthCache) {
		const key = `${entry.sourceFile}:${entry.name}`;
		if (depthCache.has(key)) return depthCache.get(key);
		const info = this.registry.getNamespaceExportInfo(entry.sourceFile, entry.name);
		if (!info || !info.targetFile) {
			depthCache.set(key, 1);
			return 1;
		}
		const exportedNames = this.registry.exportedNamesByFile.get(info.targetFile) ?? [];
		let maxChild = 0;
		for (const exported of exportedNames) {
			const childInfo = this.registry.getNamespaceExportInfo(info.targetFile, exported.name);
			if (childInfo && childInfo.targetFile) {
				const childDepth = this.getNamespaceExportDepth({
					name: exported.name,
					sourceFile: info.targetFile
				}, depthCache);
				if (childDepth > maxChild) maxChild = childDepth;
			}
		}
		const depth = 1 + maxChild;
		depthCache.set(key, depth);
		return depth;
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
		if (declaration.name !== declaration.normalizedName) renameMap.set(declaration.name, declaration.normalizedName);
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
		for (const [alias, info] of declaration.importAliases.entries()) {
			if (info.qualifiedName) {
				const parts = info.qualifiedName.split(".");
				const root = parts[0];
				const key = `${info.sourceFile}:${root}`;
				const depId = this.registry.nameIndex.get(key);
				const normalizedQualified = [(depId ? this.registry.getDeclaration(depId) : null)?.normalizedName ?? root, ...parts.slice(1)].join(".");
				if (alias !== normalizedQualified) renameMap.set(alias, normalizedQualified);
				continue;
			}
			const key = `${info.sourceFile}:${info.originalName}`;
			const depId = this.registry.nameIndex.get(key);
			if (!depId) continue;
			const depDecl = this.registry.getDeclaration(depId);
			if (!depDecl) continue;
			const normalized = depDecl.normalizedName;
			if (alias !== normalized) renameMap.set(alias, normalized);
		}
		return renameMap;
	}
	buildRenameMapForDeclarations(declarations) {
		const merged = /* @__PURE__ */ new Map();
		for (const declaration of declarations) for (const [name, normalized] of this.buildRenameMap(declaration)) merged.set(name, normalized);
		return merged;
	}
	buildQualifiedNameMap(declaration) {
		const qualifiedNameMap = /* @__PURE__ */ new Map();
		const valueAliases = this.namespaceValueAliasesByFile.get(declaration.sourceFile) ?? /* @__PURE__ */ new Set();
		for (const [key, nsInfo] of this.registry.namespaceImports.entries()) {
			if (OutputGenerator.splitNamespaceKey(key).filePath !== declaration.sourceFile) continue;
			if (valueAliases.has(nsInfo.namespaceName)) continue;
			const fileDeclarations = this.registry.declarationsByFile.get(nsInfo.sourceFile);
			if (fileDeclarations) for (const declId of fileDeclarations) {
				const depDecl = this.registry.getDeclaration(declId);
				if (!depDecl) continue;
				const mapKey = `${nsInfo.namespaceName}.${depDecl.name}`;
				qualifiedNameMap.set(mapKey, depDecl.normalizedName);
			}
			const defaultName = this.getDefaultExportName(nsInfo.sourceFile);
			if (defaultName) {
				const defaultId = this.registry.nameIndex.get(`${nsInfo.sourceFile}:${defaultName}`);
				const normalizedDefault = (defaultId ? this.registry.getDeclaration(defaultId) : null)?.normalizedName ?? defaultName;
				qualifiedNameMap.set(`${nsInfo.namespaceName}.default`, normalizedDefault);
			}
		}
		return qualifiedNameMap;
	}
	collectNamespaceValueAliases() {
		const aliasesByFile = /* @__PURE__ */ new Map();
		for (const [key, info] of this.registry.namespaceImports.entries()) {
			const split = OutputGenerator.splitNamespaceKey(key);
			const set = aliasesByFile.get(split.filePath) ?? /* @__PURE__ */ new Set();
			set.add(info.namespaceName);
			aliasesByFile.set(split.filePath, set);
		}
		const valueAliasesByFile = /* @__PURE__ */ new Map();
		for (const declId of this.usedDeclarations) {
			const declaration = this.registry.getDeclaration(declId);
			if (!declaration) continue;
			const namespaceAliases = aliasesByFile.get(declaration.sourceFile);
			if (!namespaceAliases || namespaceAliases.size === 0) continue;
			const valueAliases = valueAliasesByFile.get(declaration.sourceFile) ?? /* @__PURE__ */ new Set();
			const visit = (node) => {
				if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer)) {
					const name = node.initializer.text;
					if (namespaceAliases.has(name)) valueAliases.add(name);
				}
				if (ts.isTypeQueryNode(node)) {
					const exprName = node.exprName;
					const leftmost = OutputGenerator.getLeftmostEntityName(exprName);
					if (leftmost && namespaceAliases.has(leftmost)) valueAliases.add(leftmost);
				}
				node.forEachChild(visit);
			};
			visit(declaration.node);
			if (valueAliases.size > 0) valueAliasesByFile.set(declaration.sourceFile, valueAliases);
		}
		return valueAliasesByFile;
	}
	static splitNamespaceKey(key) {
		const splitIndex = key.lastIndexOf(":");
		return {
			filePath: key.slice(0, splitIndex),
			namespaceName: key.slice(splitIndex + 1)
		};
	}
	static getLeftmostEntityName(entity) {
		let current = entity;
		while (ts.isQualifiedName(current)) current = current.left;
		return ts.isIdentifier(current) ? current.text : null;
	}
	getDefaultExportName(filePath) {
		const declarations = this.registry.declarationsByFile.get(filePath);
		if (!declarations) return null;
		for (const declId of declarations) {
			const decl = this.registry.getDeclaration(declId);
			if (!decl) continue;
			if (decl.exportInfo.kind === ExportKind.Default || decl.exportInfo.kind === ExportKind.DefaultOnly) return decl.name;
			if (ts.isStatement(decl.node) && ts.canHaveModifiers(decl.node)) {
				if (ts.getModifiers(decl.node)?.some((mod) => mod.kind === ts.SyntaxKind.DefaultKeyword)) return decl.name;
			}
		}
		return null;
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
	static transformStatementForOutput(declaration, shouldHaveExport, suppressExportForDefault, stripConstEnum, typeChecker) {
		let statement = declaration.node;
		const modifiersMap = modifiersToMap(getModifiers(statement));
		const hadExport = Boolean(modifiersMap[ts.SyntaxKind.ExportKeyword]);
		const shouldForceExport = shouldHaveExport && OutputGenerator.shouldForceExport(statement);
		modifiersMap[ts.SyntaxKind.ExportKeyword] = (hadExport || shouldForceExport) && shouldHaveExport;
		if (suppressExportForDefault) modifiersMap[ts.SyntaxKind.DefaultKeyword] = false;
		if (ts.isEnumDeclaration(statement) && typeChecker) {
			let nextNumericValue = 0;
			const members = statement.members.map((member) => {
				if (member.initializer) {
					if (ts.isNumericLiteral(member.initializer)) nextNumericValue = Number(member.initializer.text) + 1;
					else nextNumericValue = null;
					return member;
				}
				const value = typeChecker.getConstantValue(member);
				if (value !== void 0) {
					const initializer = typeof value === "number" ? ts.factory.createNumericLiteral(value) : ts.factory.createStringLiteral(String(value));
					if (typeof value === "number") nextNumericValue = value + 1;
					else nextNumericValue = null;
					const updated = ts.factory.updateEnumMember(member, member.name, initializer);
					ts.setTextRange(updated, member);
					return updated;
				}
				if (nextNumericValue !== null) {
					const initializer = ts.factory.createNumericLiteral(nextNumericValue);
					nextNumericValue += 1;
					const updated = ts.factory.updateEnumMember(member, member.name, initializer);
					ts.setTextRange(updated, member);
					return updated;
				}
				return member;
			});
			statement = ts.factory.updateEnumDeclaration(statement, statement.modifiers, statement.name, members);
		}
		if (stripConstEnum) modifiersMap[ts.SyntaxKind.ConstKeyword] = false;
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
					const isExternalModule = ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name);
					let body = node.body;
					if (body && ts.isModuleBlock(body)) {
						const statements = isExternalModule ? body.statements : body.statements.map((statement) => OutputGenerator.stripExportFromStatement(statement, isDeclareGlobal));
						body = ts.factory.updateModuleBlock(body, statements);
					}
					let flags = node.flags;
					if (!isDeclareGlobal && ts.isIdentifier(node.name) && OutputGenerator.isNamespaceDeclaration(node)) flags |= ts.NodeFlags.Namespace;
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
					const updated = ts.factory.updateMethodDeclaration(member, filteredModifiers, member.asteriskToken, member.name, member.questionToken, member.typeParameters, member.parameters, member.type, void 0);
					ts.setTextRange(updated, member);
					return updated;
				}
			}
			if (ts.isMethodDeclaration(member) && member.body) {
				const updated = ts.factory.updateMethodDeclaration(member, filteredModifiers, member.asteriskToken, member.name, member.questionToken, member.typeParameters, member.parameters, member.type, void 0);
				ts.setTextRange(updated, member);
				return updated;
			}
			if (ts.isConstructorDeclaration(member) && member.body) {
				const updated = ts.factory.updateConstructorDeclaration(member, filteredModifiers, member.parameters, void 0);
				ts.setTextRange(updated, member);
				return updated;
			}
			if (ts.isGetAccessorDeclaration(member) && member.body) {
				const updated = ts.factory.updateGetAccessorDeclaration(member, filteredModifiers, member.name, member.parameters, member.type, void 0);
				ts.setTextRange(updated, member);
				return updated;
			}
			if (ts.isSetAccessorDeclaration(member) && member.body) {
				const updated = ts.factory.updateSetAccessorDeclaration(member, filteredModifiers, member.name, member.parameters, void 0);
				ts.setTextRange(updated, member);
				return updated;
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
		if (ts.isStringLiteral(moduleDecl.name) || ts.isNoSubstitutionTemplateLiteral(moduleDecl.name)) return false;
		return !ts.isModuleDeclaration(node);
	}
	static isConstEnumDeclaration(node) {
		if (!ts.isEnumDeclaration(node) || !ts.canHaveModifiers(node)) return false;
		return ts.getModifiers(node)?.some((mod) => mod.kind === ts.SyntaxKind.ConstKeyword) ?? false;
	}
	static shouldPreserveJsDoc(declaration, shouldHaveExport) {
		if (shouldHaveExport) return true;
		if (declaration.exportInfo.kind === ExportKind.Default || declaration.exportInfo.kind === ExportKind.DefaultOnly) return true;
		if (OutputGenerator.isConstEnumDeclaration(declaration.node)) return true;
		return ts.isInterfaceDeclaration(declaration.node) || ts.isTypeAliasDeclaration(declaration.node);
	}
	static shouldAddDeclareKeyword(statement) {
		const sourceFile = statement.getSourceFile();
		if (!sourceFile) return true;
		if (sourceFile.isDeclarationFile) return false;
		if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isFunctionDeclaration(statement) || ts.isModuleDeclaration(statement)) return true;
		return false;
	}
	static isNamespaceDeclaration(node) {
		const sourceFile = node.getSourceFile();
		if (!sourceFile) return false;
		const text = sourceFile.text.slice(node.pos, node.end);
		const header = text.split("{")[0] ?? text;
		if (/\bdeclare\s+module\b/.test(header)) return false;
		return /\bnamespace\b/.test(header) || /\bmodule\b/.test(header);
	}
	static shouldForceExport(statement) {
		if (!ts.isModuleDeclaration(statement)) return false;
		if (!ts.isIdentifier(statement.name)) return false;
		if (OutputGenerator.isNamespaceDeclaration(statement)) return false;
		if ((statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0) return false;
		return true;
	}
	shouldStripConstEnum(declaration) {
		if (!this.options.preserveConstEnums || !this.options.respectPreserveConstEnum) return false;
		if (!ts.isEnumDeclaration(declaration.node)) return false;
		if (!(getModifiers(declaration.node)?.some((mod) => mod.kind === ts.SyntaxKind.ConstKeyword) ?? false)) return false;
		return declaration.exportInfo.kind !== ExportKind.NotExported && declaration.exportInfo.wasOriginallyExported;
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
	exportedNamesByFile;
	namespaceExportsByFile;
	entryNamespaceExports;
	starExportsByFile;
	entryStarExports;
	constructor() {
		this.declarations = /* @__PURE__ */ new Map();
		this.declarationsByFile = /* @__PURE__ */ new Map();
		this.nameIndex = /* @__PURE__ */ new Map();
		this.externalImports = /* @__PURE__ */ new Map();
		this.namespaceImports = /* @__PURE__ */ new Map();
		this.exportedNamesByFile = /* @__PURE__ */ new Map();
		this.namespaceExportsByFile = /* @__PURE__ */ new Map();
		this.entryNamespaceExports = [];
		this.starExportsByFile = /* @__PURE__ */ new Map();
		this.entryStarExports = [];
	}
	register(declaration) {
		this.declarations.set(declaration.id, declaration);
		if (!this.declarationsByFile.has(declaration.sourceFile)) this.declarationsByFile.set(declaration.sourceFile, /* @__PURE__ */ new Set());
		this.declarationsByFile.get(declaration.sourceFile)?.add(declaration.id);
		const key = `${declaration.sourceFile}:${declaration.name}`;
		this.nameIndex.set(key, declaration.id);
	}
	registerExternal(moduleName, importName, isTypeOnly, isDefaultImport = false) {
		if (!this.externalImports.has(moduleName)) this.externalImports.set(moduleName, /* @__PURE__ */ new Map());
		const moduleImports = this.externalImports.get(moduleName);
		if (!moduleImports.has(importName)) moduleImports.set(importName, new ExternalImport(moduleName, importName, isTypeOnly, isDefaultImport));
		return moduleImports.get(importName);
	}
	registerExportedName(filePath, info) {
		const list = this.exportedNamesByFile.get(filePath) ?? [];
		const existing = list.find((item) => item.name === info.name);
		if (!existing) {
			list.push(info);
			this.exportedNamesByFile.set(filePath, list);
			return;
		}
		if (!existing.originalName && info.originalName) existing.originalName = info.originalName;
		if (!existing.sourceFile && info.sourceFile) existing.sourceFile = info.sourceFile;
		if (!existing.externalModule && info.externalModule) existing.externalModule = info.externalModule;
		if (!existing.externalImportName && info.externalImportName) existing.externalImportName = info.externalImportName;
		if (!existing.exportFrom && info.exportFrom) existing.exportFrom = info.exportFrom;
	}
	registerNamespaceExport(filePath, info, registerExportedName = true) {
		if (!this.namespaceExportsByFile.has(filePath)) this.namespaceExportsByFile.set(filePath, /* @__PURE__ */ new Map());
		const fileMap = this.namespaceExportsByFile.get(filePath);
		if (!fileMap.has(info.name)) fileMap.set(info.name, info);
		if (registerExportedName) this.registerExportedName(filePath, {
			name: info.name,
			externalModule: info.externalModule,
			externalImportName: info.externalImportName
		});
	}
	getNamespaceExportInfo(filePath, name) {
		const fileMap = this.namespaceExportsByFile.get(filePath);
		if (!fileMap) return null;
		return fileMap.get(name) ?? null;
	}
	registerEntryNamespaceExport(filePath, name) {
		if (!this.entryNamespaceExports.some((entry) => entry.name === name && entry.sourceFile === filePath)) this.entryNamespaceExports.push({
			name,
			sourceFile: filePath
		});
	}
	registerStarExport(filePath, info, isEntry) {
		const list = this.starExportsByFile.get(filePath) ?? [];
		list.push(info);
		this.starExportsByFile.set(filePath, list);
		if (isEntry) this.entryStarExports.push({
			sourceFile: filePath,
			info
		});
	}
	getStarExports(filePath) {
		return this.starExportsByFile.get(filePath) ?? [];
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
	entryFile;
	constructor(registry, options = {}) {
		this.registry = registry;
		this.used = /* @__PURE__ */ new Set();
		this.usedExternals = /* @__PURE__ */ new Set();
		this.exportReferencedTypes = options.exportReferencedTypes ?? true;
		this.entryFile = options.entryFile;
	}
	shake() {
		const exported = this.registry.getAllExported();
		for (const declaration of exported) this.markUsed(declaration.id);
		for (const declaration of this.registry.declarations.values()) if (declaration.forceInclude) this.markUsed(declaration.id);
		if (this.entryFile) this.markEntryNamedExportsUsed(this.entryFile);
		this.markNamespaceExportsUsed();
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
	markNamespaceExportsUsed() {
		if (this.registry.entryNamespaceExports.length === 0) return;
		const visitedFiles = /* @__PURE__ */ new Set();
		const depthCache = /* @__PURE__ */ new Map();
		const entryExports = this.registry.entryNamespaceExports.map((entry) => ({
			entry,
			depth: this.getNamespaceExportDepth(entry, depthCache)
		}));
		entryExports.sort((a, b) => b.depth - a.depth);
		for (const { entry } of entryExports) {
			const info = this.registry.getNamespaceExportInfo(entry.sourceFile, entry.name);
			if (!info) continue;
			if (info.targetFile) this.markModuleExportsUsed(info.targetFile, visitedFiles);
			else if (info.externalModule && info.externalImportName) this.usedExternals.add(`${info.externalModule}:${info.externalImportName}`);
		}
	}
	getNamespaceExportDepth(entry, depthCache) {
		const key = `${entry.sourceFile}:${entry.name}`;
		if (depthCache.has(key)) return depthCache.get(key);
		const info = this.registry.getNamespaceExportInfo(entry.sourceFile, entry.name);
		if (!info || !info.targetFile) {
			depthCache.set(key, 1);
			return 1;
		}
		const exportedNames = this.registry.exportedNamesByFile.get(info.targetFile) ?? [];
		let maxChild = 0;
		for (const exported of exportedNames) {
			const childInfo = this.registry.getNamespaceExportInfo(info.targetFile, exported.name);
			if (childInfo && childInfo.targetFile) {
				const childDepth = this.getNamespaceExportDepth({
					name: exported.name,
					sourceFile: info.targetFile
				}, depthCache);
				if (childDepth > maxChild) maxChild = childDepth;
			}
		}
		const depth = 1 + maxChild;
		depthCache.set(key, depth);
		return depth;
	}
	markModuleExportsUsed(filePath, visitedFiles) {
		if (visitedFiles.has(filePath)) return;
		visitedFiles.add(filePath);
		const exportedNames = this.registry.exportedNamesByFile.get(filePath) ?? [];
		for (const exported of exportedNames) {
			if (exported.externalModule && exported.externalImportName) this.usedExternals.add(`${exported.externalModule}:${exported.externalImportName}`);
			const declFile = exported.sourceFile ?? filePath;
			const declName = exported.originalName ?? exported.name;
			const declId = this.registry.nameIndex.get(`${declFile}:${declName}`);
			if (declId) this.markUsed(declId);
			const namespaceInfo = this.registry.getNamespaceExportInfo(filePath, exported.name);
			if (namespaceInfo?.targetFile) this.markModuleExportsUsed(namespaceInfo.targetFile, visitedFiles);
			else if (namespaceInfo?.externalModule && namespaceInfo.externalImportName) this.usedExternals.add(`${namespaceInfo.externalModule}:${namespaceInfo.externalImportName}`);
		}
	}
	markEntryNamedExportsUsed(entryFile) {
		const exportedNames = this.registry.exportedNamesByFile.get(entryFile) ?? [];
		for (const exported of exportedNames) {
			if (exported.externalModule && exported.externalImportName) {
				this.usedExternals.add(`${exported.externalModule}:${exported.externalImportName}`);
				continue;
			}
			const declFile = exported.sourceFile ?? entryFile;
			const declName = exported.originalName ?? exported.name;
			const declId = this.registry.nameIndex.get(`${declFile}:${declName}`);
			if (declId) this.markUsed(declId);
		}
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
	const parser = new DeclarationParser(registry, collector, {
		inlineDeclareGlobals: options.inlineDeclareGlobals ?? false,
		inlineDeclareExternals: options.inlineDeclareExternals ?? false
	});
	parser.parseFiles(files);
	new DependencyAnalyzer(registry, parser.importMap, entryFile).analyze();
	new NameNormalizer(registry, entryFile).normalize();
	const { declarations: usedDeclarations, externalImports: usedExternals } = new TreeShaker(registry, {
		exportReferencedTypes: options.exportReferencedTypes,
		entryFile
	}).shake();
	return new OutputGenerator(registry, usedDeclarations, usedExternals, {
		...options,
		includeEmptyExport,
		referencedTypes: allReferencedTypes,
		entryExportEquals: parser.entryExportEquals,
		entryExportDefault: parser.entryExportDefault,
		entryExportDefaultName: parser.entryExportDefaultName,
		entryFile,
		typeChecker: collector.getTypeChecker(),
		preserveConstEnums: collector.getCompilerOptions().preserveConstEnums ?? false
	}).generate();
}
/**
* Bundle TypeScript declaration files
* @param options - Bundling options
* @returns The bundled TypeScript declaration content
*/
function bundleDts(options) {
	const { entry, inlinedLibraries = [], allowedTypesLibraries, importedLibraries, noBanner, sortNodes, umdModuleName, exportReferencedTypes, inlineDeclareGlobals, inlineDeclareExternals, respectPreserveConstEnum } = options;
	if (!entry) throw new Error("The 'entry' option is required");
	return bundle(entry, inlinedLibraries, {
		noBanner,
		sortNodes,
		umdModuleName,
		exportReferencedTypes,
		allowedTypesLibraries,
		importedLibraries,
		inlineDeclareGlobals,
		inlineDeclareExternals,
		respectPreserveConstEnum
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