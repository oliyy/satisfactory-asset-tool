# Use existing game textures

Instead of importing your own art, you can take textures that already exist in the Starter Project (vanilla `Texture2D` assets like building and item icons) and register them in your own icon library, so they show up in the in-game icon picker.

This uses the `unreal-texture-list` source. You give the tool a curated list of existing Unreal object paths, and it registers them without rendering or importing any new images.

This guide assumes you've read [Make an icon pack](icon-pack.md) for the basic generate, validate, and import flow. What's different here is the source and the discovery step that comes before it.

## 1. Scan for candidate textures

You rarely know the exact object paths up front, so start by scanning the project's Asset Registry for icon-like `Texture2D` assets:

```bash
npx sat scan-textures --output unreal-texture-candidates.json
```

This launches Unreal, searches under `/Game/FactoryGame` by default, applies icon-like heuristics, and writes a candidate JSON file with a config snippet you can paste from.

Narrow or widen the search as needed:

```bash
npx sat scan-textures --package-path /Game/FactoryGame --keyword icon,ui,desc
npx sat scan-textures --include-dimensions --dimensions-limit 250
```

Detection is deliberately conservative. Material-map names (`Normal`, `MREO`, `ORM`, `Roughness`, `Metallic`, `Mask`) are excluded unless there's a stronger icon signal. Use `--include-dimensions` when width and height help you decide what to keep. The [scanner reference](../reference/cli.md#sat-scan-textures) has all the options and example output.

## 2. Curate the list

Open the candidate file and pick the textures you want. Each entry you keep needs a `slug` and a `textureObjectPath` (the full Unreal object path, `packageName.assetName`); `displayName` is optional and derived from the slug when omitted.

Move the entries you want into your `asset-pack.config.json`:

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

A few things work differently from a normal SVG/PNG pack:

- The order of `source.assets` is preserved (with `pluginIconAsset` first if set), rather than sorted alphabetically.
- There are no source files to render, so generation skips all SVG/PNG work.
- `pluginIconAsset` is off by default for this source, so you won't get an automatic `Resources/Icon128.png`. Provide your own plugin icon if you want one.

## 3. Generate, validate, import

The rest is the same flow as any pack:

```bash
npx sat generate
npx sat validate
npx sat import --dry-run
npx sat import
```

On import, rather than importing new textures, the tool loads each existing `Texture2D` (verifying it really is a `Texture2D`) and registers it in your `FGIconLibrary`. Existing textures are never modified.

## Troubleshooting

> **`unreal.load_asset returned None`.** Use the full object path format `/Package/Texture.Texture`, not just a package path. Confirm the texture exists in the same Starter Project that the commandlet launches.

> **`Expected Texture2D, got ...`.** The entry has to point at a `Texture2D`, not a material, blueprint, descriptor, or slate brush. Re-run `sat scan-textures` or inspect the asset in Unreal.

The [full troubleshooting list](../reference/output.md#troubleshooting) covers more cases.

## See also

- Existing textures can also back sign backgrounds (for `contain` and `tile` modes). See [Sign backgrounds](sign-backgrounds.md).
- [CLI reference: `sat scan-textures`](../reference/cli.md#sat-scan-textures)
- [Config reference: source modes](../reference/config.md#source-modes)
