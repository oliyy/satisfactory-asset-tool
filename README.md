# Satisfactory Asset Tool

Tooling for building Satisfactory icon packs and importing them into an Unreal modding project.

You give it a folder of SVGs or PNGs (or a list of textures that already ship with the game), and it renders the textures, writes the metadata and icon library, and imports the result so the icons show up in the in-game icon picker.

The work is split across three commands. They're non-interactive and return proper exit codes, so they run fine in scripts and CI:

- `sat generate` renders sources into textures, metadata, and a manifest
- `sat validate` checks that the generated files are consistent
- `sat import` launches Unreal and imports everything into your mod

## What can I make?

| I want to...                                         | Start here                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| Turn a folder of SVGs/PNGs into an icon pack         | **[Make an icon pack](docs/guides/icon-pack.md)**              |
| Surface existing in-game textures in the icon picker | [Use existing game textures](docs/guides/existing-textures.md) |
| Make custom sign backgrounds from images             | [Sign backgrounds](docs/guides/sign-backgrounds.md)            |

## Quick start

Install the tool in your asset pack project:

```bash
npm install --save-dev @oliyy_/satisfactory-asset-tool
```

Put your `.svg` files in an `icons/` folder and create `asset-pack.config.json` next to them:

```json
{
	"modRef": "MyIconPack",
	"name": "My Icon Pack",
	"assetPrefix": "T_MyIcon_",
	"idBase": 50000,
	"iconType": "Monochrome",
	"size": 512,
	"color": "#ffffff",
	"pluginIconAsset": "engine",
	"source": { "type": "svg-folder", "dir": "icons", "name": "Local SVG Icons" },
	"output": { "root": "." }
}
```

Then:

```bash
npx sat generate     # render textures + metadata
npx sat validate     # check everything is consistent
npx sat import       # import into your Unreal project
```

The [Make an icon pack](docs/guides/icon-pack.md) guide covers each step in detail, including where the config lives inside a GameFeature mod and how to package the result with Alpakit.

## Requirements

- Node.js 24 or newer
- `rsvg-convert` on your `PATH`, for SVG sources (`source.type: "svg-folder"`)
- a Satisfactory modding Unreal project, for `sat import` and `sat scan-textures`

## Examples

Complete packs built with this tool, useful to copy or read through:

- [PhosphorIconPack](https://github.com/oliyy/SatisfactoryIcons/tree/main/PhosphorIconPack): 1,512 Phosphor icons from SVG, with catalog metadata (MIT)
- [LucideIconPack](https://github.com/oliyy/SatisfactoryIcons/tree/main/LucideIconPack): outline icons from Lucide via `svg-folder` (ISC)
- [SocialIcons](https://github.com/oliyy/SatisfactoryIcons/tree/main/SocialIcons): curated brand logos from Simple Icons (CC0)

There's also a minimal starting config in [`examples/`](examples/) in this repo.

## Guides

- [Make an icon pack](docs/guides/icon-pack.md): the full SVG/PNG walkthrough
- [Use existing game textures](docs/guides/existing-textures.md): scan, curate, import
- [Sign backgrounds](docs/guides/sign-backgrounds.md): image-backed sign backgrounds

## Reference

- [Config reference](docs/reference/config.md): config fields, source modes, catalog, and Unreal settings
- [CLI reference](docs/reference/cli.md): every command and flag
- [Output and import reference](docs/reference/output.md): generated files, output layout, naming, import steps, and troubleshooting

## Development

```bash
pnpm install        # install dependencies
pnpm check          # run all checks
pnpm test           # run tests
pnpm format         # format
```

## License

See [LICENSE](LICENSE).
