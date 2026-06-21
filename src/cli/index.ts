#!/usr/bin/env node
import process from 'node:process'

import { generateAssetPack, type AssetPackGenerateOptions } from '../asset-pack/generate.js'
import { applyAssetPackOverrides, loadAssetPackConfig } from '../core/config.js'
import { importAssetPackWithUnreal, scanTextureCandidatesWithUnreal } from '../unreal/launch.js'

interface ParsedArgs {
	command: string | null
	options: Record<string, string | boolean | string[]>
	positionals: string[]
}

async function main(): Promise<void> {
	const parsed = parseArgs(process.argv.slice(2))
	const command = parsed.command

	if (!command || command === 'help' || parsed.options.help || parsed.options.h) {
		printHelp()
		return
	}

	if (command === 'generate') {
		await runGenerate(parsed)
		return
	}

	if (command === 'validate') {
		await runValidate(parsed)
		return
	}

	if (command === 'list') {
		await runList(parsed)
		return
	}

	if (command === 'import') {
		await runUnrealImport(parsed)
		return
	}

	if (command === 'scan-textures') {
		await runTextureScan(parsed)
		return
	}

	throw new Error(`Unknown command: ${command}`)
}

async function runGenerate(parsed: ParsedArgs): Promise<void> {
	const config = await loadConfigWithOverrides(parsed)
	const assets = stringArrayOption(parsed, 'asset')
	const options: AssetPackGenerateOptions = {
		all: assets.length === 0,
		dryRun: booleanOption(parsed, 'dry-run'),
		list: false,
		validateOnly: false,
		validatePng: !booleanOption(parsed, 'skip-png-validation'),
		idLock: !booleanOption(parsed, 'skip-id-lock'),
		writePluginIcon: booleanOption(parsed, 'skip-plugin-icon') ? false : undefined,
		assets,
		limit: optionalIntegerOption(parsed, 'limit'),
	}

	await generateAssetPack(config, options)
}

async function runValidate(parsed: ParsedArgs): Promise<void> {
	const config = await loadConfigWithOverrides(parsed)
	await generateAssetPack(config, {
		validateOnly: true,
		validatePng: !booleanOption(parsed, 'skip-png-validation'),
		idLock: !booleanOption(parsed, 'skip-id-lock'),
	})
}

async function runList(parsed: ParsedArgs): Promise<void> {
	const config = await loadConfigWithOverrides(parsed)
	const assets = stringArrayOption(parsed, 'asset')
	await generateAssetPack(config, {
		all: assets.length === 0,
		list: true,
		assets,
		limit: optionalIntegerOption(parsed, 'limit'),
		idLock: !booleanOption(parsed, 'skip-id-lock'),
	})
}

async function runUnrealImport(parsed: ParsedArgs): Promise<void> {
	const config = await loadConfigWithOverrides(parsed)
	await importAssetPackWithUnreal(config, {
		projectRoot: stringOption(parsed, 'project-root'),
		engineRoot: stringOption(parsed, 'engine-root'),
		scriptPath: stringOption(parsed, 'script'),
		manifestPath: stringOption(parsed, 'manifest'),
		asset: stringOption(parsed, 'asset'),
		limit: optionalIntegerOption(parsed, 'limit'),
		dryRun: booleanOption(parsed, 'dry-run'),
		logPath: stringOption(parsed, 'log'),
		skipMountCheck: booleanOption(parsed, 'skip-mount-check'),
		logTailLines: optionalIntegerOption(parsed, 'log-tail-lines') ?? undefined,
		noLogTail: booleanOption(parsed, 'no-log-tail'),
	})
}

async function runTextureScan(parsed: ParsedArgs): Promise<void> {
	await scanTextureCandidatesWithUnreal({
		projectRoot: stringOption(parsed, 'project-root'),
		engineRoot: stringOption(parsed, 'engine-root'),
		scriptPath: stringOption(parsed, 'script'),
		outputPath: stringOption(parsed, 'output'),
		packagePaths: stringArrayOption(parsed, 'package-path'),
		keywords: stringArrayOption(parsed, 'keyword'),
		limit: optionalIntegerOption(parsed, 'limit'),
		previewLimit: optionalIntegerOption(parsed, 'preview-limit'),
		includeDimensions: booleanOption(parsed, 'include-dimensions'),
		dimensionsLimit: optionalIntegerOption(parsed, 'dimensions-limit'),
		logPath: stringOption(parsed, 'log'),
		logTailLines: optionalIntegerOption(parsed, 'log-tail-lines') ?? undefined,
		noLogTail: booleanOption(parsed, 'no-log-tail'),
	})
}

async function loadConfigWithOverrides(parsed: ParsedArgs) {
	const configPath = stringOption(parsed, 'config') ?? 'asset-pack.config.json'
	const config = await loadAssetPackConfig(configPath)

	return applyAssetPackOverrides(config, {
		sourceDir: stringOption(parsed, 'source-dir'),
		sourceWeight: stringOption(parsed, 'source-weight'),
		size: optionalIntegerOption(parsed, 'size') ?? undefined,
		color: stringOption(parsed, 'color'),
		iconType: stringOption(parsed, 'type'),
		modRef: stringOption(parsed, 'mod-ref'),
		pluginIconAsset: stringOption(parsed, 'plugin-icon-asset'),
		idBase: optionalLocalAssetIdOption(parsed, 'id-base') ?? undefined,
	})
}

function parseArgs(argv: string[]): ParsedArgs {
	let command: string | null = null
	const positionals: string[] = []
	const options: Record<string, string | boolean | string[]> = {}

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]

		if (!arg.startsWith('-') && !command) {
			command = arg
			continue
		}

		if (!arg.startsWith('-')) {
			positionals.push(arg)
			continue
		}

		const trimmed = arg.replace(/^-+/, '')
		const equalsIndex = trimmed.indexOf('=')
		const rawKey = equalsIndex === -1 ? trimmed : trimmed.slice(0, equalsIndex)
		const key = normalizeOptionName(rawKey)
		const inlineValue = equalsIndex === -1 ? null : trimmed.slice(equalsIndex + 1)

		if (isBooleanFlag(key)) {
			options[key] = true
			continue
		}

		const value = inlineValue ?? argv[index + 1]
		if (value === undefined || value.startsWith('--')) {
			throw new Error(`Missing value for --${key}`)
		}
		if (inlineValue === null) {
			index += 1
		}

		if (isArrayOption(key)) {
			const existing = options[key]
			const values = value
				.split(',')
				.map((part) => part.trim())
				.filter(Boolean)
			options[key] = Array.isArray(existing) ? [...existing, ...values] : values
		} else {
			options[key] = value
		}
	}

	return { command, options, positionals }
}

function isArrayOption(key: string): boolean {
	return new Set(['asset', 'package-path', 'keyword']).has(key)
}

function isBooleanFlag(key: string): boolean {
	return new Set([
		'dry-run',
		'include-dimensions',
		'skip-png-validation',
		'skip-id-lock',
		'skip-plugin-icon',
		'skip-mount-check',
		'no-log-tail',
		'help',
		'h',
	]).has(key)
}

function normalizeOptionName(key: string): string {
	const aliases: Record<string, string> = {
		c: 'config',
		a: 'asset',
		n: 'limit',
	}
	return aliases[key] ?? key
}

function stringOption(parsed: ParsedArgs, key: string): string | undefined {
	const value = parsed.options[key]
	if (typeof value === 'string') {
		return value
	}
	return undefined
}

function stringArrayOption(parsed: ParsedArgs, key: string): string[] {
	const value = parsed.options[key]
	if (Array.isArray(value)) {
		return value
	}
	if (typeof value === 'string') {
		return [value]
	}
	return []
}

function booleanOption(parsed: ParsedArgs, key: string): boolean {
	return parsed.options[key] === true
}

function optionalIntegerOption(parsed: ParsedArgs, key: string): number | null {
	const value = stringOption(parsed, key)
	if (value === undefined) {
		return null
	}
	const parsedValue = strictIntegerOption(value, key)
	if (parsedValue <= 0) {
		throw new Error(`--${key} must be a positive integer`)
	}
	return parsedValue
}

function optionalLocalAssetIdOption(parsed: ParsedArgs, key: string): number | null {
	const value = stringOption(parsed, key)
	if (value === undefined) {
		return null
	}
	const parsedValue = strictIntegerOption(value, key)
	if (parsedValue < 0) {
		throw new Error(`--${key} must be a non-negative integer`)
	}
	return parsedValue
}

function strictIntegerOption(value: string, key: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`--${key} must be an integer`)
	}

	const parsedValue = Number(value)
	if (!Number.isSafeInteger(parsedValue)) {
		throw new Error(`--${key} must be a safe integer`)
	}

	return parsedValue
}

function printHelp(): void {
	console.log(`Usage:
  sat generate
  sat validate
  sat list --asset engine
  sat import --project-root C:\\Modding\\SatisfactoryModLoader --engine-root "C:\\Program Files\\Unreal Engine - CSS"
  sat scan-textures --output unreal-texture-candidates.json

Commands:
  generate    Generate the full asset pack, or a subset with --asset.
  validate    Validate generated output against the manifest and ID lock.
  list        Preview selected assets without writing files.
  import      Launch Unreal and import the generated manifest.
  scan-textures
              Launch Unreal and export candidate existing Texture2D assets.

Common options:
  --config PATH, -c PATH        Defaults to asset-pack.config.json
  --asset NAME[,NAME], -a NAME
  --limit N, -n N
  --dry-run

Generation options:
  --source-dir PATH
  --source-weight NAME
  --size N
  --color #ffffff
  --type Monochrome
  --mod-ref NAME
  --plugin-icon-asset NAME
  --id-base N
  --skip-png-validation
  --skip-id-lock
  --skip-plugin-icon

Import options:
  --project-root PATH
  --engine-root PATH
  --manifest PATH
  --script PATH
  --log PATH
  --skip-mount-check
  --log-tail-lines 120
  --no-log-tail

Texture scan options:
  --output PATH                Defaults to unreal-texture-candidates.json
  --package-path PATH          Defaults to /Game/FactoryGame; repeatable or comma-separated
  --keyword NAME               Defaults to icon,ui,desc; repeatable or comma-separated
  --preview-limit N            Number of assets in assetPackConfigSnippet
  --include-dimensions         Load matched textures and include width/height
  --dimensions-limit N         Cap dimension loading when --include-dimensions is set
`)
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
})
