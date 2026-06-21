import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { generateAssetPack, validateExistingAssetPack } from '../src/asset-pack/generate.js'
import { loadAssetPackConfig } from '../src/core/config.js'
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
		textureAssetName: 'T_Existing_PortableMiner',
		textureSource: 'unreal-existing',
		textureObjectPath: portableMinerPath,
		metadataPath: 'T_Existing_PortableMiner.json',
		displayName: 'Portable Miner',
	})
	await assert.rejects(readFile(path.join(outputRoot, 'SourceArt/Textures/T_Existing_PortableMiner.png'), 'utf8'), /ENOENT/)
	await assert.rejects(readFile(path.join(outputRoot, 'Resources/Icon128.png'), 'utf8'), /ENOENT/)

	const metadata = JSON.parse(await readFile(path.join(outputRoot, 'SourceArt/Metadata/T_Existing_PortableMiner.json'), 'utf8'))
	assert.equal(metadata.unreal.textureSource, 'unreal-existing')
	assert.equal(metadata.unreal.expectedTextureObjectPath, portableMinerPath)
	assert.equal(metadata.unreal.iconLibraryEntry.Texture, portableMinerPath)
	assert.equal(metadata.unreal.iconLibraryEntry.DisplayNameOverride, true)

	const sidecar = JSON.parse(await readFile(path.join(outputRoot, 'Metadata/ExistingTexturePack_AssetMetadata.json'), 'utf8'))
	assert.equal(sidecar.source.style, '')
	assert.equal(sidecar.assets['61000'].texturePath, portableMinerPath)

	await validateExistingAssetPack(config)

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

async function writeConfig(configPath: string, config: unknown): Promise<void> {
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

async function writeManifest(manifestPath: string, manifest: unknown): Promise<void> {
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
