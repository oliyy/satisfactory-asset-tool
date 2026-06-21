import { spawn } from 'node:child_process'
import { access, lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { manifestPath as defaultManifestPath, validateExistingAssetPack } from '../asset-pack/generate.js'
import type { AssetPackConfig } from '../core/types.js'

export interface UnrealScriptOptions {
	projectRoot?: string
	engineRoot?: string
	scriptPath?: string
	logPath?: string
	logTailLines?: number
	noLogTail?: boolean
}

export interface UnrealImportOptions extends UnrealScriptOptions {
	manifestPath?: string
	asset?: string
	limit?: number | null
	dryRun?: boolean
	skipMountCheck?: boolean
}

export interface UnrealTextureScanOptions extends UnrealScriptOptions {
	outputPath?: string
	packagePaths?: string[]
	keywords?: string[]
	limit?: number | null
	previewLimit?: number | null
	includeDimensions?: boolean
	dimensionsLimit?: number | null
}

export interface ResolvedUnrealScriptPaths {
	projectRoot: string
	engineRoot: string
	editor: string
	project: string
	script: string
	logPath: string
}

export interface ResolvedUnrealImportPaths extends ResolvedUnrealScriptPaths {
	manifest: string
}

export interface ResolvedUnrealTextureScanPaths extends ResolvedUnrealScriptPaths {
	outputPath: string
}

export const DEFAULT_LOG_TAIL_LINES = 120

export async function importAssetPackWithUnreal(config: AssetPackConfig, options: UnrealImportOptions): Promise<void> {
	const resolvedPaths = resolveUnrealImportPaths(config, options)

	await mkdir(path.dirname(resolvedPaths.logPath), { recursive: true })
	assertMountCheckOptions(options)
	await assertImportPreflightPaths(resolvedPaths)

	if (!options.skipMountCheck) {
		await assertGameFeatureMount(config, resolvedPaths.projectRoot)
	}

	await validateExistingAssetPack(config, {
		manifestPath: resolvedPaths.manifest,
	})

	const env = {
		...process.env,
		SAT_ASSET_PACK_CONFIG: config.configPath,
		SAT_ASSET_PACK_MANIFEST: resolvedPaths.manifest,
		SAT_ASSET_IMPORT_ASSET: options.asset ?? '',
		SAT_ASSET_IMPORT_LIMIT: options.limit ? String(options.limit) : '',
		SAT_ASSET_DRY_RUN: options.dryRun ? '1' : '',
	}

	const args = unrealCommandArgs(resolvedPaths)

	const result = await run(resolvedPaths.editor, args, env)
	await printUnrealSummary({
		exitCode: result.exitCode,
		logPath: resolvedPaths.logPath,
		modRef: config.modRef,
		logTailLines: options.logTailLines ?? DEFAULT_LOG_TAIL_LINES,
		noLogTail: options.noLogTail ?? false,
	})

	if (result.exitCode !== 0) {
		throw new Error(`${resolvedPaths.editor} exited with code ${result.exitCode}`)
	}
}

export async function scanTextureCandidatesWithUnreal(options: UnrealTextureScanOptions): Promise<void> {
	const resolvedPaths = resolveUnrealTextureScanPaths(options)

	await Promise.all([
		mkdir(path.dirname(resolvedPaths.logPath), { recursive: true }),
		mkdir(path.dirname(resolvedPaths.outputPath), { recursive: true }),
	])
	await assertUnrealScriptPreflightPaths(resolvedPaths)

	const env = {
		...process.env,
		SAT_ASSET_TEXTURE_SCAN_OUTPUT: resolvedPaths.outputPath,
		SAT_ASSET_TEXTURE_SCAN_PACKAGE_PATHS: options.packagePaths?.join(',') ?? '',
		SAT_ASSET_TEXTURE_SCAN_KEYWORDS: options.keywords?.join(',') ?? '',
		SAT_ASSET_TEXTURE_SCAN_LIMIT: options.limit ? String(options.limit) : '',
		SAT_ASSET_TEXTURE_SCAN_PREVIEW_LIMIT: options.previewLimit ? String(options.previewLimit) : '',
		SAT_ASSET_TEXTURE_SCAN_INCLUDE_DIMENSIONS: options.includeDimensions ? '1' : '',
		SAT_ASSET_TEXTURE_SCAN_DIMENSIONS_LIMIT: options.dimensionsLimit ? String(options.dimensionsLimit) : '',
	}

	const result = await run(resolvedPaths.editor, unrealCommandArgs(resolvedPaths), env)
	await printUnrealSummary({
		exitCode: result.exitCode,
		logPath: resolvedPaths.logPath,
		modRef: 'SatAssetTool',
		logTailLines: options.logTailLines ?? DEFAULT_LOG_TAIL_LINES,
		noLogTail: options.noLogTail ?? false,
	})
	console.log(`UNREAL_TEXTURE_SCAN_OUTPUT=${resolvedPaths.outputPath}`)

	if (result.exitCode !== 0) {
		throw new Error(`${resolvedPaths.editor} exited with code ${result.exitCode}`)
	}
}

export function unrealCommandArgs(resolvedPaths: Pick<ResolvedUnrealScriptPaths, 'project' | 'script' | 'logPath'>): string[] {
	return [
		resolvedPaths.project,
		'-run=pythonscript',
		`-script=${resolvedPaths.script}`,
		'-unattended',
		'-nop4',
		'-nosplash',
		'-stdout',
		'-FullStdOutLogOutput',
		`-abslog=${resolvedPaths.logPath}`,
	]
}

export function resolveUnrealImportPaths(config: AssetPackConfig, options: UnrealImportOptions): ResolvedUnrealImportPaths {
	const scriptPaths = resolveUnrealScriptPaths(options, {
		defaultScriptPath: bundledPythonScriptPath(),
		defaultLogPath: path.join(config.root, 'Saved', 'Logs', 'sat-asset-tool-import.log'),
	})
	const manifest = path.resolve(options.manifestPath ?? defaultManifestPath(config))

	return {
		...scriptPaths,
		manifest,
	}
}

export function resolveUnrealTextureScanPaths(options: UnrealTextureScanOptions): ResolvedUnrealTextureScanPaths {
	const scriptPaths = resolveUnrealScriptPaths(options, {
		defaultScriptPath: bundledTextureScannerScriptPath(),
		defaultLogPath: path.join(process.cwd(), 'Saved', 'Logs', 'sat-asset-tool-scan-textures.log'),
	})

	return {
		...scriptPaths,
		outputPath: path.resolve(options.outputPath ?? path.join(process.cwd(), 'unreal-texture-candidates.json')),
	}
}

export function resolveUnrealScriptPaths(
	options: UnrealScriptOptions,
	defaults: { defaultScriptPath: string; defaultLogPath: string },
): ResolvedUnrealScriptPaths {
	const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot())
	const engineRoot = path.resolve(options.engineRoot ?? defaultEngineRoot())

	return {
		projectRoot,
		engineRoot,
		editor: defaultEditorPath(engineRoot),
		project: path.join(projectRoot, 'FactoryGame.uproject'),
		script: path.resolve(options.scriptPath ?? defaults.defaultScriptPath),
		logPath: path.resolve(options.logPath ?? defaults.defaultLogPath),
	}
}

export async function assertImportPreflightPaths(paths: ResolvedUnrealImportPaths): Promise<void> {
	await Promise.all([assertUnrealScriptPreflightPaths(paths), assertPathExists('manifest', paths.manifest)])
}

export async function assertUnrealScriptPreflightPaths(paths: ResolvedUnrealScriptPaths): Promise<void> {
	await Promise.all([
		assertPathExists('Unreal editor binary', paths.editor),
		assertPathExists('Unreal project file', paths.project),
		assertPathExists('Python script', paths.script),
	])
}

export function assertMountCheckOptions(options: Pick<UnrealImportOptions, 'dryRun' | 'skipMountCheck'>): void {
	if (options.skipMountCheck && !options.dryRun) {
		throw new Error('--skip-mount-check requires --dry-run')
	}
}

export async function assertGameFeatureMount(config: AssetPackConfig, projectRoot: string): Promise<void> {
	const expectedMountPath = path.join(projectRoot, 'Mods', 'GameFeatures', config.modRef)
	const staleDirectPath = path.join(projectRoot, 'Mods', config.modRef)

	if (await pathOrSymlinkExists(staleDirectPath)) {
		throw new Error(
			`Stale direct mod path exists: ${staleDirectPath}. ${config.modRef} must be mounted under Mods/GameFeatures/${config.modRef}.`,
		)
	}

	const [actualRoot, expectedRoot] = await Promise.all([
		realpath(config.root).catch(() => fail(`Configured output root does not exist: ${config.root}`)),
		realpath(expectedMountPath).catch(() => fail(`Missing game-feature mount path: ${expectedMountPath}`)),
	])

	if (!sameFilesystemPath(actualRoot, expectedRoot)) {
		throw new Error(`Game-feature mount mismatch: config root ${actualRoot} does not match expected mount ${expectedRoot}`)
	}
}

export function sameFilesystemPath(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
	const normalizedLeft = path.normalize(left)
	const normalizedRight = path.normalize(right)

	return platform === 'win32' ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight
}

export function filteredLogTail(logText: string, modRef: string, lineCount: number): string[] {
	if (lineCount <= 0) {
		return []
	}

	const filter = buildLogFilterPattern(modRef)
	return logText
		.split(/\r?\n/)
		.filter((line) => filter.test(line))
		.slice(-lineCount)
}

export function buildLogFilterPattern(modRef: string): RegExp {
	return new RegExp(
		[
			'\\[SatAssetTool\\]',
			`\\[${escapeRegExp(modRef)}\\]`,
			'Error:',
			'Exception',
			'Traceback',
			'Fatal error',
			'Python script executed',
		].join('|'),
	)
}

async function printUnrealSummary(options: {
	exitCode: number
	logPath: string
	modRef: string
	logTailLines: number
	noLogTail: boolean
}): Promise<void> {
	console.log(`UNREAL_EXIT_CODE=${options.exitCode}`)
	console.log(`UNREAL_LOG=${options.logPath}`)

	if (options.noLogTail) {
		return
	}

	try {
		const logText = await readFile(options.logPath, 'utf8')
		const tail = filteredLogTail(logText, options.modRef, options.logTailLines)
		console.log('UNREAL_LOG_TAIL_BEGIN')
		tail.forEach((line) => {
			console.log(line)
		})
		console.log('UNREAL_LOG_TAIL_END')
	} catch (error) {
		console.log(`UNREAL_LOG_TAIL_UNAVAILABLE=${error instanceof Error ? error.message : String(error)}`)
	}
}

export function defaultProjectRoot(): string {
	if (process.env.PROJECT_ROOT) {
		return process.env.PROJECT_ROOT
	}
	return path.join(os.homedir(), 'Modding', 'SatisfactoryModLoader')
}

export function defaultEngineRoot(): string {
	if (process.env.ENGINE_ROOT) {
		return process.env.ENGINE_ROOT
	}
	if (process.platform === 'win32') {
		return 'C:\\Program Files\\Unreal Engine - CSS'
	}
	return path.join(os.homedir(), 'Modding', 'UnrealEngineCSS')
}

export function defaultEditorPath(engineRoot: string): string {
	if (process.platform === 'win32') {
		return path.join(engineRoot, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe')
	}
	return path.join(engineRoot, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd')
}

export function bundledPythonScriptPath(): string {
	const here = path.dirname(fileURLToPath(import.meta.url))
	const packageRoot = path.resolve(here, '..', '..', '..')
	return path.join(packageRoot, 'unreal', 'scripts', 'import_asset_pack.py')
}

export function bundledTextureScannerScriptPath(): string {
	const here = path.dirname(fileURLToPath(import.meta.url))
	const packageRoot = path.resolve(here, '..', '..', '..')
	return path.join(packageRoot, 'unreal', 'scripts', 'scan_texture_candidates.py')
}

async function assertPathExists(label: string, filePath: string): Promise<void> {
	try {
		await access(filePath)
	} catch {
		throw new Error(`Missing ${label}: ${filePath}`)
	}
}

async function pathOrSymlinkExists(filePath: string): Promise<boolean> {
	try {
		await lstat(filePath)
		return true
	} catch {
		return false
	}
}

function fail(message: string): never {
	throw new Error(message)
}

function escapeRegExp(value: string): string {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ exitCode: number }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env,
			stdio: ['ignore', 'inherit', 'inherit'],
		})

		child.on('error', reject)
		child.on('close', (code) => {
			resolve({ exitCode: code ?? 1 })
		})
	})
}
