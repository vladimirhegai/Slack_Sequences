import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogScaffold, writeCatalogScaffold } from "./catalogScaffold.ts";

const [command, catalog, id, ...flags] = process.argv.slice(2);

if (command !== "new" || !catalog || !id) {
  process.stderr.write("usage: npm run catalog -- new <components|assets|recipes|looks|camera|plugins> <kebab-id> [--stdout]\n");
  process.exit(2);
}

try {
  const scaffold = buildCatalogScaffold(catalog, id);
  if (flags.includes("--stdout")) {
    process.stdout.write(scaffold.content);
  } else {
    const target = writeCatalogScaffold(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
      scaffold,
    );
    process.stdout.write(`created ${target}\nread ${scaffold.skill} before implementation\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
