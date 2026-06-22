import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import type { AssetPackConfig } from '../src/core/types.js'
import {
	assertGameFeatureMount,
	assertImportPreflightPaths,
	assertMountCheckOptions,
	bundledPythonScriptPath,
	bundledTextureScannerScriptPath,
	defaultEditorPath,
	filteredLogTail,
	importAssetPackWithUnreal,
	resolveUnrealTextureScanPaths,
	sameFilesystemPath,
	unrealCommandArgs,
	type ResolvedUnrealImportPaths,
} from '../src/unreal/launch.js'

test('filters the dynamic Unreal import log tail', () => {
	const logText = [
		'noise',
		'[SatAssetTool] started',
		'[My.Mod] mounted',
		'Error: failed',
		'Exception while importing',
		'Traceback (most recent call last)',
		'Fatal error',
		'Python script executed',
	].join('\n')

	assert.deepEqual(filteredLogTail(logText, 'My.Mod', 4), [
		'Exception while importing',
		'Traceback (most recent call last)',
		'Fatal error',
		'Python script executed',
	])
})

test('compares real paths case-insensitively on Windows only', () => {
	assert.equal(sameFilesystemPath('C:\\Mods\\MyMod', 'c:\\mods\\mymod', 'win32'), true)
	assert.equal(sameFilesystemPath('/Mods/MyMod', '/mods/mymod', 'darwin'), false)
})

test('requires dry-run when skipping the mount check', () => {
	assert.throws(() => assertMountCheckOptions({ skipMountCheck: true, dryRun: false }), /--skip-mount-check requires --dry-run/)
	assert.doesNotThrow(() => assertMountCheckOptions({ skipMountCheck: true, dryRun: true }))
	assert.doesNotThrow(() => assertMountCheckOptions({ skipMountCheck: false, dryRun: false }))
})

test('validates game-feature mount realpath and rejects stale direct mounts', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sat-unreal-mount-'))
	const projectRoot = path.join(root, 'StarterProject')
	const modRoot = path.join(root, 'ActualMod')
	const expectedMountPath = path.join(projectRoot, 'Mods', 'GameFeatures', 'MyMod')

	await mkdir(modRoot, { recursive: true })
	await mkdir(path.dirname(expectedMountPath), { recursive: true })
	await symlink(modRoot, expectedMountPath, 'dir')

	await assertGameFeatureMount(minimalConfig({ root: modRoot, modRef: 'MyMod' }), projectRoot)

	await mkdir(path.join(projectRoot, 'Mods', 'MyMod'), { recursive: true })
	await assert.rejects(
		assertGameFeatureMount(minimalConfig({ root: modRoot, modRef: 'MyMod' }), projectRoot),
		/Stale direct mod path exists/,
	)
})

test('rejects stale direct mounts even when they are broken symlinks', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sat-unreal-broken-mount-'))
	const projectRoot = path.join(root, 'StarterProject')
	const modRoot = path.join(root, 'ActualMod')
	const expectedMountPath = path.join(projectRoot, 'Mods', 'GameFeatures', 'MyMod')
	const staleDirectPath = path.join(projectRoot, 'Mods', 'MyMod')

	await mkdir(modRoot, { recursive: true })
	await mkdir(path.dirname(expectedMountPath), { recursive: true })
	await symlink(modRoot, expectedMountPath, 'dir')
	await symlink(path.join(root, 'MissingDirectMod'), staleDirectPath, 'dir')

	await assert.rejects(
		assertGameFeatureMount(minimalConfig({ root: modRoot, modRef: 'MyMod' }), projectRoot),
		/Stale direct mod path exists/,
	)
})

test('preflights required import paths', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sat-unreal-preflight-'))
	const paths: ResolvedUnrealImportPaths = {
		projectRoot: path.join(root, 'StarterProject'),
		engineRoot: path.join(root, 'Engine'),
		editor: path.join(root, 'UnrealEditor-Cmd'),
		project: path.join(root, 'FactoryGame.uproject'),
		script: path.join(root, 'import_asset_pack.py'),
		manifest: path.join(root, 'manifest.json'),
		logPath: path.join(root, 'Saved', 'Logs', 'import.log'),
	}

	await Promise.all([writeFile(paths.editor, ''), writeFile(paths.project, ''), writeFile(paths.script, '')])
	await assert.rejects(assertImportPreflightPaths(paths), /Missing manifest/)

	await writeFile(paths.manifest, '{}')
	await assert.doesNotReject(assertImportPreflightPaths(paths))
})

test('validates the manifest before launching Unreal import', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'sat-unreal-validate-before-import-'))
	const projectRoot = path.join(root, 'StarterProject')
	const engineRoot = path.join(root, 'Engine')
	const editor = defaultEditorPath(engineRoot)
	const script = path.join(root, 'import_asset_pack.py')
	const manifest = path.join(root, 'SourceArt', 'Metadata', 'manifest.json')

	await Promise.all([
		mkdir(path.dirname(editor), { recursive: true }),
		mkdir(projectRoot, { recursive: true }),
		mkdir(path.dirname(manifest), { recursive: true }),
	])
	await Promise.all([
		writeFile(editor, ''),
		writeFile(path.join(projectRoot, 'FactoryGame.uproject'), ''),
		writeFile(script, ''),
		writeFile(
			manifest,
			`${JSON.stringify(
				{
					schemaVersion: 1,
					modRef: 'OtherMod',
					sourceStyle: 'test',
					color: '#ffffff',
					size: 512,
					localIdBase: 50000,
					localIdMax: null,
					iconLibraryAssetPath: '/OtherMod/IconLibraries/OtherMod_IconLibrary.OtherMod_IconLibrary',
					assetCount: 0,
					assets: [],
				},
				null,
				2,
			)}\n`,
		),
	])

	await assert.rejects(
		importAssetPackWithUnreal(minimalConfig({ root, modRef: 'MyMod' }), {
			projectRoot,
			engineRoot,
			scriptPath: script,
			manifestPath: manifest,
			dryRun: true,
			skipMountCheck: true,
		}),
		/manifest validation failed: modRef OtherMod does not match MyMod/,
	)
})

test('uses -abslog for absolute Unreal log paths', () => {
	const paths: ResolvedUnrealImportPaths = {
		projectRoot: '/tmp/project',
		engineRoot: '/tmp/engine',
		editor: '/tmp/engine/Engine/Binaries/Linux/UnrealEditor-Cmd',
		project: '/tmp/project/FactoryGame.uproject',
		script: '/tmp/import_asset_pack.py',
		manifest: '/tmp/manifest.json',
		logPath: '/tmp/Saved/Logs/import.log',
	}
	const args = unrealCommandArgs(paths)

	assert.ok(args.includes('-abslog=/tmp/Saved/Logs/import.log'))
	assert.equal(
		args.some((arg) => arg.startsWith('-log=')),
		false,
	)
})

test('resolves bundled Unreal Python scripts from the commandlet scripts directory', () => {
	assert.equal(bundledPythonScriptPath().endsWith(path.join('unreal', 'scripts', 'import_asset_pack.py')), true)
	assert.equal(bundledTextureScannerScriptPath().endsWith(path.join('unreal', 'scripts', 'scan_texture_candidates.py')), true)
})

test('resolves texture scanner paths without requiring an asset-pack config', () => {
	const root = path.join(os.tmpdir(), 'sat-unreal-scan')
	const paths = resolveUnrealTextureScanPaths({
		projectRoot: path.join(root, 'StarterProject'),
		engineRoot: path.join(root, 'Engine'),
		scriptPath: path.join(root, 'scan_texture_candidates.py'),
		outputPath: path.join(root, 'out', 'candidates.json'),
		logPath: path.join(root, 'logs', 'scan.log'),
	})

	assert.equal(paths.project, path.join(root, 'StarterProject', 'FactoryGame.uproject'))
	assert.equal(paths.editor, path.join(root, 'Engine', 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'))
	assert.equal(paths.script, path.join(root, 'scan_texture_candidates.py'))
	assert.equal(paths.outputPath, path.join(root, 'out', 'candidates.json'))
	assert.equal(paths.logPath, path.join(root, 'logs', 'scan.log'))
})

function minimalConfig(values: { root: string; modRef: string }): AssetPackConfig {
	return {
		configPath: path.join(values.root, 'asset-pack.config.json'),
		configDir: values.root,
		root: values.root,
		modRef: values.modRef,
		name: values.modRef,
		sectionName: values.modRef,
		assetPrefix: `T_${values.modRef}_`,
		idBase: 50000,
		iconType: 'EIconType::ESIT_Monochrome',
		size: 512,
		color: '#ffffff',
		pluginIconAsset: null,
		styleSuffixes: [],
		source: {
			type: 'svg-folder',
			dir: values.root,
			weight: '',
			styleName: 'test',
			catalogPath: null,
			name: 'Test',
			catalog: null,
			catalogVersion: null,
			license: null,
			slugOverrides: {},
			assets: [],
		},
		output: {
			svgDir: path.join(values.root, 'SourceArt', 'SVG'),
			textureDir: path.join(values.root, 'SourceArt', 'Textures'),
			metadataDir: path.join(values.root, 'SourceArt', 'Metadata'),
			assetPackMetadataDir: path.join(values.root, 'Metadata'),
			pluginIconPath: path.join(values.root, 'Resources', 'Icon128.png'),
			manifestFile: `${values.modRef}.manifest.json`,
			idLockFile: `${values.modRef}.id-lock.json`,
			assetPackMetadataFile: `${values.modRef}_AssetMetadata.json`,
		},
		unreal: {
			textureDir: 'Textures',
			iconLibraryDir: 'IconLibraries',
			iconLibraryName: `${values.modRef}_IconLibrary`,
			gameFeatureName: values.modRef,
			textureSettings: {
				MipGenSettings: 'NoMipmaps',
				TextureGroup: 'Project01',
				CompressionSettings: 'Default',
				sRGB: true,
			},
		},
		background: {
			type: 'none',
		},
		generation: {
			tool: 'test',
			version: '0.0.0',
		},
	}
}
