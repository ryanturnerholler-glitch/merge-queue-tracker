// Collects every vscode.l10n.t("...") string in src/ into l10n/bundle.l10n.json,
// the file translators copy to bundle.l10n.<locale>.json. Run: npm run l10n
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const strings = new Set();
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/\bl10n\.t\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)) {
        strings.add(JSON.parse(`"${match[2].replace(/"/g, '\\"')}"`));
      }
    }
  }
}
walk(join(root, "src"));
const bundle = Object.fromEntries([...strings].sort().map((s) => [s, s]));
writeFileSync(join(root, "l10n/bundle.l10n.json"), JSON.stringify(bundle, null, 2) + "\n");
console.log(`l10n: ${strings.size} strings`);
