import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { generateAssetPack, validateExistingAssetPack } from '../src/asset-pack/generate.js'
import { loadAssetPackConfig } from '../src/core/config.js'
import { readPngDimensions, writePngRgba } from '../src/core/png.js'
import type { AssetPackManifest } from '../src/core/types.js'

const fixtureRoot = path.resolve('test/fixtures/phosphor-mini')

test('generates and validates a Phosphor-style icon pack', async () => {
	const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'sat-asset-tool-'))
	const configPath = path.join(outputRoot, 'asset-pack.config.json')

	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				modRef: 'PhosphorIconPack',
				name: 'Phosphor Icon Pack',
				sectionName: 'Phosphor',
				assetPrefix: 'T_Phosphor_',
				idBase: 50000,
				pluginIconAsset: 'engine',
				source: {
					type: 'svg-folder',
					dir: path.join(fixtureRoot, 'source'),
					weight: 'fill',
					styleName: 'phosphor-fill',
					name: 'Phosphor Icons',
					catalog: '@phosphor-icons/core',
					catalogVersion: '2.1.1',
					catalogPath: path.join(fixtureRoot, 'catalog/phosphor-icons-core-2.1.1.json'),
					license: 'MIT',
				},
				output: {
					root: outputRoot,
				},
				generation: {
					tool: 'process-icon.mjs',
					version: '1.0.0',
				},
			},
			null,
			2,
		)}\n`,
		'utf8',
	)

	const config = await loadAssetPackConfig(configPath)
	await generateAssetPack(config, { all: true })

	const manifest = JSON.parse(
		await readFile(path.join(outputRoot, 'SourceArt/Metadata/PhosphorIconPack.manifest.json'), 'utf8'),
	) as AssetPackManifest

	assert.equal(manifest.assetCount, 3)
	assert.deepEqual(
		manifest.assets.map((asset) => [asset.ID, asset.slug, asset.textureAssetName, asset.displayName]),
		[
			[50000, 'engine', 'T_Phosphor_Engine', 'Engine'],
			[50001, '3d-rotate', 'T_Phosphor_3DRotate', '3D Rotate'],
			[50002, 'acorn', 'T_Phosphor_Acorn', 'Acorn'],
		],
	)

	const sidecar = JSON.parse(await readFile(path.join(outputRoot, 'Metadata/PhosphorIconPack_AssetMetadata.json'), 'utf8'))
	assert.equal(sidecar.generation.tool, 'process-icon.mjs')
	assert.deepEqual(sidecar.assets['50001'].searchTerms, ['cube', 'turn'])
	assert.deepEqual(sidecar.assets['50002'].searchTerms, ['savings', 'nut'])

	await validateExistingAssetPack(config)
})

test('fails when PNG source filenames normalize to the same slug', async () => {
	const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'sat-asset-tool-png-collision-'))
	const sourceDir = path.join(outputRoot, 'icons')
	const configPath = path.join(outputRoot, 'asset-pack.config.json')

	await mkdir(sourceDir, { recursive: true })
	await Promise.all([writeFile(path.join(sourceDir, 'engine.png'), ''), writeFile(path.join(sourceDir, 'engine-fill.png'), '')])
	await writeConfig(configPath, {
		modRef: 'CollisionPack',
		source: {
			type: 'png-folder',
			dir: sourceDir,
			weight: '',
		},
		output: {
			root: outputRoot,
		},
	})

	const config = await loadAssetPackConfig(configPath)
	await assert.rejects(
		generateAssetPack(config, { all: true, list: true }),
		/Duplicate source files normalize to asset slug "engine".*engine-fill\.png.*engine\.png/,
	)
})

test('fails when unweighted SVG source filenames normalize to the same slug', async () => {
	const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'sat-asset-tool-svg-collision-'))
	const sourceDir = path.join(outputRoot, 'icons')
	const configPath = path.join(outputRoot, 'asset-pack.config.json')

	await mkdir(sourceDir, { recursive: true })
	await Promise.all([
		writeFile(path.join(sourceDir, 'engine.svg'), '<svg />'),
		writeFile(path.join(sourceDir, 'engine-fill.svg'), '<svg />'),
	])
	await writeConfig(configPath, {
		modRef: 'CollisionPack',
		source: {
			type: 'svg-folder',
			dir: sourceDir,
			weight: '',
		},
		output: {
			root: outputRoot,
		},
	})

	const config = await loadAssetPackConfig(configPath)
	await assert.rejects(
		generateAssetPack(config, { all: true, list: true }),
		/Duplicate source files normalize to asset slug "engine".*engine-fill\.svg.*engine\.svg/,
	)
})

test('uses the configured SVG weight as the only allowed duplicate slug preference', async () => {
	const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'sat-asset-tool-svg-preferred-'))
	const sourceDir = path.join(outputRoot, 'icons')
	const configPath = path.join(outputRoot, 'asset-pack.config.json')

	await mkdir(sourceDir, { recursive: true })
	await Promise.all([
		writeFile(path.join(sourceDir, 'engine.svg'), '<svg />'),
		writeFile(path.join(sourceDir, 'engine-fill.svg'), '<svg />'),
	])
	await writeConfig(configPath, {
		modRef: 'CollisionPack',
		source: {
			type: 'svg-folder',
			dir: sourceDir,
			weight: 'fill',
		},
		output: {
			root: outputRoot,
		},
	})

	const config = await loadAssetPackConfig(configPath)
	const result = await generateAssetPack(config, { all: true, list: true })

	assert.deepEqual(
		result.records.map((record) => [record.slug, path.basename(record.sourcePath)]),
		[['engine', 'engine-fill.svg']],
	)
})

test('generates and validates an Unreal texture list pack without local PNGs', async () => {
	const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'sat-asset-tool-unreal-textures-'))
	const configPath = path.join(outputRoot, 'asset-pack.config.json')
	const portableMinerPath = '/Game/FactoryGame/IconDesc_PortableMiner_256.IconDesc_PortableMiner_256'
	const chromeFinishPath =
		'/Game/FactoryGame/Buildable/-Shared/Customization/PaintFinishes/UI/IconDesc_ChromeFinish_256.IconDesc_ChromeFinish_256'

	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				modRef: 'ExistingTexturePack',
				name: 'Existing Texture Pack',
				sectionName: 'Existing Textures',
				assetPrefix: 'T_Existing_',
				idBase: 61000,
				iconType: 'Custom',
				source: {
					type: 'unreal-texture-list',
					name: 'FactoryGame Existing Textures',
					assets: [
						{
							slug: 'portable-miner',
							displayName: 'Portable Miner',
							textureObjectPath: portableMinerPath,
						},
						{
							slug: 'chrome-finish',
							textureObjectPath: chromeFinishPath,
						},
					],
				},
				output: {
					root: outputRoot,
				},
			},
			null,
			2,
		)}\n`,
		'utf8',
	)

	const config = await loadAssetPackConfig(configPath)
	await generateAssetPack(config, { all: true })

	const manifest = JSON.parse(
		await readFile(path.join(outputRoot, 'SourceArt/Metadata/ExistingTexturePack.manifest.json'), 'utf8'),
	) as AssetPackManifest
	const manifestPath = path.join(outputRoot, 'SourceArt/Metadata/ExistingTexturePack.manifest.json')

	assert.deepEqual(
		manifest.assets.map((asset) => [asset.ID, asset.slug, asset.textureAssetName, asset.displayName]),
		[
			[61000, 'portable-miner', 'T_Existing_PortableMiner', 'Portable Miner'],
			[61001, 'chrome-finish', 'T_Existing_ChromeFinish', 'Chrome Finish'],
		],
	)
	assert.deepEqual(manifest.assets[0], {
		ID: 61000,
		slug: 'portable-miner',
		sourceSlug: 'portable-miner',
		textureAssetName: 'T_Existing_PortableMiner',
		iconAssetName: 'T_Existing_PortableMiner',
		iconObjectPath: portableMinerPath,
		iconObjectType: 'texture',
		textureSource: 'unreal-existing',
		textureObjectPath: portableMinerPath,
		metadataPath: 'T_Existing_PortableMiner.json',
		displayName: 'Portable Miner',
	})
	await assert.rejects(readFile(path.join(outputRoot, 'SourceArt/Textures/T_Existing_PortableMiner.png'), 'utf8'), /ENOENT/)
	await assert.rejects(readFile(path.join(outputRoot, 'Resources/Icon128.png'), 'utf8'), /ENOENT/)

	const metadataPath = path.join(outputRoot, 'SourceArt/Metadata/T_Existing_PortableMiner.json')
	const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
	assert.equal(metadata.unreal.textureSource, 'unreal-existing')
	assert.equal(metadata.unreal.expectedTextureObjectPath, portableMinerPath)
	assert.equal(metadata.unreal.expectedIconObjectPath, portableMinerPath)
	assert.equal(metadata.unreal.iconObjectType, 'texture')
	assert.equal(metadata.unreal.iconLibraryEntry.Texture, portableMinerPath)
	assert.equal(metadata.unreal.iconLibraryEntry.DisplayNameOverride, true)

	const sidecar = JSON.parse(await readFile(path.join(outputRoot, 'Metadata/ExistingTexturePack_AssetMetadata.json'), 'utf8'))
	assert.equal(sidecar.source.style, '')
	assert.equal(sidecar.generation.version, await packageVersion(path.resolve('package.json')))
	assert.equal(sidecar.assets['61000'].texturePath, portableMinerPath)

	await validateExistingAssetPack(config)

	await writeFile(
		metadataPath,
		`${JSON.stringify(
			{
				...metadata,
				unreal: {
					...metadata.unreal,
					materialInstance: {
						parentMaterialObjectPath: '/Game/Parent.Parent',
						materialObjectPath: portableMinerPath,
						textureParameter: 'Texture',
						scalarParameters: {},
					},
				},
			},
			null,
			2,
		)}\n`,
		'utf8',
	)
	await assert.rejects(validateExistingAssetPack(config), /materialInstance must be null for texture icon assets/)
	await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

	await writeManifest(manifestPath, { ...manifest, schemaVersion: 2 })
	await assert.rejects(validateExistingAssetPack(config), /schemaVersion must be 1/)

	await writeManifest(manifestPath, { ...manifest, modRef: 'OtherTexturePack' })
	await assert.rejects(validateExistingAssetPack(config), /modRef OtherTexturePack does not match ExistingTexturePack/)

	await writeManifest(manifestPath, { ...manifest, localIdBase: 1 })
	await assert.rejects(validateExistingAssetPack(config), /localIdBase 1 does not match 61000/)

	await writeManifest(manifestPath, { ...manifest, localIdMax: 65000 })
	await assert.rejects(validateExistingAssetPack(config), /localIdMax 65000 does not match actual max 61001/)

	await writeManifest(manifestPath, { ...manifest, iconLibraryAssetPath: '/Other/IconLibrary.IconLibrary' })
	await assert.rejects(validateExistingAssetPack(config), /iconLibraryAssetPath .* does not match/)

	await writeManifest(manifestPath, { ...manifest, assetCount: 99 })
	await assert.rejects(validateExistingAssetPack(config), /assetCount 99 does not match assets length 2/)

	await writeFile(
		manifestPath,
		`${JSON.stringify({ ...manifest, assets: [{ ...manifest.assets[0], textureSource: 'generated' }, manifest.assets[1]] }, null, 2)}\n`,
		'utf8',
	)
	await assert.rejects(validateExistingAssetPack(config), /textureSource "generated" must define texturePath/)

	await writeFile(
		manifestPath,
		`${JSON.stringify({ ...manifest, assets: [{ ...manifest.assets[0], textureSource: 'unsupported' }, manifest.assets[1]] }, null, 2)}\n`,
		'utf8',
	)
	await assert.rejects(validateExistingAssetPack(config), /unsupported textureSource/)
})

test('generates sign image background material instance variants', async () => {
	const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'sat-asset-tool-backgrounds-'))
	const sourceDir = path.join(outputRoot, 'backgrounds')
	const configPath = path.join(outputRoot, 'asset-pack.config.json')

	await mkdir(sourceDir, { recursive: true })
	await writeFile(path.join(sourceDir, 'tank.png'), testPng(80, 40))
	await writeConfig(configPath, {
		modRef: 'BackgroundPack',
		name: 'Background Pack',
		sectionName: 'Backgrounds',
		assetPrefix: 'T_Background_',
		idBase: 62000,
		source: {
			type: 'png-folder',
			dir: sourceDir,
			weight: '',
		},
		background: {
			type: 'sign-image',
			baseTileHeight: 400,
			variants: [
				{
					suffix: 'contain',
					displayNameSuffix: 'Contain',
					mode: 'contain',
				},
				{
					suffix: 'tile',
					displayNameSuffix: 'Tile',
					mode: 'tile',
					tileWidth: 300,
					tileHeight: 150,
				},
				{
					suffix: 'cover-16x9',
					displayNameSuffix: 'Cover 16x9',
					mode: 'cover',
					targetAspect: '16:9',
					tileWidth: 1600,
					tileHeight: 900,
				},
			],
		},
		output: {
			root: outputRoot,
		},
	})

	const config = await loadAssetPackConfig(configPath)
	assert.equal(config.iconType, 'EIconType::ESIT_Material')
	await generateAssetPack(config, { all: true })

	const manifest = JSON.parse(
		await readFile(path.join(outputRoot, 'SourceArt/Metadata/BackgroundPack.manifest.json'), 'utf8'),
	) as AssetPackManifest

	assert.deepEqual(
		manifest.assets.map((asset) => [asset.ID, asset.slug, asset.textureAssetName, asset.iconAssetName, asset.iconObjectType]),
		[
			[62000, 'tank-contain', 'T_Background_TankContain', 'MI_BackgroundPack_TankContain', 'sign-background-material-instance'],
			[62001, 'tank-tile', 'T_Background_TankTile', 'MI_BackgroundPack_TankTile', 'sign-background-material-instance'],
			[62002, 'tank-cover-16x9', 'T_Background_TankCover16x9', 'MI_BackgroundPack_TankCover16x9', 'sign-background-material-instance'],
		],
	)

	const containMetadata = JSON.parse(await readFile(path.join(outputRoot, 'SourceArt/Metadata/T_Background_TankContain.json'), 'utf8'))
	assert.equal(containMetadata.unreal.iconLibraryEntry.IconType, 'EIconType::ESIT_Material')
	assert.equal(
		containMetadata.unreal.iconLibraryEntry.Texture,
		'/BackgroundPack/SignBackgrounds/MI_BackgroundPack_TankContain.MI_BackgroundPack_TankContain',
	)
	assert.equal(
		containMetadata.unreal.expectedTextureObjectPath,
		'/BackgroundPack/Textures/T_Background_TankContain.T_Background_TankContain',
	)
	assert.equal(
		containMetadata.unreal.expectedIconObjectPath,
		'/BackgroundPack/SignBackgrounds/MI_BackgroundPack_TankContain.MI_BackgroundPack_TankContain',
	)
	assert.deepEqual(containMetadata.unreal.materialInstance.scalarParameters, {
		FillMode: 1,
		FitScale: 1,
		TileWidth: 800,
		TileHeight: 400,
		RefractionDepthBias: 0,
	})
	assert.equal(containMetadata.unreal.textureSettings.AddressX, 'Wrap')
	assert.equal(containMetadata.unreal.textureSettings.AddressY, 'Wrap')

	const tileMetadata = JSON.parse(await readFile(path.join(outputRoot, 'SourceArt/Metadata/T_Background_TankTile.json'), 'utf8'))
	assert.deepEqual(tileMetadata.unreal.materialInstance.scalarParameters, {
		FillMode: 0,
		FitScale: 1,
		TileWidth: 300,
		TileHeight: 150,
		RefractionDepthBias: 0,
	})

	const coverDimensions = await readPngDimensions(path.join(outputRoot, 'SourceArt/Textures/T_Background_TankCover16x9.png'))
	assert.deepEqual(coverDimensions, { width: 71, height: 40 })

	const sidecar = JSON.parse(await readFile(path.join(outputRoot, 'Metadata/BackgroundPack_AssetMetadata.json'), 'utf8'))
	assert.equal(
		sidecar.assets['62000'].texturePath,
		'/BackgroundPack/SignBackgrounds/MI_BackgroundPack_TankContain.MI_BackgroundPack_TankContain',
	)
	assert.equal(sidecar.assets['62000'].sourceTexturePath, '/BackgroundPack/Textures/T_Background_TankContain.T_Background_TankContain')
	await assert.rejects(readFile(path.join(outputRoot, 'Resources/Icon128.png'), 'utf8'), /ENOENT/)

	await validateExistingAssetPack(config)
})

test('rejects invalid sign image background config combinations', async () => {
	const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'sat-asset-tool-background-config-'))
	const sourceDir = path.join(outputRoot, 'backgrounds')
	const configPath = path.join(outputRoot, 'asset-pack.config.json')

	await mkdir(sourceDir, { recursive: true })
	await writeFile(path.join(sourceDir, 'tank.png'), testPng(8, 8))

	await writeConfig(configPath, {
		modRef: 'BackgroundPack',
		iconType: 'Monochrome',
		source: {
			type: 'png-folder',
			dir: sourceDir,
			weight: '',
		},
		background: {
			type: 'sign-image',
		},
		output: {
			root: outputRoot,
		},
	})
	await assert.rejects(loadAssetPackConfig(configPath), /background\.type "sign-image" requires iconType Material/)

	await writeConfig(configPath, {
		modRef: 'BackgroundPack',
		source: {
			type: 'png-folder',
			dir: sourceDir,
			weight: '',
		},
		background: {
			type: 'sign-image',
			mode: 'cover',
		},
		output: {
			root: outputRoot,
		},
	})
	await assert.rejects(loadAssetPackConfig(configPath), /cover mode requires targetAspect or both tileWidth and tileHeight/)

	await writeConfig(configPath, {
		modRef: 'BackgroundPack',
		source: {
			type: 'unreal-texture-list',
			assets: [
				{
					slug: 'factory-texture',
					textureObjectPath: '/Game/FactoryGame/Texture.Texture',
				},
			],
		},
		background: {
			type: 'sign-image',
			mode: 'cover',
			targetAspect: '1:1',
		},
		output: {
			root: outputRoot,
		},
	})
	await assert.rejects(loadAssetPackConfig(configPath), /cover mode requires local svg-folder or png-folder sources/)
})

test('validates sign image material-instance metadata before Unreal import', async () => {
	const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'sat-asset-tool-background-validation-'))
	const sourceDir = path.join(outputRoot, 'backgrounds')
	const configPath = path.join(outputRoot, 'asset-pack.config.json')

	await mkdir(sourceDir, { recursive: true })
	await writeFile(path.join(sourceDir, 'tank.png'), testPng(16, 8))
	await writeConfig(configPath, {
		modRef: 'BackgroundPack',
		assetPrefix: 'T_Background_',
		idBase: 62000,
		source: {
			type: 'png-folder',
			dir: sourceDir,
			weight: '',
		},
		background: {
			type: 'sign-image',
		},
		output: {
			root: outputRoot,
		},
	})

	const config = await loadAssetPackConfig(configPath)
	await generateAssetPack(config, { all: true })
	await validateExistingAssetPack(config)

	const metadataPath = path.join(outputRoot, 'SourceArt/Metadata/T_Background_Tank.json')
	const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
	await writeFile(
		metadataPath,
		`${JSON.stringify({ ...metadata, unreal: { ...metadata.unreal, iconObjectType: 'texture' } }, null, 2)}\n`,
		'utf8',
	)
	await assert.rejects(validateExistingAssetPack(config), /iconObjectType texture does not match manifest/)

	await writeFile(
		metadataPath,
		`${JSON.stringify({ ...metadata, unreal: { ...metadata.unreal, materialInstance: null } }, null, 2)}\n`,
		'utf8',
	)
	await assert.rejects(validateExistingAssetPack(config), /requires materialInstance metadata/)
})

async function writeConfig(configPath: string, config: unknown): Promise<void> {
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

async function writeManifest(manifestPath: string, manifest: unknown): Promise<void> {
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function packageVersion(packagePath: string): Promise<string> {
	const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string }
	return packageJson.version
}

function testPng(width: number, height: number): Buffer {
	return writePngRgba(
		width,
		height,
		Buffer.from(
			Uint8Array.from({ length: width * height * 4 }, (_, byteIndex) => {
				const channel = byteIndex % 4
				const pixel = (byteIndex - channel) / 4
				return channel === 0 ? pixel % 256 : channel === 1 ? Math.floor(pixel / width) % 256 : 255
			}),
		),
	)
}
