#!/usr/bin/env node
/**
 * migrate-calculatePricing.mjs
 * ---------------------------------------------------------------------------
 * Codemod for the pricingCalculator.ts API change. For every call to
 * calculatePricing({...}) with an inline object literal it:
 *   1. removes `oneTimeSetupFee`
 *   2. removes `addons.sharedCsm` and `addons.dedicatedCsm` (and `addons` itself if left empty)
 *   3. injects `onboardingFee: 0`, `csmFee: 0`, `csmResourceType: 'Shared'`
 *      (any of the three that is already present is left alone)
 *
 * Removed values are kept in a `// TODO(pricing-migration)` comment above the
 * call, so the old setup fee or CSM rate can be added back later.
 * Calls whose argument is not an inline object (a variable, a spread, a function
 * result) cannot be rewritten safely; they are listed for manual review.
 *
 * Usage (run from the repo root):
 *   npm i -D ts-morph
 *   node migrate-calculatePricing.mjs              # dry run: shows what would change
 *   node migrate-calculatePricing.mjs --write      # applies the changes
 *   node migrate-calculatePricing.mjs --write "src/**\/*.{ts,tsx}"   # custom glob
 *
 * Finds calls named `calculatePricing`, including aliased imports such as
 * `import { calculatePricing as calc }` and default imports from pricingCalculator.
 * ---------------------------------------------------------------------------
 */
import { Project, SyntaxKind, Node } from 'ts-morph';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const globs = args.filter((a) => !a.startsWith('--'));
const patterns = globs.length
  ? globs
  : ['**/*.{ts,tsx,js,jsx,mjs,cjs}', '!**/node_modules/**', '!**/dist/**', '!**/build/**', '!**/.next/**'];

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true, jsx: 4 /* react-jsx */ },
});
project.addSourceFilesAtPaths(patterns);

const INJECT = [
  ['onboardingFee', '0'],
  ['csmFee', '0'],
  ['csmResourceType', "'Shared'"],
];

const report = { filesChanged: [], callsUpdated: 0, callsAlreadyOk: 0, manual: [] };

/** Local names that refer to calculatePricing in this file. */
function calleeNames(sf) {
  const names = new Set(['calculatePricing']);
  for (const imp of sf.getImportDeclarations()) {
    const fromCalc = /pricingCalculator/.test(imp.getModuleSpecifierValue());
    for (const n of imp.getNamedImports()) {
      if (n.getName() === 'calculatePricing') names.add(n.getAliasNode()?.getText() ?? 'calculatePricing');
    }
    const def = imp.getDefaultImport();
    if (fromCalc && def) names.add(def.getText());
  }
  return names;
}

const propName = (p) => {
  if (!Node.isPropertyAssignment(p) && !Node.isShorthandPropertyAssignment(p) && !Node.isMethodDeclaration(p))
    return null;
  return p.getName().replace(/^['"]|['"]$/g, '');
};
const findProp = (obj, name) => obj.getProperties().find((p) => propName(p) === name);
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

for (const sf of project.getSourceFiles()) {
  const indentMatch = /^( +)\S/m.exec(sf.getFullText());
  project.manipulationSettings.set({ indentationText: indentMatch && indentMatch[1].length % 4 === 0 ? '    ' : '  ' });
  if (/pricingCalculator\.(ts|js)$/.test(sf.getFilePath())) continue; // the library itself
  const names = calleeNames(sf);
  let changed = false;
  const pendingNotes = []; // TODO comments, inserted after all edits in this file

  const calls = sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((c) => {
      const e = c.getExpression();
      const id = Node.isPropertyAccessExpression(e) ? e.getName() : e.getText();
      return names.has(id);
    })
    // edit from the end of the file backwards so earlier positions stay valid
    .sort((a, b) => b.getStart() - a.getStart());

  for (const call of calls) {
    const loc = `${sf.getFilePath()}:${call.getStartLineNumber()}`;
    const [arg] = call.getArguments();
    if (!arg || !Node.isObjectLiteralExpression(arg)) {
      report.manual.push(`${loc}  argument is not an inline object: ${oneLine(call.getText()).slice(0, 100)}`);
      continue;
    }
    if (arg.getProperties().some((p) => Node.isSpreadAssignment(p))) {
      report.manual.push(`${loc}  contains a ...spread; check the spread source for legacy fields too`);
    }

    const removed = [];

    // 1. oneTimeSetupFee
    const setup = findProp(arg, 'oneTimeSetupFee');
    if (setup) {
      removed.push(oneLine(setup.getText()));
      setup.remove();
    }

    // 2. addons.sharedCsm / addons.dedicatedCsm
    const addons = findProp(arg, 'addons');
    if (addons && Node.isPropertyAssignment(addons)) {
      const init = addons.getInitializer();
      if (init && Node.isObjectLiteralExpression(init)) {
        for (const key of ['sharedCsm', 'dedicatedCsm']) {
          const p = findProp(init, key);
          if (p) {
            removed.push(`addons.${oneLine(p.getText())}`);
            p.remove();
          }
        }
        if (init.getProperties().length === 0) addons.remove();
      } else if (init) {
        report.manual.push(`${loc}  addons is not an inline object (${oneLine(init.getText()).slice(0, 60)}); check it for sharedCsm/dedicatedCsm`);
      }
    }

    // 3. inject required fields
    const toAdd = INJECT.filter(([k]) => !findProp(arg, k));
    for (const [k, v] of toAdd) arg.addPropertyAssignment({ name: k, initializer: v });

    if (removed.length || toAdd.length) {
      if (removed.length) {
        const stmt = call.getFirstAncestor((a) => Node.isStatement(a) && Node.isBlock(a.getParent() ?? a)) ??
          call.getFirstAncestor((a) => Node.isStatement(a));
        const note = `// TODO(pricing-migration): removed ${removed.join('; ')}. Re-enter as onboardingFee / csmFee.`;
        if (stmt && Node.isStatement(stmt) && (Node.isSourceFile(stmt.getParent()) || Node.isBlock(stmt.getParent()))) {
          pendingNotes.push({ stmt, note });
        } else {
          report.manual.push(`${loc}  removed ${removed.join('; ')} (no statement to attach a TODO comment to)`);
        }
      }
      report.callsUpdated++;
      changed = true;
      console.log(`${WRITE ? 'updated' : 'would update'}  ${loc}${removed.length ? `  (removed: ${removed.join('; ')})` : ''}`);
    } else {
      report.callsAlreadyOk++;
    }
  }

  // Insert TODO comments as plain text, last position first, so offsets stay valid.
  const inserts = pendingNotes.map(({ stmt, note }) => ({
    pos: stmt.getStart(),
    text: `${note}\n${stmt.getIndentationText()}`,
  }));
  for (const { pos, text } of inserts.sort((a, b) => b.pos - a.pos)) sf.insertText(pos, text);

  if (changed) {
    report.filesChanged.push(sf.getFilePath());
    if (!WRITE) sf.refreshFromFileSystemSync();
  }
}

if (WRITE) project.saveSync();

console.log('\n---');
console.log(`${WRITE ? 'Updated' : 'Would update'} ${report.callsUpdated} call(s) in ${report.filesChanged.length} file(s); ${report.callsAlreadyOk} already on the new API.`);
if (report.manual.length) {
  console.log(`\nNeeds a manual look (${report.manual.length}):`);
  for (const m of report.manual) console.log('  - ' + m);
}
if (!WRITE && report.callsUpdated) console.log('\nDry run only. Re-run with --write to apply.');
