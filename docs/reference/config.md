# Config reference

Complete reference for `asset-pack.config.json`. For a guided introduction, start with [Make an icon pack](../guides/icon-pack.md).

- [Relative path rules](#relative-path-rules)
- [Top-level fields](#top-level-fields)
- [`iconType` values](#icontype-values)
- [Source modes](#source-modes)
- [Sign background images](#sign-background-images)
- [Catalog metadata](#catalog-metadata)
- [Unreal config](#unreal-config)

## Relative path rules

- `output.root` is resolved relative to the config file.
- `source.dir` is resolved relative to `output.root`.
- output directories are resolved relative to `output.root`.
- `source.catalogPath`, when set, is resolved relative to `output.root`.

## Top-level fields

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `modRef` | yes | (none) | Unreal package root and mod reference. Generated paths go under `/<modRef>/...` |
| `name` | no | `modRef` | Human-readable pack name for sidecar metadata |
| `sectionName` | no | `modRef` | Grouping label for sidecar consumers |
| `assetPrefix` | no | `T_<modRef>_` | Prefix for generated Unreal texture asset names |
| `idBase` | no | `50000` | First local asset ID. Valid range: `0`–`65535`. Avoid changing after release |
| `iconType` | no | `Monochrome` | Satisfactory `EIconType` for generated `FIconData` entries |
| `size` | no | `512` | Square PNG output size in pixels |
| `color` | no | `#ffffff` | SVG render color (sets root `color` and `fill` before rendering) |
| `pluginIconAsset` | no | (none) | Source slug for `Resources/Icon128.png`. Normal SVG/PNG icon packs generate it only when the file is missing; pass `--overwrite-plugin-icon` to replace an existing icon. Off by default for `unreal-texture-list` and `background.type: "sign-image"` |

## `iconType` values

Accepted values: `Building`, `Part`, `Equipment`, `Monochrome`, `Material`, `Custom`, `MapStamp`, `None`.

Short names, Unreal enum names like `ESIT_Monochrome`, and fully qualified names are all accepted.

## Source modes

`source.type` is one of `svg-folder`, `png-folder`, or `unreal-texture-list`.

### `svg-folder`

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

Scans `source.dir` for `.svg` files. Slugs are normalized from filenames. If `weight` is set, that suffix is stripped from slugs and preferred when multiple files collapse to the same slug (e.g. `acorn-fill.svg` becomes slug `acorn`). Requires `rsvg-convert` on `PATH`.

### `png-folder`

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

Scans `source.dir` for `.png` files. PNGs are copied into the generated texture output directory and validated unless `--skip-png-validation` is set. Normal icon PNGs must be square white RGBA images at the configured `size`; sign background PNGs may be colored and non-square but must still be 8-bit RGBA PNGs.

### `unreal-texture-list`

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

Existing Unreal textures can also be wrapped as sign-image backgrounds for `contain` and `tile` modes. `cover` mode requires local `svg-folder` or `png-folder` sources because the tool has to crop the generated PNG before import.

### Shared source fields

- `source.type`: one of `svg-folder`, `png-folder`, or `unreal-texture-list`
- `source.dir`: folder containing source files for folder modes
- `source.weight`: style suffix to prefer and strip from slugs, such as `fill`
- `source.styleName`: label written into the manifest and metadata
- `source.name`, `source.catalog`, `source.catalogVersion`, `source.catalogPath`, `source.license`: sidecar metadata fields
- `source.slugOverrides`: maps generated asset slugs to catalog names when catalog metadata uses a different name
- `styleSuffixes`: optional top-level suffix list to strip from source filenames; defaults to `["bold", "duotone", "fill", "light", "regular", "thin"]`

## Sign background images

`background.type: "sign-image"` converts each selected source image into one or more Satisfactory sign background entries. See the [Sign backgrounds guide](../guides/sign-backgrounds.md) for the full walkthrough; this section is the field reference.

Local SVG/PNG sources are imported as `Texture2D` assets, then wrapped in generated `MaterialInstanceConstant` assets parented to the stock sign background material:

```text
/Game/FactoryGame/Interface/UI/InGame/Signs/SignBackgrounds/MM_UI_SignBG.MM_UI_SignBG
```

The generated `FGIconLibrary` entry uses `IconType: Material`, writes directly to `mIconData`, and points `FIconData.Texture` at the generated material instance.

### Modes

| Mode | Behavior | Material parameters |
| --- | --- | --- |
| `contain` | Shows the image once while preserving aspect. Different sign aspects may leave side/top gaps. | `FillMode=1`, `FitScale=1`, `TileWidth`/`TileHeight` from image or config |
| `cover` | Center-crops the generated PNG to a target aspect, then shows it once. Use for full-bleed sign targets. | `FillMode=1`, `FitScale=1`, `TileWidth`/`TileHeight` from target aspect/config |
| `tile` | Repeats the image. Use for seamless patterns. | `FillMode=0`, configured `TileWidth`/`TileHeight` |

- `TileWidth` and `TileHeight` are always emitted for sign-image backgrounds because the stock material uses them for runtime sizing even when `FillMode=1`.
- `cover` variants must define `targetAspect` or both `tileWidth` and `tileHeight`. Existing Unreal texture sources cannot use `cover`.
- If `background.variants` is omitted, one entry is generated per source image using the top-level background settings. With variants, each source image produces one entry per variant, and variant suffixes become part of the generated slug and asset names.
- Generated source textures use `unreal.textureDir`; material instances use `background.materialDir` (`SignBackgrounds` by default). Both may point at the same folder; `T_` and `MI_` prefixes keep names distinct.

## Catalog metadata

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

The catalog's `categories` and `tags` flow into each icon's `primaryCategory`, `categories`, and `searchTerms` in the [metadata sidecar](output.md#asset-pack-metadata-sidecar), which is what lets Icon Picker Plus categorize and search your pack in-game. Without a catalog the icons still generate and ship normally, but they have no category or search data.

The [PhosphorIconPack](https://github.com/oliyy/SatisfactoryIcons/tree/main/PhosphorIconPack) is a real example that uses catalog metadata.

## Unreal config

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

Sign-image background imports also set texture address modes to wrap by default and create material instances under `background.materialDir`, which defaults to `SignBackgrounds`.
