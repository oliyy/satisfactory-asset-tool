# CLI reference

Run commands through the installed package binary:

```bash
npx sat <command> [options]
```

Commands are non-interactive and return nonzero exit codes on failure, so they're usable from scripts and CI. Unreal commands also print the resolved log path and a filtered log tail.

- [`sat generate`](#sat-generate)
- [`sat validate`](#sat-validate)
- [`sat list`](#sat-list)
- [`sat import`](#sat-import)
- [`sat scan-textures`](#sat-scan-textures)
- [Common options](#common-options)
- [Generation and validation options](#generation-and-validation-options)
- [Import options](#import-options)
- [Texture scan options](#texture-scan-options)
- [Environment overrides](#environment-overrides)

## `sat generate`

Generates the full asset pack by default. Use `--asset` to generate a slug subset for quick tests.

```bash
npx sat generate
npx sat generate --asset engine,acorn
npx sat generate --limit 50 --dry-run
```

The ID lock is only rewritten during full generation with no `--limit`. Subset generation is useful for quick tests, but run full `sat generate` again before a release so the manifest and ID lock describe the full pack.

## `sat validate`

Validates generated files without changing them.

```bash
npx sat validate
npx sat validate --skip-png-validation
```

## `sat list`

Prints selected IDs, slugs, texture asset names, and display names without writing files.

```bash
npx sat list
npx sat list --asset engine --limit 25
```

## `sat import`

Launches Unreal and imports the generated manifest. Run `sat generate` first.

```bash
npx sat import \
	--project-root "C:\\Modding\\SatisfactoryModLoader" \
	--engine-root "C:\\Program Files\\Unreal Engine - CSS"
npx sat import --dry-run
npx sat import --asset engine --dry-run
```

See [Output reference: Unreal import](output.md#unreal-import) for what import does per source mode.

## `sat scan-textures`

Launches Unreal and exports candidate existing `Texture2D` assets from the starter project for curation into `source.type: "unreal-texture-list"`.

```bash
npx sat scan-textures --output unreal-texture-candidates.json
npx sat scan-textures --package-path /Game/FactoryGame --keyword icon,ui,desc
npx sat scan-textures --include-dimensions --dimensions-limit 250
```

It searches the Asset Registry for `Texture2D` assets under the given package paths, applies icon-like heuristics, and writes a candidate JSON file with a config snippet for manual curation.

Example output:

```json
{
	"schema": "satisfactory-asset-tool-unreal-texture-scan",
	"schemaVersion": 1,
	"candidates": [
		{
			"slug": "icon-desc-portable-miner-256",
			"displayName": "Icon Desc Portable Miner 256",
			"textureObjectPath": "/Game/FactoryGame/IconDesc_PortableMiner_256.IconDesc_PortableMiner_256",
			"className": "Texture2D"
		}
	],
	"assetPackConfigSnippet": {
		"source": {
			"type": "unreal-texture-list",
			"assets": [{ "slug": "...", "displayName": "...", "textureObjectPath": "..." }]
		}
	}
}
```

Detection is intentionally conservative. The default keywords (`icon`, `ui`, `desc`) have special handling to avoid false positives, and material-map names (`Normal`, `MREO`, `ORM`, `Roughness`, `Metallic`, `Mask`) are excluded unless there is a stronger icon signal. Use `--include-dimensions` when dimensions help curation, with `--dimensions-limit` for large scans.

## Common options

```text
--config PATH, -c PATH          Defaults to asset-pack.config.json
--asset SLUG[,SLUG], -a SLUG    Select assets by slug (import also accepts texture asset name)
--limit N, -n N                 Limit selected assets
--dry-run                       Preview work without writing files
```

Selection behavior:

- `sat generate` with no `--asset` selects the full pack.
- `--asset` for `generate` and `list` selects by slug; for `import` selects by slug or texture asset name.
- folder modes sort slugs alphabetically, with `pluginIconAsset` or `engine` prioritized first.
- `unreal-texture-list` preserves the curated `source.assets` order, with `pluginIconAsset` prioritized first if set.

## Generation and validation options

```text
--source-dir PATH               Override source.dir
--source-weight NAME            Override source.weight and source.styleName
--size N                        Override output PNG size
--color #ffffff                 Override SVG render color
--type Monochrome               Override iconType
--mod-ref NAME                  Override modRef
--plugin-icon-asset SLUG        Override pluginIconAsset
--id-base N                     Override idBase
--skip-png-validation
--skip-id-lock
--overwrite-plugin-icon
```

## Import options

```text
--project-root PATH             Defaults to PROJECT_ROOT
--engine-root PATH              Defaults to ENGINE_ROOT
--manifest PATH                 Defaults to the generated manifest path from the config
--script PATH                   Override the bundled Unreal Python importer
--log PATH                      Defaults to Saved/Logs/sat-asset-tool-import.log under output.root
--skip-mount-check              Requires --dry-run
--log-tail-lines 120
--no-log-tail
```

## Texture scan options

```text
--output PATH                   Defaults to unreal-texture-candidates.json
--package-path PATH             Defaults to /Game/FactoryGame; repeatable or comma-separated
--keyword NAME                  Defaults to icon,ui,desc; repeatable or comma-separated
--limit N                       Limit emitted candidates
--preview-limit N               Number of assets included in assetPackConfigSnippet
--include-dimensions            Load matched textures and include width/height
--dimensions-limit N            Cap dimension loading when --include-dimensions is set
--project-root PATH             Defaults to PROJECT_ROOT
--engine-root PATH              Defaults to ENGINE_ROOT
--script PATH                   Override the bundled Unreal Python scanner
--log PATH                      Defaults to Saved/Logs/sat-asset-tool-scan-textures.log under the current directory
--log-tail-lines 120
--no-log-tail
```

## Environment overrides

- `PROJECT_ROOT`: default project root for Unreal commands
- `ENGINE_ROOT`: default Unreal Engine root for Unreal commands

After Unreal exits, the launcher prints `UNREAL_EXIT_CODE` and `UNREAL_LOG`, followed by filtered log lines unless `--no-log-tail` is set. The launcher uses `-abslog`, so absolute log paths are honored.
