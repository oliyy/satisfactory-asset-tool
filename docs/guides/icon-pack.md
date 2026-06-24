# Make an icon pack

This guide goes from a folder of SVG or PNG files to a working icon pack that appears in the in-game icon picker. By the end you'll have a configured project, generated textures and metadata, the icons imported into your Unreal project, and a packaged mod you can play with.

If you'd rather start from a finished pack, [PhosphorIconPack](https://github.com/oliyy/SatisfactoryIcons/tree/main/PhosphorIconPack) is a real one built with this workflow. Copy its layout and `asset-pack.config.json` and adapt them.

This guide assumes you already have a Satisfactory modding Unreal project (the SatisfactoryModLoader starter project) and can package a GameFeature mod with Alpakit. The tool produces assets for that project; it doesn't set the project up for you. If you're not there yet, do that first.

## 1. Install the tool

The tool runs inside your asset pack project, so install it there as a dev dependency:

```bash
npm install --save-dev @oliyy_/satisfactory-asset-tool
```

Run it with `npx sat <command>`. You'll also need:

- Node.js 24 or newer
- `rsvg-convert` on your `PATH`, for SVG sources (`source.type: "svg-folder"`). PNG sources don't need it.
- a Satisfactory modding Unreal project, for `sat import`. The generate and validate steps run without Unreal.

## 2. Set up the pack folder

A GameFeature icon pack lives inside your modding project at `<projectRoot>/Mods/GameFeatures/<modRef>`, where `<modRef>` is the name of your pack and its Unreal package root. Create that folder and put your source icons in a subfolder:

```text
Mods/GameFeatures/MyIconPack/
├─ asset-pack.config.json     (you'll create this next)
└─ icons/                     (your .svg or .png files)
   ├─ engine.svg
   ├─ acorn.svg
   └─ ...
```

Each filename becomes the icon's slug, display name, and texture asset name, so name the files deliberately:

```text
engine.svg        ->  Engine      ->  T_MyIcon_Engine
3d-rotate.svg     ->  3D Rotate   ->  T_MyIcon_3DRotate
acorn-fill.svg    ->  Acorn       ->  T_MyIcon_Acorn   (with weight: "fill")
```

The [naming rules](../reference/output.md#naming-and-selection) cover the edge cases.

## 3. Write the config

Create `asset-pack.config.json` in your pack root. A minimal SVG config looks like this:

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

The fields you'll usually set:

- `modRef`: your pack's package root. Generated Unreal paths go under `/<modRef>/...`.
- `assetPrefix`: the prefix on every generated texture name (`T_MyIcon_Engine`).
- `idBase`: the first icon ID. Saves reference icons by ID, so pick a base that won't collide with other mods and leave it alone after release. Valid range is `0` to `65535`.
- `iconType`: the icon category. `Monochrome` suits tintable single-color icons; the other values are listed in the [config reference](../reference/config.md#icontype-values).
- `size`: the square PNG size in pixels.
- `color`: the color SVGs render in. White (`#ffffff`) is correct for `Monochrome` icons so the game can tint them.
- `pluginIconAsset`: which icon to reuse as the mod's own `Resources/Icon128.png` when that file is missing. Existing custom plugin icons are left untouched unless you pass `--overwrite-plugin-icon`.
- `source.dir`: your source folder, resolved relative to `output.root`.
- `output.root`: everything else resolves relative to this. `"."` is the pack root.

For PNG sources, set `source.type` to `"png-folder"` and point `source.dir` at the PNGs. Icon PNGs have to be square, white, 8-bit RGBA images at the configured `size`, and you don't need `rsvg-convert`. Otherwise the rest of this guide is the same.

The [config reference](../reference/config.md) lists every field and source option.

## 4. Generate the assets

```bash
npx sat generate
```

This renders your sources and writes the manifest, ID lock, and per-asset metadata. Take a look at what landed under `SourceArt/` before moving on.

To keep iteration fast, generate a subset:

```bash
npx sat generate --asset engine,acorn
npx sat list                      # the IDs, slugs, and names that will be produced
```

One catch: subset generation (`--asset` or `--limit`) does not rewrite the ID lock. Run a full `npx sat generate` with no filters before you release, so the manifest and ID lock describe the whole pack.

## 5. Validate

```bash
npx sat validate
```

Validation checks the generated files without changing them: square white RGBA PNGs at the right size, a coherent manifest, no ID drift. `sat import` runs the same check before it launches Unreal, so this is a quick way to catch problems early, and it's worth keeping in CI.

## 6. Import into Unreal

`sat import` launches Unreal headlessly and imports the manifest, creating the `Texture2D` assets, the `FGIconLibrary`, and the `FGGameFeatureData`.

```bash
npx sat import \
	--project-root "C:\\Modding\\SatisfactoryModLoader" \
	--engine-root "C:\\Program Files\\Unreal Engine - CSS"
```

You can set `PROJECT_ROOT` and `ENGINE_ROOT` as environment variables instead of passing the flags every time. Do a dry run first to check everything resolves:

```bash
npx sat import --dry-run
```

Import checks that your pack is mounted at `<projectRoot>/Mods/GameFeatures/<modRef>` (matching `output.root`) before it does anything. If that check fails, see [Troubleshooting](#troubleshooting) below.

## 7. Package and play

Import only puts the assets into your Unreal project. To use them in game, package the mod with Alpakit like any GameFeature mod, then install the result under:

```text
FactoryGame/Mods/GameFeatures/<ModRef>
```

Launch the game and the icons show up in the picker under the section name you set.

## Show up in Icon Picker Plus

Every `sat generate` also writes a metadata sidecar at `Metadata/<ModRef>_AssetMetadata.json`. You don't create it separately; it comes out of generation with everything else. Shipping it is recommended, because [Icon Picker Plus](https://ficsit.app/mod/IconPickerPlus) reads it to auto-detect your pack and sort your icons into categories in its in-game browser.

To make use of it:

- Keep the `Metadata/` folder in your packaged mod so the sidecar ships alongside the icons. Icon Picker Plus scans each mod's `Metadata/` folder for `*_AssetMetadata.json`.
- Add a [source catalog](../reference/config.md#catalog-metadata) if you want categories and search. The catalog fills in each icon's categories and search terms; without one, your icons are still detected and named correctly, but they land in a single uncategorized group.

With the sidecar present, Icon Picker Plus matches your icons by icon library and ID, shows their display names, groups them by category, and makes them searchable. The [sidecar reference](../reference/output.md#asset-pack-metadata-sidecar) describes the file in full.

## Releasing updates

When you add or remove icons later:

1. Run a full `npx sat generate` (no `--asset` or `--limit`) so the ID lock stays correct.
2. `npx sat validate`
3. `npx sat import`
4. Re-package with Alpakit.

Don't reuse an ID for a different icon, and don't change `idBase` after release. Existing saves reference icons by ID.

## Troubleshooting

> **Mount check fails.** Make sure `output.root` resolves to `<projectRoot>/Mods/GameFeatures/<modRef>`, and remove any stale direct mount at `<projectRoot>/Mods/<modRef>`.

> **PNG validation fails.** Icon PNGs have to be square, white, 8-bit RGBA at the configured `size`. Convert other formats before generating. Use `--skip-png-validation` only when debugging.

> **Generated source texture missing during import.** Run `sat generate` before `sat import`. Import consumes the manifest; it doesn't re-render sources.

> **The mod doesn't appear in game.** Package with Alpakit and install under `FactoryGame/Mods/GameFeatures/<ModRef>`. A direct `Mods/<ModRef>` layout isn't what this workflow expects.

> **Unreal logs are hard to find.** The launcher prints the resolved log path and a filtered tail. Use `--log /absolute/path.log`, `--log-tail-lines N`, or `--no-log-tail` to control it.

The [full troubleshooting list](../reference/output.md#troubleshooting) covers more cases.

## See also

- [Catalog metadata](../reference/config.md#catalog-metadata), to add categories and search tags
- [Use existing game textures](existing-textures.md)
- [Sign backgrounds](sign-backgrounds.md)
- [CLI reference](../reference/cli.md)
