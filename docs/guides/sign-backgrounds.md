# Sign backgrounds

Besides icons, this tool can turn images into Satisfactory sign backgrounds, the images you choose behind the text on in-world signs. This is a more involved workflow than a plain icon pack: each source image is imported as a `Texture2D`, wrapped in a generated `MaterialInstanceConstant` parented to the stock sign background material, and registered in your icon library.

This guide assumes you're comfortable with the generate, validate, and import flow from [Make an icon pack](icon-pack.md). Sign backgrounds add a `background` block to your config and a few rendering rules to keep in mind.

## How it works

Setting `background.type: "sign-image"` changes what each selected source image becomes. Local SVG/PNG sources are imported as `Texture2D` assets, then wrapped in material instances parented to the stock material:

```text
/Game/FactoryGame/Interface/UI/InGame/Signs/SignBackgrounds/MM_UI_SignBG.MM_UI_SignBG
```

The generated `FGIconLibrary` entry uses `IconType: Material`, writes directly to `mIconData`, and points `FIconData.Texture` at the generated material instance. This matches the tested in-game contract for custom sign backgrounds.

## Source format requirements

Sign background sources can be colored and non-square (unlike icons), but they still have to be 8-bit RGBA PNG (or SVG). Convert JPEG, WebP, RGB PNG, indexed PNG, and grayscale PNG to 8-bit RGBA PNG before generating.

## Config

Use a `png-folder` or `svg-folder` source and add a `background` block. You can define multiple `variants`, each producing its own entry per source image:

```json
{
	"modRef": "MyBackgroundPack",
	"name": "My Background Pack",
	"sectionName": "My Backgrounds",
	"assetPrefix": "T_MyBG_",
	"idBase": 62000,
	"source": {
		"type": "png-folder",
		"dir": "backgrounds",
		"weight": "",
		"name": "Local Backgrounds"
	},
	"background": {
		"type": "sign-image",
		"variants": [
			{ "suffix": "contain", "displayNameSuffix": "Contain", "mode": "contain" },
			{
				"suffix": "cover-2x1",
				"displayNameSuffix": "Cover 2x1",
				"mode": "cover",
				"targetAspect": "2:1",
				"tileWidth": 800,
				"tileHeight": 400
			},
			{
				"suffix": "tile",
				"displayNameSuffix": "Tile",
				"mode": "tile",
				"tileWidth": 400,
				"tileHeight": 400
			}
		]
	},
	"output": {
		"root": "."
	}
}
```

If `background.variants` is omitted, one entry is generated per source image from the top-level background settings. With variants, each source image produces one entry per variant, and the variant `suffix` becomes part of the generated slug and asset names.

## Modes

| Mode | Behavior | Material parameters |
| --- | --- | --- |
| `contain` | Shows the image once while preserving aspect. Other sign aspects may leave side/top gaps. | `FillMode=1`, `FitScale=1`, `TileWidth`/`TileHeight` from image or config |
| `cover` | Center-crops the generated PNG to a target aspect, then shows it once. Use for full-bleed signs. | `FillMode=1`, `FitScale=1`, `TileWidth`/`TileHeight` from target aspect/config |
| `tile` | Repeats the image. Use for seamless patterns. | `FillMode=0`, configured `TileWidth`/`TileHeight` |

A few rules to keep in mind:

- `TileWidth` and `TileHeight` are always emitted, because the stock material uses them for runtime sizing even when `FillMode=1`. This is why a background can render square in-world if they're wrong.
- `cover` variants have to define `targetAspect`, or both `tileWidth` and `tileHeight`.
- `cover` needs local `svg-folder`/`png-folder` sources, because the generator has to crop the PNG before import.

## Using existing textures as backgrounds

`unreal-texture-list` sources can also back sign backgrounds, but only for `contain` and `tile` modes. They can't be cropped, so `cover` isn't available. See [Use existing game textures](existing-textures.md) for how to build the source list.

## Output notes

- Generated source textures use `unreal.textureDir`; material instances use `background.materialDir` (`SignBackgrounds` by default). Pointing both at the same folder is fine, since the `T_` and `MI_` prefixes keep the names distinct.
- Sign-image packs do not write `Resources/Icon128.png` by default, even with SVG/PNG sources. Provide a plugin icon yourself; sign-image generation leaves it untouched.
- Sign-image imports also set texture address modes to wrap by default.

## Generate, validate, import

Same flow as any pack:

```bash
npx sat generate
npx sat validate
npx sat import --dry-run
npx sat import
```

## Troubleshooting

> **PNG validation fails for sign backgrounds.** Source images have to be 8-bit RGBA PNGs. Convert JPEG, WebP, RGB PNG, indexed PNG, or grayscale PNG first.

> **Sign background renders square in-world.** Make sure the generated material instance has `TileWidth`/`TileHeight` matching the intended aspect. They matter even when `FillMode=1`.

> **Preview works but the in-world render is wrong.** Check the saved sign in-world. The picker thumbnail, the designer preview, and the in-world sign are different render paths.

The [full troubleshooting list](../reference/output.md#troubleshooting) covers more cases.

## See also

- [Config reference: sign background images](../reference/config.md#sign-background-images)
- [Output reference: import steps](../reference/output.md#unreal-import)
