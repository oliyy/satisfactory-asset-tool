# Satisfactory Asset Tool

Tooling for automatically building and importing Satisfactory asset packs into Unreal projects.

The tool currently supports two sources for automatic asset creation:

- local SVG or PNG files
- existing Unreal `Texture2D` assets from the Starter Project

## Which Workflow Do I Need?

| What you have | What you want | Use |
| --- | --- | --- |
| SVG source files | Generate PNGs, import them as new mod textures, and register them in an icon library | `source.type: "svg-folder"` |
| PNG source files | Import local images as new mod textures and register them in an icon library | `source.type: "png-folder"` |
| Existing Starter Project textures | Make vanilla or starter-project textures appear in the icon picker | `sat scan-textures`, then `source.type: "unreal-texture-list"` |

Commands are non-interactive and return nonzero exit codes on failure, so they are usable from scripts and CI. Unreal commands also print the resolved log path and a filtered log tail.

## Requirements

- Node.js 24 or newer
- `rsvg-convert` on `PATH` when using `source.type: "svg-folder"`
- a Satisfactory modding Unreal project when running `sat import` or `sat scan-textures`

## Install

Install the package in the asset pack project:

```bash
npm install --save-dev @oliyy_/satisfactory-asset-tool
```

## Quick Start

Create `asset-pack.config.json` in your mod root. For a GameFeature mod, that root should be `<projectRoot>/Mods/GameFeatures/<modRef>`.

SVG source config:

```json
{
	"modRef": "MyIconPack",
	"name": "My Icon Pack",
	"sectionName": "My Icons",
	"assetPrefix": "T_MyIcon_",
	"idBase": 50000,
	"iconType": "Monochrome",
	"size": 512,
	"color": "#ffffff",
	"pluginIconAsset": "engine",
	"source": {
		"type": "svg-folder",
		"dir": "icons",
		"weight": "",
		"styleName": "custom-svg",
		"name": "Local SVG Icons",
		"license": null
	},
	"output": {
		"root": "."
	}
}
```

For existing Unreal textures, first scan for candidates with `sat scan-textures`, then curate slugs and names:

```json
{
	"modRef": "MyIconPack",
	"name": "My Icon Pack",
	"sectionName": "My Icons",
	"assetPrefix": "T_MyIcon_",
	"idBase": 50000,
	"iconType": "Custom",
	"source": {
		"type": "unreal-texture-list",
		"name": "FactoryGame Existing Textures",
		"assets": [
			{
				"slug": "portable-miner",
				"displayName": "Portable Miner",
				"textureObjectPath": "/Game/FactoryGame/IconDesc_PortableMiner_256.IconDesc_PortableMiner_256"
			}
		]
	},
	"output": {
		"root": "."
	}
}
```

Run the tool:

```bash
npx sat generate --config asset-pack.config.json
npx sat validate --config asset-pack.config.json
npx sat import --config asset-pack.config.json
```

## Commands

Run commands through the installed package binary:

```bash
npx sat <command> [options]
```

`sat generate`

Generates the full asset pack by default. Use `--asset` to generate a slug subset for quick tests.

```bash
npx sat generate
npx sat generate --asset engine,acorn
npx sat generate --limit 50 --dry-run
```

`sat validate`

Validates generated files without changing them.

```bash
npx sat validate
npx sat validate --skip-png-validation
```

`sat list`

Prints selected IDs, slugs, texture asset names, and display names without writing files.

```bash
npx sat list
npx sat list --asset engine --limit 25
```

`sat import`

Launches Unreal and imports the generated manifest.

```bash
npx sat import \
	--project-root "C:\\Modding\\SatisfactoryModLoader" \
	--engine-root "C:\\Program Files\\Unreal Engine - CSS"
npx sat import --dry-run
npx sat import --asset engine --dry-run
```

`sat scan-textures`

Launches Unreal and exports candidate existing `Texture2D` assets from the starter project for curation into `source.type: "unreal-texture-list"`.

```bash
npx sat scan-textures --output unreal-texture-candidates.json
npx sat scan-textures --package-path /Game/FactoryGame --keyword icon,ui,desc
npx sat scan-textures --include-dimensions --dimensions-limit 250
```

Common options:

```text
--config PATH, -c PATH          Defaults to asset-pack.config.json
--asset SLUG[,SLUG], -a SLUG    Select assets by slug (import also accepts texture asset name)
--limit N, -n N                 Limit selected assets
--dry-run                       Preview work without writing files
```

Generation and validation options:

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
--skip-plugin-icon
```

Import options:

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

Texture scan options:

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

## Configuration

Relative path rules:

- `output.root` is resolved relative to the config file
- `source.dir` is resolved relative to `output.root`
- output directories are resolved relative to `output.root`
- `source.catalogPath`, when set, is resolved relative to `output.root`

Top-level fields:

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `modRef` | yes | — | Unreal package root and mod reference. Generated paths go under `/<modRef>/...` |
| `name` | no | `modRef` | Human-readable pack name for sidecar metadata |
| `sectionName` | no | `modRef` | Grouping label for sidecar consumers |
| `assetPrefix` | no | `T_<modRef>_` | Prefix for generated Unreal texture asset names |
| `idBase` | no | `50000` | First local asset ID. Valid range: `0`–`65535`. Avoid changing after release |
| `iconType` | no | `Monochrome` | Satisfactory `EIconType` for generated `FIconData` entries |
| `size` | no | `512` | Square PNG output size in pixels |
| `color` | no | `#ffffff` | SVG render color (sets root `color` and `fill` before rendering) |
| `pluginIconAsset` | no | — | Source slug for `Resources/Icon128.png`. On by default for SVG/PNG modes, off for `unreal-texture-list` |

Accepted `iconType` values: `Building`, `Part`, `Equipment`, `Monochrome`, `Material`, `Custom`, `MapStamp`, `None`. Short names, Unreal enum names like `ESIT_Monochrome`, and fully qualified names are all accepted.

## Source Modes

`svg-folder`

```json
{
	"source": {
		"type": "svg-folder",
		"dir": "../icons/SVGs/fill",
		"weight": "fill",
		"styleName": "custom-fill",
		"name": "Custom Icons",
		"license": "MIT"
	}
}
```

Scans `source.dir` for `.svg` files. Slugs are normalized from filenames. If `weight` is set, that suffix is stripped from slugs and preferred when multiple files collapse to the same slug (e.g. `acorn-fill.svg` becomes slug `acorn`).

`png-folder`

```json
{
	"source": {
		"type": "png-folder",
		"dir": "../icons/png",
		"weight": "",
		"styleName": "custom-png",
		"name": "Custom PNG Icons"
	}
}
```

Scans `source.dir` for `.png` files. PNGs are copied into the generated texture output directory and validated unless `--skip-png-validation` is set.

`unreal-texture-list`

```json
{
	"source": {
		"type": "unreal-texture-list",
		"name": "FactoryGame Existing Textures",
		"assets": [
			{
				"slug": "portable-miner",
				"displayName": "Portable Miner",
				"textureObjectPath": "/Game/FactoryGame/IconDesc_PortableMiner_256.IconDesc_PortableMiner_256"
			}
		]
	}
}
```

Each entry requires `slug` and `textureObjectPath` (full Unreal object path as `packageName.assetName`). `displayName` is optional and derived from the slug when omitted. Generation skips SVG/PNG rendering. Import loads the existing `Texture2D` and registers it in the `FGIconLibrary`.

Shared source fields:

- `source.type`: one of `svg-folder`, `png-folder`, or `unreal-texture-list`
- `source.dir`: folder containing source files for folder modes
- `source.weight`: style suffix to prefer and strip from slugs, such as `fill`
- `source.styleName`: label written into the manifest and metadata
- `source.name`, `source.catalog`, `source.catalogVersion`, `source.catalogPath`, `source.license`: sidecar metadata fields
- `source.slugOverrides`: maps generated asset slugs to catalog names when catalog metadata uses a different name
- `styleSuffixes`: optional top-level suffix list to strip from source filenames; defaults to `["bold", "duotone", "fill", "light", "regular", "thin"]`

## Naming And Selection

Source filenames become stable slugs, display names, and texture asset names:

```text
engine.svg        -> engine      -> Engine      -> T_MyIcon_Engine
3d-rotate.svg     -> 3d-rotate   -> 3D Rotate   -> T_MyIcon_3DRotate
acorn-fill.svg    -> acorn       -> Acorn       -> T_MyIcon_Acorn
```

For `unreal-texture-list`, the slug comes from `source.assets[].slug`, and optional `source.assets[].displayName` overrides the derived display name.

Selection behavior:

- `sat generate` with no `--asset` selects the full pack
- `--asset` for `generate` and `list` selects by slug; for `import` selects by slug or texture asset name
- folder modes sort slugs alphabetically, with `pluginIconAsset` or `engine` prioritized first
- `unreal-texture-list` preserves the curated `source.assets` order, with `pluginIconAsset` prioritized first if set

The ID lock is only rewritten during full generation with no `--limit`. Subset generation is useful for quick tests, but run full `sat generate` again before a release so the manifest and ID lock describe the full pack.

## Output Layout

Default output config:

```json
{
	"output": {
		"root": ".",
		"svgDir": "SourceArt/SVG",
		"textureDir": "SourceArt/Textures",
		"metadataDir": "SourceArt/Metadata",
		"assetPackMetadataDir": "Metadata",
		"pluginIconPath": "Resources/Icon128.png",
		"manifestFile": "MyIconPack.manifest.json",
		"idLockFile": "MyIconPack.id-lock.json",
		"assetPackMetadataFile": "MyIconPack_AssetMetadata.json"
	}
}
```

Outputs by source mode:

| Output                                       | `svg-folder`    | `png-folder`    | `unreal-texture-list`   |
| -------------------------------------------- | --------------- | --------------- | ----------------------- |
| `SourceArt/SVG/<TextureAssetName>.svg`       | yes             | no              | no                      |
| `SourceArt/Textures/<TextureAssetName>.png`  | yes             | yes             | no                      |
| `SourceArt/Metadata/<TextureAssetName>.json` | yes             | yes             | yes                     |
| `SourceArt/Metadata/<ModRef>.manifest.json`  | yes             | yes             | yes                     |
| `SourceArt/Metadata/<ModRef>.id-lock.json`   | yes             | yes             | yes, on full generation |
| `Metadata/<ModRef>_AssetMetadata.json`       | yes             | yes             | yes                     |
| `Resources/Icon128.png`                      | yes, by default | yes, by default | no, by default          |

## Unreal Import

Run `sat generate` before `sat import`. Import consumes the generated manifest and per-asset metadata; it does not rediscover source SVG, PNG, or texture-list config entries.

Before launching Unreal, `sat import` runs the same validation as `sat validate`, so imports will fail early if files are inconsistent. Keep `sat validate` in CI or release scripts for a faster standalone check.

| Step                                           | `svg-folder` / `png-folder` | `unreal-texture-list`            |
| ---------------------------------------------- | --------------------------- | -------------------------------- |
| Validate source PNGs                           | yes                         | no                               |
| Import textures with `AssetImportTask`         | yes                         | no                               |
| Load existing textures via `unreal.load_asset` | no                          | yes (verifies `Texture2D`)       |
| Apply texture settings                         | yes                         | no                               |
| Create/update `FGIconLibrary`                  | yes                         | yes                              |
| Create/update `FGGameFeatureData`              | yes                         | yes                              |
| Save assets                                    | all generated + imported    | icon library + game feature only |

Before launching Unreal, `sat import` verifies that the editor binary, project file, Python importer, and manifest exist. It also verifies that the mod is mounted at `<projectRoot>/Mods/GameFeatures/<modRef>`, matching `output.root`. Stale direct mounts at `<projectRoot>/Mods/<modRef>` fail the import. Use `--skip-mount-check` only with `--dry-run`.

Environment overrides:

- `PROJECT_ROOT`: default project root for Unreal commands
- `ENGINE_ROOT`: default Unreal Engine root for Unreal commands

After Unreal exits, the launcher prints `UNREAL_EXIT_CODE` and `UNREAL_LOG`, followed by filtered log lines unless `--no-log-tail` is set.

## Unreal Texture Scanner

`sat scan-textures` searches the Unreal Asset Registry for `Texture2D` assets under the given package paths, applies icon-like heuristics, and writes a candidate JSON file with a config snippet for manual curation.

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

## Generated Files

Manifest (`<ModRef>.manifest.json`):

```json
{
	"schemaVersion": 1,
	"modRef": "MyIconPack",
	"iconLibraryAssetPath": "/MyIconPack/IconLibraries/MyIconPack_IconLibrary.MyIconPack_IconLibrary",
	"assetCount": 1,
	"assets": [
		{
			"ID": 50000,
			"slug": "engine",
			"textureAssetName": "T_MyIcon_Engine",
			"textureSource": "generated",
			"texturePath": "../Textures/T_MyIcon_Engine.png",
			"displayName": "Engine"
		}
	]
}
```

For existing Unreal textures, entries use `"textureSource": "unreal-existing"` with `textureObjectPath` instead of `texturePath`.

ID lock (`<ModRef>.id-lock.json`):

```json
{
	"schemaVersion": 1,
	"modRef": "MyIconPack",
	"idBase": 50000,
	"maxAssignedId": 50002,
	"assets": [{ "ID": 50000, "slug": "engine", "textureAssetName": "T_MyIcon_Engine" }]
}
```

Per-asset metadata stores source information, expected Unreal paths, icon library entry data, and texture settings. Sidecar metadata stores the pack name, source catalog details, ID range, and a lookup table keyed by icon ID.

## Catalog Metadata

Optional source catalogs enrich the sidecar metadata with categories and search terms:

```json
{
	"source": {
		"type": "svg-folder",
		"dir": "../phosphor-icons/SVGs Flat/fill",
		"weight": "fill",
		"styleName": "phosphor-fill",
		"name": "Phosphor Icons",
		"catalog": "@phosphor-icons/core",
		"catalogVersion": "2.1.1",
		"catalogPath": "SourceArt/Catalog/phosphor-icons-core-2.1.1.json",
		"license": "MIT",
		"slugOverrides": {
			"logo": "phosphor-logo",
			"book-user": "book-open-user"
		}
	}
}
```

The catalog adapter expects an `icons` array with `name`, `categories`, and `tags` fields. `slugOverrides` maps generated asset slugs to catalog names when the catalog uses a different slug.

## Unreal Config

Defaults:

```json
{
	"unreal": {
		"textureDir": "Textures",
		"iconLibraryDir": "IconLibraries",
		"iconLibraryName": "MyIconPack_IconLibrary",
		"gameFeatureName": "MyIconPack",
		"textureSettings": {
			"MipGenSettings": "NoMipmaps",
			"TextureGroup": "Project01",
			"CompressionSettings": "Default",
			"sRGB": true
		}
	}
}
```

Generated Unreal object paths:

```text
/<ModRef>/<textureDir>/<TextureAssetName>.<TextureAssetName>
/<ModRef>/<iconLibraryDir>/<iconLibraryName>.<iconLibraryName>
/<ModRef>/<gameFeatureName>.<gameFeatureName>
```

Texture settings are applied to imported generated PNG textures only. The importer supports `NoMipmaps`, `Default` compression, `sRGB`, and texture groups `Project01`, `UI Streamable`, and `UI`. Existing Unreal textures are not modified.

## Troubleshooting

> **Mount check fails** Make sure `output.root` resolves to `<projectRoot>/Mods/GameFeatures/<modRef>`. Remove stale direct mounts at `<projectRoot>/Mods/<modRef>`.

> **`unreal.load_asset returned None`** Use the full object path format `/Package/Texture.Texture`, not only a package path. Confirm the texture exists in the same starter project that the commandlet is launching.

> **`Expected Texture2D, got ...`** The icon library entry must point at a `Texture2D`, not a material, blueprint, descriptor, or slate brush asset. Re-run `sat scan-textures` or inspect the asset in Unreal.

> **Generated source texture is missing during import** Run `sat generate` before `sat import`. Generated SVG/PNG modes require the manifest `texturePath` to point at an existing PNG.

> **PNG validation fails** Generated SVG/PNG icon textures are expected to be square white RGBA PNGs of the configured `size`. Use `--skip-png-validation` only for debugging or intentionally nonstandard inputs.

> **Unreal logs are hard to find** Use `--log /absolute/path/to/import.log`, `--log-tail-lines N`, or `--no-log-tail`. The launcher uses `-abslog` so absolute log paths are honored.

> **The mod does not appear in game** Package with Alpakit and install the packaged mod under `FactoryGame/Mods/GameFeatures/<ModRef>`. GameFeature mods installed directly under `FactoryGame/Mods/<ModRef>` are not the expected layout for this workflow.

## Development

Install dependencies:

```bash
pnpm install
```

Run all checks:

```bash
pnpm check
```

Run tests:

```bash
pnpm test
```

Format:

```bash
pnpm format
```
