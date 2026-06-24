# Output and import reference

How the tool names assets, what it writes, and what `sat import` does in Unreal.

- [Naming and selection](#naming-and-selection)
- [Output layout](#output-layout)
- [Generated files](#generated-files)
- [Asset pack metadata sidecar](#asset-pack-metadata-sidecar)
- [Unreal import](#unreal-import)
- [Troubleshooting](#troubleshooting)

## Naming and selection

Source filenames become stable slugs, display names, and texture asset names:

```text
engine.svg        -> engine      -> Engine      -> T_MyIcon_Engine
3d-rotate.svg     -> 3d-rotate   -> 3D Rotate   -> T_MyIcon_3DRotate
acorn-fill.svg    -> acorn       -> Acorn       -> T_MyIcon_Acorn
```

For `unreal-texture-list`, the slug comes from `source.assets[].slug`, and optional `source.assets[].displayName` overrides the derived display name.

Selection behavior:

- `sat generate` with no `--asset` selects the full pack.
- `--asset` for `generate` and `list` selects by slug; for `import` selects by slug or texture asset name.
- folder modes sort slugs alphabetically, with `pluginIconAsset` or `engine` prioritized first.
- `unreal-texture-list` preserves the curated `source.assets` order, with `pluginIconAsset` prioritized first if set.

The ID lock is only rewritten during full generation with no `--limit`. Subset generation is useful for quick tests, but run full `sat generate` again before a release so the manifest and ID lock describe the full pack.

## Output layout

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
| `Resources/Icon128.png`                      | yes, if missing | yes, if missing | no, by default          |

For `background.type: "sign-image"`, local source modes still write PNGs under `SourceArt/Textures`, but the icon library entry points at a generated material instance under `/<ModRef>/<background.materialDir>/...`.

For normal SVG/PNG icon packs, existing `Resources/Icon128.png` files are left untouched by default. Pass `--overwrite-plugin-icon` to regenerate the plugin icon from `pluginIconAsset`.

Sign-image packs do not write `Resources/Icon128.png` by default, even with `svg-folder` or `png-folder` sources. Provide a deliberate plugin icon yourself; sign-image generation leaves it untouched.

## Generated files

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

Sign background entries additionally include `iconObjectType`, `iconAssetName`, and `iconObjectPath`. In per-asset metadata, `expectedTextureObjectPath` is the imported or loaded source texture, while `expectedIconObjectPath` is the object assigned to `FIconData.Texture`. For sign-image backgrounds, `expectedIconObjectPath` is the generated material instance.

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

Per-asset metadata stores source information, expected Unreal paths, icon library entry data, and texture settings.

## Asset pack metadata sidecar

Every `sat generate` also writes a single pack-level sidecar at `Metadata/<ModRef>_AssetMetadata.json` (controlled by `output.assetPackMetadataDir` and `output.assetPackMetadataFile`). It's produced for all three source modes. The sidecar describes the whole pack and carries the category and search data that catalog-aware tools use.

```json
{
	"schema": "satisfactory-asset-pack-metadata",
	"schemaVersion": 1,
	"modRef": "MyIconPack",
	"name": "My Icon Pack",
	"sectionName": "My Icons",
	"assetPath": "/MyIconPack/IconLibraries/MyIconPack_IconLibrary.MyIconPack_IconLibrary",
	"idRange": { "min": 50000, "max": 50002 },
	"source": {
		"name": "Local SVG Icons",
		"catalog": null,
		"catalogVersion": null,
		"style": "",
		"license": null
	},
	"generation": { "tool": "satisfactory-asset-tool", "version": "0.2.0" },
	"assets": {
		"50000": {
			"slug": "engine",
			"sourceSlug": "engine",
			"displayName": "Engine",
			"primaryCategory": null,
			"categories": [],
			"searchTerms": [],
			"texturePath": "/MyIconPack/Textures/T_MyIcon_Engine.T_MyIcon_Engine",
			"sourceTexturePath": "/MyIconPack/Textures/T_MyIcon_Engine.T_MyIcon_Engine",
			"iconObjectPath": "/MyIconPack/Textures/T_MyIcon_Engine.T_MyIcon_Engine",
			"iconObjectType": "Texture2D"
		}
	}
}
```

`assetPath` is the generated icon library object path, and `assets` is keyed by local icon ID. `primaryCategory`, `categories`, and `searchTerms` are filled in from a [source catalog](config.md#catalog-metadata); without one they stay `null`/empty, while `slug`, `displayName`, and the object paths are always populated. For sign-image backgrounds, `texturePath`/`iconObjectPath` point at the generated material instance.

### Icon Picker Plus integration

Shipping the sidecar is recommended, because [Icon Picker Plus](https://ficsit.app/mod/IconPickerPlus) reads it to auto-detect your pack and sort your icons into categories in its in-game browser. It scans each installed mod's `Metadata/` folder (and the project/game `Mods` folders) for `*_AssetMetadata.json`, matches each visible icon to a sidecar entry by icon library and local ID, then uses `displayName` for the name, `primaryCategory`/`categories` for grouping, and `searchTerms` for search.

So, to get the most out of it:

- Keep the `Metadata/` folder in your packaged mod so the sidecar ships alongside the icons.
- Add a [source catalog](config.md#catalog-metadata) if you want categories and search. Without one, your icons are still detected and named correctly, but they land in a single uncategorized group.

## Unreal import

Run `sat generate` before `sat import`. Import consumes the generated manifest and per-asset metadata; it does not rediscover source SVG, PNG, or texture-list config entries.

Before launching Unreal, `sat import` runs the same validation as `sat validate`, so imports fail early if files are inconsistent. Keep `sat validate` in CI or release scripts for a faster standalone check.

| Step | `svg-folder` / `png-folder` | `unreal-texture-list` |
| --- | --- | --- |
| Validate source PNGs | yes | no |
| Import textures with `AssetImportTask` | yes | no |
| Load existing textures via `unreal.load_asset` | no | yes (verifies `Texture2D`) |
| Apply texture settings | yes | no |
| Create/update sign background material instance | when `background.type` is `sign-image` | when `background.type` is `sign-image` and mode is `contain` or `tile` |
| Create/update `FGIconLibrary` | yes | yes |
| Create/update `FGGameFeatureData` | yes | yes |
| Save assets | all generated + imported | icon library + game feature only |

Before launching Unreal, `sat import` verifies that the editor binary, project file, Python importer, and manifest exist. It also verifies that the mod is mounted at `<projectRoot>/Mods/GameFeatures/<modRef>`, matching `output.root`. Stale direct mounts at `<projectRoot>/Mods/<modRef>` fail the import. Use `--skip-mount-check` only with `--dry-run`.

## Troubleshooting

> **Mount check fails.** Make sure `output.root` resolves to `<projectRoot>/Mods/GameFeatures/<modRef>`. Remove stale direct mounts at `<projectRoot>/Mods/<modRef>`.

> **`unreal.load_asset returned None`.** Use the full object path format `/Package/Texture.Texture`, not only a package path. Confirm the texture exists in the same starter project that the commandlet is launching.

> **`Expected Texture2D, got ...`.** The icon library entry must point at a `Texture2D`, not a material, blueprint, descriptor, or slate brush asset. Re-run `sat scan-textures` or inspect the asset in Unreal.

> **Generated source texture is missing during import.** Run `sat generate` before `sat import`. Generated SVG/PNG modes require the manifest `texturePath` to point at an existing PNG.

> **PNG validation fails for icon packs.** Generated SVG/PNG icon textures are expected to be square white RGBA PNGs of the configured `size`. Use `--skip-png-validation` only for debugging or intentionally nonstandard inputs.

> **PNG validation fails for sign backgrounds.** Sign background source images must be 8-bit RGBA PNGs. Convert JPEG, WebP, RGB PNG, indexed PNG, or grayscale PNG files to RGBA PNG before running `sat generate`.

> **Sign background renders square in-world.** Make sure the generated material instance has `TileWidth` and `TileHeight` matching the intended aspect. These values matter even when `FillMode=1`.

> **Sign background preview works but in-world render is wrong.** Validate the saved sign in-world. The picker thumbnail, designer preview, and in-world sign are different render paths.

> **Unreal logs are hard to find.** Use `--log /absolute/path/to/import.log`, `--log-tail-lines N`, or `--no-log-tail`. The launcher uses `-abslog` so absolute log paths are honored.

> **The mod does not appear in game.** Package with Alpakit and install the packaged mod under `FactoryGame/Mods/GameFeatures/<ModRef>`. GameFeature mods installed directly under `FactoryGame/Mods/<ModRef>` are not the expected layout for this workflow.
