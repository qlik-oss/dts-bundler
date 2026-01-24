#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

//#region src/types.ts
var TypeDeclaration = class {
	id;
	name;
	normalizedName;
	sourceFile;
	node;
	sourceFileNode;
	isExported;
	wasOriginallyExported;
	isExportEquals;
	dependencies;
	externalDependencies;
	namespaceDependencies;
	text;
	constructor(name, sourceFilePath, node, sourceFileNode, isExported = false, wasOriginallyExported = isExported) {
		this.id = Symbol(name);
		this.name = name;
		this.normalizedName = name;
		this.sourceFile = sourceFilePath;
		this.node = node;
		this.sourceFileNode = sourceFileNode;
		this.isExported = isExported;
		this.wasOriginallyExported = wasOriginallyExported;
		this.isExportEquals = false;
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
//#region src/declaration-parser.ts
var DeclarationParser = class DeclarationParser {
	importMap;
	entryExportEquals = null;
	registry;
	fileCollector;
	constructor(registry, fileCollector) {
		this.registry = registry;
		this.fileCollector = fileCollector;
		this.importMap = /* @__PURE__ */ new Map();
	}
	parseFiles(files) {
		for (const [filePath, { sourceFile, isEntry }] of files.entries()) this.parseFile(filePath, sourceFile, isEntry);
		for (const [filePath, { sourceFile, isEntry }] of files.entries()) {
			if (isEntry) this.parseReExports(filePath, sourceFile);
			this.resolveExportEquals(filePath, sourceFile, isEntry);
		}
	}
	parseFile(filePath, sourceFile, isEntry) {
		const fileImports = /* @__PURE__ */ new Map();
		this.importMap.set(filePath, fileImports);
		for (const statement of sourceFile.statements) if (ts.isImportDeclaration(statement)) this.parseImport(statement, filePath, fileImports);
		else if (ts.isImportEqualsDeclaration(statement)) this.parseImportEquals(statement, filePath, fileImports);
		for (const statement of sourceFile.statements) if (DeclarationParser.isDeclaration(statement)) if (ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name) && statement.body && ts.isModuleBlock(statement.body)) this.parseAmbientModule(statement, filePath, sourceFile);
		else this.parseDeclaration(statement, filePath, sourceFile, isEntry);
		else if (ts.isExportAssignment(statement) && statement.isExportEquals) {
			if (isEntry) this.entryExportEquals = statement;
			this.parseExportEquals(statement, filePath, isEntry);
		}
	}
	parseAmbientModule(moduleDecl, filePath, sourceFile) {
		if (!moduleDecl.body || !ts.isModuleBlock(moduleDecl.body)) return;
		const moduleName = moduleDecl.name.text;
		if (!this.fileCollector.shouldInline(moduleName)) return;
		const fileImports = this.importMap.get(filePath);
		if (fileImports) {
			for (const statement of moduleDecl.body.statements) if (ts.isImportDeclaration(statement)) this.parseImport(statement, filePath, fileImports);
		}
		for (const statement of moduleDecl.body.statements) if (DeclarationParser.isDeclaration(statement)) {
			const name = DeclarationParser.getDeclarationName(statement);
			if (!name) continue;
			const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, DeclarationParser.hasExportModifier(statement));
			this.registry.register(declaration);
		}
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
		} else {
			const importClause = statement.importClause;
			if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) for (const element of importClause.namedBindings.elements) {
				const localName = element.name.text;
				const originalName = element.propertyName?.text || localName;
				const importStr = originalName === localName ? localName : `${originalName} as ${localName}`;
				this.registry.registerExternal(importPath, importStr, isTypeOnly);
				fileImports.set(localName, {
					originalName: importStr,
					sourceFile: importPath,
					isExternal: true
				});
			}
			if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
				const localName = importClause.namedBindings.name.text;
				const importStr = `* as ${localName}`;
				this.registry.registerExternal(importPath, importStr, isTypeOnly);
				fileImports.set(localName, {
					originalName: importStr,
					sourceFile: importPath,
					isExternal: true
				});
			}
			if (importClause?.name) {
				const localName = importClause.name.text;
				const importStr = `default as ${localName}`;
				this.registry.registerExternal(importPath, importStr, isTypeOnly);
				fileImports.set(localName, {
					originalName: importStr,
					sourceFile: importPath,
					isExternal: true
				});
			}
		}
	}
	parseImportEquals(statement, filePath, fileImports) {
		if (!ts.isExternalModuleReference(statement.moduleReference)) return;
		const expr = statement.moduleReference.expression;
		if (!ts.isStringLiteral(expr)) return;
		const importPath = expr.text;
		const localName = statement.name.text;
		if (this.fileCollector.shouldInline(importPath)) {
			const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
			if (!resolvedPath) return;
			fileImports.set(localName, {
				originalName: localName,
				sourceFile: resolvedPath,
				isExternal: false,
				aliasName: null
			});
		} else {
			this.registry.registerExternal(importPath, `= ${localName}`, false);
			fileImports.set(localName, {
				originalName: `= ${localName}`,
				sourceFile: importPath,
				isExternal: true
			});
		}
	}
	static isDeclaration(statement) {
		return ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement);
	}
	parseDeclaration(statement, filePath, sourceFile, isEntry) {
		const name = DeclarationParser.getDeclarationName(statement);
		if (!name) return;
		const hasExport = DeclarationParser.hasExportModifier(statement);
		const isExported = isEntry ? hasExport : false;
		const declaration = new TypeDeclaration(name, filePath, statement, sourceFile, isExported, this.fileCollector.isFromInlinedLibrary(filePath) ? hasExport : isExported);
		this.registry.register(declaration);
	}
	static getDeclarationName(statement) {
		if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isFunctionDeclaration(statement)) return statement.name?.text ?? null;
		if (ts.isVariableStatement(statement)) {
			const declaration = statement.declarationList.declarations[0];
			if (ts.isIdentifier(declaration.name)) return declaration.name.text;
		}
		return null;
	}
	static hasExportModifier(statement) {
		return (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : void 0)?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
	}
	parseExportEquals(statement, filePath, isEntry) {
		if (!ts.isIdentifier(statement.expression)) return;
		const exportedName = statement.expression.text;
		const importInfo = this.importMap.get(filePath)?.get(exportedName);
		let key;
		let targetFilePath;
		let targetName;
		if (importInfo && !importInfo.isExternal) {
			targetFilePath = importInfo.sourceFile;
			targetName = importInfo.originalName;
			key = `${targetFilePath}:${targetName}`;
		} else {
			targetFilePath = filePath;
			targetName = exportedName;
			key = `${filePath}:${exportedName}`;
		}
		const declarationId = this.registry.nameIndex.get(key);
		if (declarationId) {
			const declaration = this.registry.getDeclaration(declarationId);
			if (declaration) if (isEntry) {
				declaration.isExported = true;
				declaration.isExportEquals = true;
			} else declaration.wasOriginallyExported = true;
		}
	}
	parseReExports(filePath, sourceFile) {
		for (const statement of sourceFile.statements) {
			if (!ts.isExportDeclaration(statement)) continue;
			if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
			if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
			const importPath = statement.moduleSpecifier.text;
			if (!this.fileCollector.shouldInline(importPath)) continue;
			const resolvedPath = this.fileCollector.resolveImport(filePath, importPath);
			if (!resolvedPath) continue;
			for (const element of statement.exportClause.elements) {
				const exportedName = element.name.text;
				const key = `${resolvedPath}:${element.propertyName?.text || exportedName}`;
				const declarationId = this.registry.nameIndex.get(key);
				if (declarationId) {
					const declaration = this.registry.getDeclaration(declarationId);
					if (declaration) declaration.isExported = true;
				}
			}
		}
	}
	resolveExportEquals(filePath, sourceFile, isEntry) {
		let exportedName = null;
		for (const statement of sourceFile.statements) if (ts.isExportAssignment(statement) && statement.isExportEquals) {
			if (ts.isIdentifier(statement.expression)) {
				exportedName = statement.expression.text;
				break;
			}
		}
		if (!exportedName) return;
		for (const fileImports of this.importMap.values()) for (const importInfo of fileImports.values()) if (!importInfo.isExternal && importInfo.sourceFile === filePath) importInfo.originalName = exportedName;
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
		for (const declaration of this.registry.declarations.values()) if (declaration.isExported) entryFiles.add(declaration.sourceFile);
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
		while (ts.isQualifiedName(current)) {
			if (ts.isIdentifier(current.right)) references.add(current.right.text);
			current = current.left;
		}
		if (ts.isIdentifier(current)) references.add(current.text);
	}
	static extractPropertyAccess(propAccess, references) {
		let current = propAccess;
		while (ts.isPropertyAccessExpression(current)) {
			if (ts.isIdentifier(current.name)) references.add(current.name.text);
			current = current.expression;
		}
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
var FileCollector = class {
	inlinedLibraries;
	program;
	typeChecker;
	entryFile;
	inlinedLibrariesSet;
	constructor(entryFile, options = {}) {
		this.entryFile = path.resolve(entryFile);
		this.inlinedLibraries = options.inlinedLibraries ?? [];
		this.program = this.createProgram();
		this.typeChecker = this.program.getTypeChecker();
		this.inlinedLibrariesSet = this.computeInlinedLibrariesSet();
	}
	createProgram() {
		const compilerOptions = getCompilerOptions(findTsConfig(this.entryFile));
		compilerOptions.declaration = true;
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
		const sourceFiles = this.program.getSourceFiles();
		for (const sourceFile of sourceFiles) {
			const fileName = sourceFile.fileName;
			if (fileName.includes("node_modules")) {
				if (getLibraryName(fileName) === importPath || fileName.includes(`/${importPath}/`)) return fileName;
			}
		}
		return null;
	}
	collectFiles() {
		const files = /* @__PURE__ */ new Map();
		const sourceFiles = this.program.getSourceFiles();
		const processedPaths = /* @__PURE__ */ new Set();
		for (const sourceFile of sourceFiles) {
			if (!this.shouldInlineFile(sourceFile)) continue;
			const filePath = sourceFile.fileName;
			processedPaths.add(filePath);
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
		const toProcess = [{
			file: this.entryFile,
			isEntry: true
		}];
		while (toProcess.length > 0) {
			const next = toProcess.shift();
			if (!next) break;
			const { file: filePath, isEntry } = next;
			if (processedPaths.has(filePath)) continue;
			if (!fs.existsSync(filePath)) continue;
			processedPaths.add(filePath);
			const content = fs.readFileSync(filePath, "utf-8");
			const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
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
			for (const statement of sourceFile.statements) if (ts.isImportDeclaration(statement)) {
				const moduleSpecifier = statement.moduleSpecifier;
				if (ts.isStringLiteral(moduleSpecifier)) {
					const importPath = moduleSpecifier.text;
					if (this.shouldInline(importPath)) {
						const resolved = this.resolveImport(filePath, importPath);
						if (resolved && !processedPaths.has(resolved)) toProcess.push({
							file: resolved,
							isEntry: false
						});
					}
				}
			} else if (ts.isImportEqualsDeclaration(statement)) {
				if (ts.isExternalModuleReference(statement.moduleReference)) {
					const expr = statement.moduleReference.expression;
					if (ts.isStringLiteral(expr)) {
						const importPath = expr.text;
						if (this.shouldInline(importPath)) {
							const resolved = this.resolveImport(filePath, importPath);
							if (resolved && !processedPaths.has(resolved)) toProcess.push({
								file: resolved,
								isEntry: false
							});
						}
					}
				}
			} else if (ts.isExportDeclaration(statement)) {
				const moduleSpecifier = statement.moduleSpecifier;
				if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
					const exportPath = moduleSpecifier.text;
					if (this.shouldInline(exportPath)) {
						const resolved = this.resolveImport(filePath, exportPath);
						if (resolved && !processedPaths.has(resolved)) toProcess.push({
							file: resolved,
							isEntry: false
						});
					}
				}
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
//#region src/output-generator.ts
const version = package_default.version ?? "development";
var OutputGenerator = class OutputGenerator {
	registry;
	usedDeclarations;
	usedExternals;
	nameMap;
	options;
	constructor(registry, usedDeclarations, usedExternals, options = {}) {
		this.registry = registry;
		this.usedDeclarations = usedDeclarations;
		this.usedExternals = usedExternals;
		this.nameMap = /* @__PURE__ */ new Map();
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
		for (const declaration of ordered) {
			let text = declaration.getText();
			if (!(!declaration.isExportEquals && (declaration.isExported || declaration.wasOriginallyExported)) && text.includes("export ")) text = OutputGenerator.stripExportModifier(text);
			if (!text.trim().startsWith("declare ")) text = OutputGenerator.addDeclareKeyword(text);
			text = OutputGenerator.stripImplementationDetails(text);
			if (ts.isVariableStatement(declaration.node)) text = this.transformVariableDeclaration(text, declaration);
			text = this.replaceRenamedReferences(text, declaration);
			lines.push(text);
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
	static stripExportModifier(text) {
		return text.replace(/^((?:\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*))export\s+/, "$1");
	}
	static addDeclareKeyword(text) {
		const match = text.match(/^((?:\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*)(?:export\s+)?)(class|enum|function)(?:\s|$)/);
		if (match) return `${match[1]}declare ${match[2]}${text.substring(match[0].length - 1)}`;
		return text;
	}
	static stripImplementationDetails(text) {
		text = text.replace(/^(\s*)(public|private|protected)\s+/gm, "$1");
		text = text.replace(/^(\s*)([a-zA-Z_$][\w$]*)\s*:\s*([^;=()]+?)\s*=\s*[^;]+;/gm, "$1$2: $3;");
		text = text.replace(/^((?:export\s+)?(?:declare\s+)?function\s+[^{]+?)\s*\{[^}]*\}/gm, "$1;");
		return text;
	}
	transformVariableDeclaration(text, declaration) {
		if (declaration.namespaceDependencies.size > 0) {
			const namespaceNames = Array.from(declaration.namespaceDependencies);
			for (const nsName of namespaceNames) {
				const pattern = new RegExp(`(const\\s+${declaration.name})\\s*=\\s*${nsName}\\s*;`, "g");
				text = text.replace(pattern, `$1: typeof ${nsName};`);
			}
		}
		if (!declaration.isExported && !text.trim().startsWith("declare ")) text = text.replace(/^((?:\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*))(const|let|var)\s+/, "$1declare $2 ");
		else if (declaration.isExported) text = text.replace(/^((?:\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*)export\s+)(const|let|var)\s+/, "$1declare $2 ");
		return text;
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
			return decl && decl.isExported;
		});
		const nonExported = used.filter((id) => {
			const decl = this.registry.getDeclaration(id);
			return decl && !decl.isExported;
		});
		for (const id of nonExported) visit(id);
		for (const id of exported) visit(id);
		return sorted;
	}
	replaceRenamedReferences(text, declaration) {
		let result = text;
		if (declaration.name !== declaration.normalizedName) {
			const regex = new RegExp(`\\b(type|interface|class|enum)\\s+${declaration.name}\\b`, "g");
			result = result.replace(regex, `$1 ${declaration.normalizedName}`);
		}
		for (const depId of declaration.dependencies) {
			const depDecl = this.registry.getDeclaration(depId);
			if (depDecl && depDecl.name !== depDecl.normalizedName) {
				const regex = new RegExp(`\\b${depDecl.name}\\b(?![_])`, "g");
				result = result.replace(regex, depDecl.normalizedName);
			}
		}
		for (const [moduleName, importNames] of declaration.externalDependencies.entries()) {
			const moduleImports = this.registry.externalImports.get(moduleName);
			if (!moduleImports) continue;
			for (const importName of importNames) {
				const externalImport = moduleImports.get(importName);
				if (!externalImport) continue;
				const originalName = OutputGenerator.extractImportName(externalImport.originalName);
				const normalizedName = OutputGenerator.extractImportName(externalImport.normalizedName);
				if (originalName !== normalizedName) {
					const regex = new RegExp(`\\b${originalName}\\b(?![_])`, "g");
					result = result.replace(regex, normalizedName);
				}
			}
		}
		return result;
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
		return Array.from(this.declarations.values()).filter((d) => d.isExported);
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
	const parser = new DeclarationParser(registry, collector);
	parser.parseFiles(files);
	new DependencyAnalyzer(registry, parser.importMap).analyze();
	new NameNormalizer(registry).normalize();
	const { declarations: usedDeclarations, externalImports: usedExternals } = new TreeShaker(registry, { exportReferencedTypes: options.exportReferencedTypes }).shake();
	return new OutputGenerator(registry, usedDeclarations, usedExternals, {
		...options,
		includeEmptyExport,
		referencedTypes: allReferencedTypes,
		entryExportEquals: parser.entryExportEquals
	}).generate();
}
/**
* Bundle TypeScript declaration files
* @param options - Bundling options
* @returns The bundled TypeScript declaration content
*/
function bundleDts(options) {
	const { entry, inlinedLibraries = [], allowedTypesLibraries, importedLibraries, noBanner, sortNodes, umdModuleName, exportReferencedTypes } = options;
	if (!entry) throw new Error("The 'entry' option is required");
	return bundle(entry, inlinedLibraries, {
		noBanner,
		sortNodes,
		umdModuleName,
		exportReferencedTypes,
		allowedTypesLibraries,
		importedLibraries
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