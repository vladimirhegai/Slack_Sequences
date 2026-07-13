/** Mechanical named-export census for the Slack application surface. */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

interface Candidate {
  file: string;
  exportName: string;
  localName: string;
  references: Set<string>;
}

interface ModuleInfo {
  file: string;
  source: ts.SourceFile;
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(appDir, "..", "..");
const scanRoots = ["src", "studio", "scripts", "test"].map((dir) => path.join(appDir, dir));
const outputPath = path.join(rootDir, ".reports", "dead-exports.md");

function sourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(file));
    else if (/\.(?:cts|mts|ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(file);
  }
  return files;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

function addCandidate(
  candidates: Map<string, Candidate>,
  file: string,
  exportName: string,
  localName: string,
): void {
  if (exportName === "default") return;
  const key = `${file}\0${exportName}`;
  if (!candidates.has(key)) candidates.set(key, { file, exportName, localName, references: new Set() });
}

function collectCandidates(info: ModuleInfo, candidates: Map<string, Candidate>): void {
  const visit = (node: ts.Node): void => {
    if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
        if (node.name && !hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
          addCandidate(candidates, info.file, node.name.text, node.name.text);
        }
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) addCandidate(candidates, info.file, declaration.name.text, declaration.name.text);
        }
      }
    }
    if (ts.isExportDeclaration(node)) {
      for (const element of node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements
        : []) {
        const local = element.propertyName?.text ?? element.name.text;
        addCandidate(candidates, info.file, element.name.text, local);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(info.source);
}

function resolveModule(from: string, specifier: string, known: Set<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(from), specifier);
  const options = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, path.join(base, "index.ts")];
  return options.find((file) => known.has(file));
}

function mark(
  candidates: Map<string, Candidate>,
  file: string | undefined,
  exportName: string,
  importer: string,
): void {
  if (!file) return;
  const candidate = candidates.get(`${file}\0${exportName}`);
  if (candidate) candidate.references.add(importer);
}

function markAll(candidates: Map<string, Candidate>, file: string, importer: string): void {
  for (const candidate of candidates.values()) if (candidate.file === file) candidate.references.add(importer);
}

function collectReferences(
  info: ModuleInfo,
  modules: Map<string, ModuleInfo>,
  candidates: Map<string, Candidate>,
): void {
  const known = new Set(modules.keys());
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveModule(info.file, node.moduleSpecifier.text, known);
      if (target && node.importClause) {
        const bindings = node.importClause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            mark(candidates, target, element.propertyName?.text ?? element.name.text, info.file);
          }
        } else if (bindings && ts.isNamespaceImport(bindings)) {
          // Namespace imports are intentionally conservative: every exported
          // member is externally reachable until the census is narrowed by hand.
          markAll(candidates, target, info.file);
        }
        if (node.importClause.name) mark(candidates, target, "default", info.file);
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveModule(info.file, node.moduleSpecifier.text, known);
      if (target) {
        if (!node.exportClause) markAll(candidates, target, info.file);
        else if (ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            mark(candidates, target, element.propertyName?.text ?? element.name.text, info.file);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(info.source);
}

function relative(file: string): string {
  return path.relative(rootDir, file).replaceAll(path.sep, "/");
}

function buildReport(candidates: Candidate[], files: string[]): string {
  const dead = candidates.filter((candidate) => candidate.references.size === 0);
  const lines = [
    "# Dead-export census",
    "",
    "Mechanical report; no exports were deleted by this step. A candidate has",
    "zero named-import/re-export references from the scanned Slack source,",
    "studio, scripts, and tests. Namespace imports are conservatively treated",
    "as references to every export in their target module.",
    "",
    `- Scanned files: ${files.length}`,
    `- Named exports: ${candidates.length}`,
    `- Candidates: ${dead.length}`,
    "",
    "## Candidates",
    "",
    "| Export | Local declaration | References |",
    "| --- | --- | ---: |",
  ];
  if (!dead.length) lines.push("| None | — | 0 |");
  else {
    for (const candidate of dead.sort((a, b) => `${a.file}:${a.exportName}`.localeCompare(`${b.file}:${b.exportName}`))) {
      lines.push(`| \`${relative(candidate.file)}:${candidate.exportName}\` | \`${candidate.localName}\` | 0 |`);
    }
  }
  lines.push(
    "",
    "## Scope notes",
    "",
    "- This is a candidate list only; confirm runtime/dynamic consumers before S7.x deletion.",
    "- External consumers outside the scanned Slack surface are intentionally not counted.",
    "",
  );
  return lines.join("\n");
}

const files = scanRoots.flatMap(sourceFiles).sort();
const modules = new Map<string, ModuleInfo>(files.map((file) => [
  file,
  { file, source: ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) },
]));
const candidates = new Map<string, Candidate>();
for (const info of modules.values()) collectCandidates(info, candidates);
for (const info of modules.values()) collectReferences(info, modules, candidates);
const report = buildReport([...candidates.values()], files);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, report, "utf8");
console.log(`dead-export census: ${candidates.size} exports, ${[...candidates.values()].filter((candidate) => candidate.references.size === 0).length} candidates`);
console.log(outputPath);
