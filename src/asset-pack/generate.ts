import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { catalogEntryForRecord, cleanSearchTerms, loadSourceCatalog } from '../adapters/catalog-metadata.js'
import { listAvailableSourceAssets } from '../adapters/source-folders.js'
import { assertFile, readJsonIfExists, toPortablePath } from '../core/fs.js'
import { applyIdLock, assertNoDuplicates, buildIdLock, MAX_LOCAL_ICON_ID, parseIdLock } from '../core/ids.js'
import { normalizeAssetSlug, toDisplayName, toPascalCase } from '../core/naming.js'
import { cropCoverPng, readPngDimensions, validateBackgroundPng, validateWhiteRgbaPng } from '../core/png.js'
import { normalizeSvgColor, renderPng } from '../core/svg.js'
import type {
	AssetManifestEntry,
	AssetMetadataFile,
	AssetPackConfig,
	AssetPackManifest,
	AssetRecord,
	GeneratedAssetManifestEntry,
	IconObjectType,
	MaterialInstanceMetadata,
	ParsedIdLock,
	SignImageBackgroundVariant,
	SourceAsset,
	SourceCatalog,
	TextureSource,
	UnrealExistingAssetManifestEntry,
} from '../core/types.js'

export interface AssetPackGenerateOptions {
	assets?: string[]
	all?: boolean
	dryRun?: boolean
	list?: boolean
	validateOnly?: boolean
	validatePng?: boolean
	idLock?: boolean
	writePluginIcon?: boolean
	limit?: number | null
	manifestPath?: string
}

export interface AssetPackGenerateResult {
	records: AssetRecord[]
	manifestPath?: string
	assetPackMetadataPath?: string
}

const DEFAULT_ASSET = 'engine'
const SIGN_BACKGROUND_TEXTURE_SETTINGS = {
	AddressX: 'Wrap',
	AddressY: 'Wrap',
} as const

interface PngDimensions {
	width: number
	height: number
}

export async function generateAssetPack(config: AssetPackConfig, options: AssetPackGenerateOptions = {}): Promise<AssetPackGenerateResult> {
	const resolvedOptions = normalizeOptions(config, options)

	if (resolvedOptions.validateOnly) {
		const records = await validateExistingAssetPack(config, resolvedOptions)
		return { records }
	}

	const availableAssets = await listAvailableSourceAssets(config)
	const selectedRecords = selectAssets(config, resolvedOptions, availableAssets)
	const parsedLock = resolvedOptions.idLock ? await loadParsedIdLock(config) : null

	const records = parsedLock ? applyLockedRecords(config, resolvedOptions, selectedRecords, parsedLock) : selectedRecords
	assertNoDuplicates(records)

	return processRecords(config, records, resolvedOptions)
}

function applyLockedRecords(
	config: AssetPackConfig,
	resolvedOptions: ReturnType<typeof normalizeOptions>,
	records: AssetRecord[],
	parsedLock: ParsedIdLock,
): AssetRecord[] {
	validateSelectedSetAgainstLock(config, resolvedOptions, records, parsedLock)
	return applyIdLock(records, parsedLock)
}

export async function validateExistingAssetPack(config: AssetPackConfig, options: AssetPackGenerateOptions = {}): Promise<AssetRecord[]> {
	const resolvedOptions = normalizeOptions(config, options)
	const manifestFilePath = path.resolve(options.manifestPath ?? manifestPath(config))
	const metadataDir = path.dirname(manifestFilePath)
	const manifest = parseAssetPackManifest(JSON.parse(await readFile(manifestFilePath, 'utf8')) as unknown, manifestFilePath, config)
	const records = manifest.assets.map((asset) => ({
		id: asset.ID,
		slug: asset.slug,
		sourceSlug: asset.sourceSlug ?? asset.slug,
		sourcePath: manifestAssetTextureObjectPath(config, asset),
		sourceType: manifestAssetTextureSource(asset) === 'unreal-existing' ? ('unreal-texture' as const) : ('svg' as const),
		textureAssetName: asset.textureAssetName,
		textureObjectPath: manifestAssetTextureObjectPath(config, asset),
		iconAssetName: asset.iconAssetName ?? asset.textureAssetName,
		iconObjectPath: asset.iconObjectPath ?? manifestAssetTextureObjectPath(config, asset),
		iconObjectType: asset.iconObjectType ?? ('texture' as const),
		displayName: asset.displayName,
		backgroundVariant: null,
	}))

	assertNoDuplicates(records)
	await validateIdLockForManifest(config, manifest, resolvedOptions)

	await Promise.all(manifest.assets.map((asset) => validateManifestAsset(config, manifest, asset, resolvedOptions, metadataDir)))

	await validateAssetPackMetadata(config, records)

	console.log(`Validated ${manifest.assetCount} asset(s) from ${path.relative(process.cwd(), manifestFilePath)}.`)
	return records
}

function parseAssetPackManifest(value: unknown, manifestFilePath: string, config: AssetPackConfig): AssetPackManifest {
	const manifest = assertManifestObject(value, manifestFilePath)
	const assets = assertManifestAssets(manifest, manifestFilePath, config)
	const expectedLocalIdMax = assets.length > 0 ? Math.max(...assets.map((asset) => asset.ID)) : null
	const expectedIconLibraryAssetPath = iconLibraryAssetPath(config)
	const failures = [
		manifest.schemaVersion === 1 ? null : `schemaVersion must be 1`,
		manifest.modRef === config.modRef ? null : `modRef ${String(manifest.modRef)} does not match ${config.modRef}`,
		manifest.sourceStyle === config.source.styleName
			? null
			: `sourceStyle ${String(manifest.sourceStyle)} does not match ${config.source.styleName}`,
		manifest.color === config.color ? null : `color ${String(manifest.color)} does not match ${config.color}`,
		manifest.size === config.size ? null : `size ${String(manifest.size)} does not match ${config.size}`,
		manifest.localIdBase === config.idBase ? null : `localIdBase ${String(manifest.localIdBase)} does not match ${config.idBase}`,
		manifest.localIdMax === expectedLocalIdMax
			? null
			: `localIdMax ${String(manifest.localIdMax)} does not match actual max ${String(expectedLocalIdMax)}`,
		manifest.iconLibraryAssetPath === expectedIconLibraryAssetPath
			? null
			: `iconLibraryAssetPath ${String(manifest.iconLibraryAssetPath)} does not match ${expectedIconLibraryAssetPath}`,
		manifest.assetCount === assets.length
			? null
			: `assetCount ${String(manifest.assetCount)} does not match assets length ${assets.length}`,
	].filter(isString)

	if (failures.length > 0) {
		throw new Error(`${path.relative(process.cwd(), manifestFilePath)} manifest validation failed: ${failures.join('; ')}`)
	}

	return { ...(manifest as AssetPackManifest), assets }
}

function assertManifestObject(value: unknown, manifestFilePath: string): Partial<AssetPackManifest> {
	if (!value || typeof value !== 'object') {
		throw new Error(`${path.relative(process.cwd(), manifestFilePath)} must contain a manifest object`)
	}

	return value as Partial<AssetPackManifest>
}

function assertManifestAssets(
	manifest: Partial<AssetPackManifest>,
	manifestFilePath: string,
	config: AssetPackConfig,
): AssetManifestEntry[] {
	if (!Array.isArray(manifest.assets)) {
		throw new Error(`${path.relative(process.cwd(), manifestFilePath)} manifest assets must be an array`)
	}

	return manifest.assets.map((asset, index) =>
		assertManifestAssetShape(asset, `${path.relative(process.cwd(), manifestFilePath)} assets[${index}]`, config),
	)
}

function assertManifestAssetShape(asset: unknown, label: string, config: AssetPackConfig): AssetManifestEntry {
	if (!asset || typeof asset !== 'object') {
		throw new Error(`${label} must be an object`)
	}

	const candidate = asset as Partial<AssetManifestEntry>
	const id = candidate.ID
	if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > MAX_LOCAL_ICON_ID) {
		throw new Error(`${label}.ID must be an integer from 0 to ${MAX_LOCAL_ICON_ID}`)
	}
	if (!isNormalizedSlug(candidate.slug, config)) {
		throw new Error(`${label}.slug must be a normalized asset slug`)
	}
	if (!isNonEmptyString(candidate.textureAssetName)) {
		throw new Error(`${label}.textureAssetName must be a non-empty string`)
	}
	if (candidate.iconAssetName !== undefined && !isNonEmptyString(candidate.iconAssetName)) {
		throw new Error(`${label}.iconAssetName must be a non-empty string when present`)
	}
	if (candidate.iconObjectPath !== undefined && !isNonEmptyString(candidate.iconObjectPath)) {
		throw new Error(`${label}.iconObjectPath must be a non-empty string when present`)
	}
	const iconObjectType = assertManifestIconObjectType(candidate as AssetManifestEntry)
	if (iconObjectType === 'sign-background-material-instance') {
		if (!isNonEmptyString(candidate.iconAssetName)) {
			throw new Error(`${label}.iconAssetName is required for sign-background-material-instance assets`)
		}
		if (!isNonEmptyString(candidate.iconObjectPath)) {
			throw new Error(`${label}.iconObjectPath is required for sign-background-material-instance assets`)
		}
	}
	if (!isNonEmptyString(candidate.metadataPath)) {
		throw new Error(`${label}.metadataPath must be a non-empty string`)
	}
	if (!isNonEmptyString(candidate.displayName)) {
		throw new Error(`${label}.displayName must be a non-empty string`)
	}

	assertManifestTextureSource(candidate as AssetManifestEntry)
	return candidate as AssetManifestEntry
}

function isNormalizedSlug(value: unknown, config: AssetPackConfig): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		normalizeAssetSlug(value, {
			styleSuffixes: config.styleSuffixes,
		}) === value
	)
}

async function validateManifestAsset(
	config: AssetPackConfig,
	manifest: AssetPackManifest,
	asset: AssetPackManifest['assets'][number],
	options: ReturnType<typeof normalizeOptions>,
	metadataDir: string,
): Promise<void> {
	const metadataPath = path.join(metadataDir, asset.metadataPath)
	const textureSource = assertManifestTextureSource(asset)

	await assertFile(metadataPath)

	const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as AssetMetadataFile
	const entry = metadata.unreal.iconLibraryEntry
	if (entry.ID !== asset.ID) {
		throw new Error(`${asset.metadataPath} ID ${entry.ID} does not match manifest ID ${asset.ID}`)
	}
	if (metadata.unreal.textureAssetName !== asset.textureAssetName) {
		throw new Error(`${asset.metadataPath} texture asset does not match manifest`)
	}
	if (metadata.unreal.textureSource !== textureSource) {
		throw new Error(`${asset.metadataPath} textureSource ${metadata.unreal.textureSource} does not match manifest`)
	}
	const expectedIconObjectType = manifestAssetIconObjectType(asset)
	if (metadata.unreal.iconObjectType !== expectedIconObjectType) {
		throw new Error(`${asset.metadataPath} iconObjectType ${metadata.unreal.iconObjectType} does not match manifest`)
	}
	const expectedIconAssetName = asset.iconAssetName ?? asset.textureAssetName
	if (metadata.unreal.iconAssetName !== expectedIconAssetName) {
		throw new Error(`${asset.metadataPath} iconAssetName does not match manifest`)
	}
	if (metadata.unreal.expectedTextureObjectPath !== manifestAssetTextureObjectPath(config, asset)) {
		throw new Error(`${asset.metadataPath} expectedTextureObjectPath does not match manifest`)
	}
	const expectedIconObjectPath = asset.iconObjectPath ?? metadata.unreal.expectedTextureObjectPath
	if (metadata.unreal.expectedIconObjectPath !== expectedIconObjectPath) {
		throw new Error(`${asset.metadataPath} expectedIconObjectPath does not match manifest`)
	}
	if (entry.Texture !== metadata.unreal.expectedIconObjectPath) {
		throw new Error(`${asset.metadataPath} icon library Texture does not match expectedIconObjectPath`)
	}
	validateIconObjectMetadata(asset, metadata, expectedIconObjectType)

	if (textureSource === 'generated') {
		const pngPath = path.resolve(metadataDir, (asset as GeneratedAssetManifestEntry).texturePath)
		await assertFile(pngPath)
	}

	if (textureSource === 'generated' && options.validatePng && metadata.unreal.iconObjectType === 'sign-background-material-instance') {
		const pngPath = path.resolve(metadataDir, (asset as GeneratedAssetManifestEntry).texturePath)
		await validateBackgroundPng(pngPath)
	}

	if (textureSource === 'generated' && options.validatePng && metadata.unreal.iconObjectType !== 'sign-background-material-instance') {
		const pngPath = path.resolve(metadataDir, (asset as GeneratedAssetManifestEntry).texturePath)
		await validateWhiteRgbaPng(pngPath, manifest.size)
	}
}

export function manifestPath(config: AssetPackConfig): string {
	return path.join(config.output.metadataDir, config.output.manifestFile)
}

export function idLockPath(config: AssetPackConfig): string {
	return path.join(config.output.metadataDir, config.output.idLockFile)
}

export function assetPackMetadataPath(config: AssetPackConfig): string {
	return path.join(config.output.assetPackMetadataDir, config.output.assetPackMetadataFile)
}

function normalizeOptions(
	config: AssetPackConfig,
	options: AssetPackGenerateOptions,
): Required<Omit<AssetPackGenerateOptions, 'limit' | 'manifestPath'>> & { limit: number | null } {
	return {
		assets: (options.assets ?? [])
			.map((asset) =>
				normalizeAssetSlug(asset, {
					styleSuffixes: config.styleSuffixes,
				}),
			)
			.filter(Boolean),
		all: options.all ?? false,
		dryRun: options.dryRun ?? false,
		list: options.list ?? false,
		validateOnly: options.validateOnly ?? false,
		validatePng: options.validatePng ?? true,
		idLock: options.idLock ?? true,
		writePluginIcon: options.writePluginIcon ?? (config.source.type !== 'unreal-texture-list' && config.background.type !== 'sign-image'),
		limit: options.limit ?? null,
	}
}

function selectAssets(
	config: AssetPackConfig,
	options: ReturnType<typeof normalizeOptions>,
	availableAssets: Map<string, SourceAsset>,
): AssetRecord[] {
	const selected = applyLimit(selectedAssetSlugs(config, options, availableAssets), options.limit)

	const missing = selected.filter((slug) => !availableAssets.has(slug))
	if (missing.length > 0) {
		throw new Error(`Missing source file for asset(s): ${missing.join(', ')}`)
	}

	const selectedRecordInputs = selected.flatMap((slug) => {
		const sourceAsset = availableAssets.get(slug)
		if (!sourceAsset) {
			throw new Error(`Missing selected source asset: ${slug}`)
		}
		return recordsForSourceAsset(config, sourceAsset)
	})

	const lastId = config.idBase + selectedRecordInputs.length - 1
	if (lastId > MAX_LOCAL_ICON_ID) {
		throw new Error(
			`Selected ${selectedRecordInputs.length} asset(s) with idBase ${config.idBase} would end at ${lastId}; maximum supported local ID is ${MAX_LOCAL_ICON_ID}`,
		)
	}

	return selectedRecordInputs.map((record, index) => ({ ...record, id: config.idBase + index }))
}

function recordsForSourceAsset(config: AssetPackConfig, sourceAsset: SourceAsset): Omit<AssetRecord, 'id'>[] {
	if (config.background.type !== 'sign-image') {
		const textureAssetName = `${config.assetPrefix}${toPascalCase(sourceAsset.slug)}`
		const texturePath = sourceAsset.textureObjectPath ?? textureObjectPath(config, textureAssetName)
		return [
			{
				...sourceAsset,
				sourceSlug: sourceAsset.slug,
				textureAssetName,
				textureObjectPath: texturePath,
				iconAssetName: textureAssetName,
				iconObjectPath: texturePath,
				iconObjectType: 'texture',
				displayName: sourceAsset.displayName ?? toDisplayName(sourceAsset.slug),
				backgroundVariant: null,
			},
		]
	}

	return config.background.variants.map((variant) => signImageRecordForVariant(config, sourceAsset, variant))
}

function signImageRecordForVariant(
	config: AssetPackConfig,
	sourceAsset: SourceAsset,
	variant: SignImageBackgroundVariant,
): Omit<AssetRecord, 'id'> {
	if (config.background.type !== 'sign-image') {
		throw new Error('signImageRecordForVariant called without sign-image background config')
	}
	if (sourceAsset.sourceType === 'unreal-texture' && variant.mode === 'cover') {
		throw new Error(`Background cover mode requires a local PNG/SVG source: ${sourceAsset.slug}`)
	}

	const slug = variant.suffix ? `${sourceAsset.slug}-${variant.suffix}` : sourceAsset.slug
	const textureAssetName = `${config.assetPrefix}${toPascalCase(slug)}`
	const iconAssetName = `${config.background.materialAssetPrefix}${toPascalCase(slug)}`
	const texturePath = sourceAsset.textureObjectPath ?? textureObjectPath(config, textureAssetName)
	const baseDisplayName = sourceAsset.displayName ?? toDisplayName(sourceAsset.slug)
	const displayName = variant.displayNameSuffix ? `${baseDisplayName} ${variant.displayNameSuffix}` : toDisplayName(slug)

	return {
		...sourceAsset,
		slug,
		sourceSlug: sourceAsset.slug,
		textureAssetName,
		textureObjectPath: texturePath,
		iconAssetName,
		iconObjectPath: materialObjectPath(config, iconAssetName),
		iconObjectType: 'sign-background-material-instance',
		displayName,
		backgroundVariant: variant,
	}
}

function selectedAssetSlugs(
	config: AssetPackConfig,
	options: ReturnType<typeof normalizeOptions>,
	availableAssets: Map<string, SourceAsset>,
): string[] {
	if (options.all) {
		const firstAsset = config.pluginIconAsset ?? (config.source.type === 'unreal-texture-list' ? null : DEFAULT_ASSET)
		const slugs = config.source.type === 'unreal-texture-list' ? [...availableAssets.keys()] : [...availableAssets.keys()].toSorted()
		return prioritizeFirstAsset(slugs, firstAsset)
	}

	if (options.assets.length === 0 && config.source.type === 'unreal-texture-list') {
		return [...availableAssets.keys()]
	}

	return options.assets.length > 0 ? dedupe(options.assets) : [config.pluginIconAsset ?? DEFAULT_ASSET]
}

function prioritizeFirstAsset(slugs: string[], firstAsset: string | null): string[] {
	return firstAsset ? [...slugs.filter((slug) => slug === firstAsset), ...slugs.filter((slug) => slug !== firstAsset)] : slugs
}

function applyLimit(values: string[], limit: number | null): string[] {
	return limit === null ? values : values.slice(0, limit)
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)]
}

async function loadParsedIdLock(config: AssetPackConfig): Promise<ParsedIdLock | null> {
	const lockPath = idLockPath(config)
	const idLock = await readJsonIfExists(lockPath)
	if (!idLock) {
		return null
	}

	return parseIdLock(idLock, lockPath, config, (value) =>
		normalizeAssetSlug(value, {
			styleSuffixes: config.styleSuffixes,
		}),
	)
}

function validateSelectedSetAgainstLock(
	config: AssetPackConfig,
	options: ReturnType<typeof normalizeOptions>,
	records: AssetRecord[],
	lock: ParsedIdLock,
): void {
	const selectedAssets = new Set(records.map((record) => record.slug))
	const missingLockedAssets = lock.assets.filter((asset) => !selectedAssets.has(asset.slug)).map((asset) => asset.slug)

	if (options.all && options.limit === null && missingLockedAssets.length > 0) {
		throw new Error(
			`${path.relative(process.cwd(), idLockPath(config))} contains locked asset(s) missing from the selected full asset set: ${missingLockedAssets.slice(0, 10).join(', ')}${missingLockedAssets.length > 10 ? ', ...' : ''}`,
		)
	}
}

async function processRecords(
	config: AssetPackConfig,
	records: AssetRecord[],
	options: ReturnType<typeof normalizeOptions>,
): Promise<AssetPackGenerateResult> {
	const pluginIconRecord = records.find((record) => record.slug === config.pluginIconAsset) ?? records[0]

	if (options.list || options.dryRun) {
		printRecords(records)
	}

	if (options.dryRun || options.list) {
		if (options.dryRun) {
			console.log(`Dry run: ${records.length} asset(s) selected; no files were written.`)
		}
		return { records }
	}

	if (records.some((record) => record.sourceType !== 'unreal-texture')) {
		await mkdir(config.output.textureDir, { recursive: true })
		await mkdir(config.output.svgDir, { recursive: true })
	}
	await mkdir(config.output.metadataDir, { recursive: true })
	await mkdir(config.output.assetPackMetadataDir, { recursive: true })

	await [...records.entries()].reduce<Promise<void>>(async (previous, [index, record]) => {
		await previous
		await processRecord(config, record, options)

		if ((index + 1) % 100 === 0 || index === records.length - 1) {
			console.log(`Processed ${index + 1}/${records.length}: ${record.textureAssetName}`)
		}
	}, Promise.resolve())

	if (options.writePluginIcon && pluginIconRecord) {
		await writePluginIcon(config, pluginIconRecord)
	}

	const manifest = buildManifest(config, records)
	const manifestFilePath = manifestPath(config)
	await writeFile(manifestFilePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

	const sourceCatalog = await loadSourceCatalog(config)
	const assetPackMetadata = buildAssetPackMetadata(config, records, sourceCatalog)
	const sidecarPath = assetPackMetadataPath(config)
	await writeFile(sidecarPath, `${JSON.stringify(assetPackMetadata, null, 2)}\n`, 'utf8')

	if (options.idLock && options.all && options.limit === null) {
		const idLock = buildIdLock(records, config)
		await writeFile(idLockPath(config), `${JSON.stringify(idLock, null, 2)}\n`, 'utf8')
	}

	console.log(`Wrote ${records.length} asset metadata file(s).`)
	console.log(`Manifest: ${path.relative(process.cwd(), manifestFilePath)}`)
	console.log(`Asset pack metadata: ${path.relative(process.cwd(), sidecarPath)}`)

	return {
		records,
		manifestPath: manifestFilePath,
		assetPackMetadataPath: sidecarPath,
	}
}

async function processRecord(config: AssetPackConfig, record: AssetRecord, options: ReturnType<typeof normalizeOptions>): Promise<void> {
	const pngOutPath = path.join(config.output.textureDir, `${record.textureAssetName}.png`)
	const metadataPath = path.join(config.output.metadataDir, `${record.textureAssetName}.json`)

	if (record.sourceType === 'unreal-texture') {
		const metadata = buildAssetMetadata(config, record)
		await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
		return
	}

	const coverAspect = coverTargetAspect(record)
	if (record.sourceType === 'svg') {
		const sourceSvg = await readFile(record.sourcePath, 'utf8')
		const whiteSvg = normalizeSvgColor(sourceSvg, config.color)
		const svgOutPath = path.join(config.output.svgDir, `${record.textureAssetName}.svg`)
		await writeFile(svgOutPath, `${whiteSvg.trimEnd()}\n`, 'utf8')
		await renderPng(svgOutPath, pngOutPath, config.size)
		if (coverAspect !== null) {
			await cropCoverPng(pngOutPath, pngOutPath, coverAspect)
		}
	} else if (coverAspect !== null) {
		await cropCoverPng(record.sourcePath, pngOutPath, coverAspect)
	} else {
		await copyFile(record.sourcePath, pngOutPath)
	}

	const pngDimensions = await validateOrReadPngDimensions(config, record, pngOutPath, options.validatePng)

	const metadata = buildAssetMetadata(config, record, pngDimensions)
	await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

async function validateOrReadPngDimensions(
	config: AssetPackConfig,
	record: AssetRecord,
	pngPath: string,
	validatePng: boolean,
): Promise<PngDimensions | undefined> {
	if (record.iconObjectType === 'sign-background-material-instance') {
		return validatePng ? validateBackgroundPng(pngPath) : readPngDimensions(pngPath)
	}

	if (validatePng) {
		await validateWhiteRgbaPng(pngPath, config.size)
	}
	return undefined
}

async function writePluginIcon(config: AssetPackConfig, pluginIconRecord: AssetRecord): Promise<void> {
	if (pluginIconRecord.sourceType === 'unreal-texture') {
		throw new Error('Plugin icon generation is not supported for source.type "unreal-texture-list"; use --skip-plugin-icon')
	}

	await mkdir(path.dirname(config.output.pluginIconPath), { recursive: true })

	if (pluginIconRecord.sourceType === 'svg') {
		const sourceSvg = await readFile(pluginIconRecord.sourcePath, 'utf8')
		const whiteSvg = normalizeSvgColor(sourceSvg, config.color)
		const tempSvgPath = path.join(config.output.svgDir, `${pluginIconRecord.textureAssetName}.svg`)
		await writeFile(tempSvgPath, `${whiteSvg.trimEnd()}\n`, 'utf8')
		await renderPng(tempSvgPath, config.output.pluginIconPath, 128)
	} else {
		await copyFile(pluginIconRecord.sourcePath, config.output.pluginIconPath)
	}
}

function printRecords(records: AssetRecord[]): void {
	records.forEach((record) => {
		console.log(
			`${String(record.id).padStart(4, ' ')}  ${record.slug.padEnd(34, ' ')}  ${record.textureAssetName.padEnd(42, ' ')}  ${record.displayName}`,
		)
	})
}

export function buildAssetMetadata(config: AssetPackConfig, record: AssetRecord, pngDimensions?: PngDimensions): AssetMetadataFile {
	const sourcePath =
		record.sourceType === 'unreal-texture' ? record.textureObjectPath : toPortablePath(path.relative(config.root, record.sourcePath), path)
	const textureSource = textureSourceForRecord(record)
	const materialInstance = buildMaterialInstanceMetadata(config, record, pngDimensions)
	const textureSettings =
		record.iconObjectType === 'sign-background-material-instance'
			? { ...config.unreal.textureSettings, ...SIGN_BACKGROUND_TEXTURE_SETTINGS }
			: config.unreal.textureSettings

	return {
		source: {
			slug: record.slug,
			sourceSlug: record.sourceSlug,
			sourcePath,
			sourceStyle: config.source.styleName,
			color: config.color,
			size: config.size,
		},
		unreal: {
			modRef: config.modRef,
			textureSource,
			textureAssetName: record.textureAssetName,
			expectedTextureObjectPath: record.textureObjectPath,
			iconObjectType: record.iconObjectType,
			iconAssetName: record.iconAssetName,
			expectedIconObjectPath: record.iconObjectPath,
			materialInstance,
			iconLibraryAssetPath: iconLibraryAssetPath(config),
			iconLibraryEntry: {
				ID: record.id,
				Texture: record.iconObjectPath,
				ItemDescriptor: null,
				DisplayNameOverride: record.sourceType === 'unreal-texture' || record.iconObjectType === 'sign-background-material-instance',
				IconName: record.displayName,
				IconType: config.iconType,
				Hidden: false,
				SearchOnly: false,
				Animated: false,
			},
			textureSettings,
		},
	}
}

function buildMaterialInstanceMetadata(
	config: AssetPackConfig,
	record: AssetRecord,
	pngDimensions: PngDimensions | undefined,
): MaterialInstanceMetadata | null {
	if (config.background.type !== 'sign-image' || !record.backgroundVariant) {
		return null
	}

	return {
		parentMaterialObjectPath: config.background.parentMaterialObjectPath,
		materialObjectPath: record.iconObjectPath,
		textureParameter: config.background.textureParameter,
		scalarParameters: signBackgroundScalarParameters(record.backgroundVariant, pngDimensions, record.slug),
	}
}

function signBackgroundScalarParameters(
	variant: SignImageBackgroundVariant,
	pngDimensions: PngDimensions | undefined,
	slug: string,
): Record<string, number> {
	const dimensions = backgroundTileDimensions(variant, pngDimensions, slug)
	return {
		FillMode: variant.mode === 'tile' ? 0 : 1,
		FitScale: variant.fitScale,
		TileWidth: dimensions.width,
		TileHeight: dimensions.height,
		RefractionDepthBias: variant.refractionDepthBias,
	}
}

function backgroundTileDimensions(
	variant: SignImageBackgroundVariant,
	pngDimensions: PngDimensions | undefined,
	slug: string,
): PngDimensions {
	if (variant.tileWidth !== null && variant.tileHeight !== null) {
		return { width: variant.tileWidth, height: variant.tileHeight }
	}

	if (variant.mode === 'tile') {
		return { width: variant.tileWidth ?? 400, height: variant.tileHeight ?? 400 }
	}

	const aspect = variant.targetAspect ?? (pngDimensions ? pngDimensions.width / pngDimensions.height : null)
	if (aspect === null) {
		throw new Error(`Background ${slug} requires tileWidth/tileHeight or targetAspect because source dimensions are unavailable`)
	}

	if (variant.tileWidth !== null) {
		return { width: variant.tileWidth, height: variant.tileWidth / aspect }
	}

	const height = variant.tileHeight ?? variant.baseTileHeight
	return { width: height * aspect, height }
}

export function buildManifest(config: AssetPackConfig, records: AssetRecord[]): AssetPackManifest {
	const localIdMax = records.length > 0 ? Math.max(...records.map((record) => record.id)) : null

	return {
		schemaVersion: 1,
		modRef: config.modRef,
		sourceStyle: config.source.styleName,
		color: config.color,
		size: config.size,
		localIdBase: config.idBase,
		localIdMax,
		iconLibraryAssetPath: iconLibraryAssetPath(config),
		assetCount: records.length,
		assets: records.map((record) => buildManifestAsset(config, record)),
	}
}

function buildManifestAsset(config: AssetPackConfig, record: AssetRecord): AssetManifestEntry {
	if (record.sourceType === 'unreal-texture') {
		return buildUnrealExistingManifestAsset(record)
	}

	return buildGeneratedManifestAsset(config, record)
}

function buildGeneratedManifestAsset(config: AssetPackConfig, record: AssetRecord): GeneratedAssetManifestEntry {
	const texturePath = toPortablePath(
		path.relative(config.output.metadataDir, path.join(config.output.textureDir, `${record.textureAssetName}.png`)),
		path,
	)

	return {
		ID: record.id,
		slug: record.slug,
		sourceSlug: record.sourceSlug,
		textureAssetName: record.textureAssetName,
		iconAssetName: record.iconAssetName,
		iconObjectPath: record.iconObjectPath,
		iconObjectType: record.iconObjectType,
		textureSource: 'generated',
		texturePath,
		metadataPath: `${record.textureAssetName}.json`,
		displayName: record.displayName,
	}
}

function buildUnrealExistingManifestAsset(record: AssetRecord): UnrealExistingAssetManifestEntry {
	return {
		ID: record.id,
		slug: record.slug,
		sourceSlug: record.sourceSlug,
		textureAssetName: record.textureAssetName,
		iconAssetName: record.iconAssetName,
		iconObjectPath: record.iconObjectPath,
		iconObjectType: record.iconObjectType,
		textureSource: 'unreal-existing',
		textureObjectPath: record.textureObjectPath,
		metadataPath: `${record.textureAssetName}.json`,
		displayName: record.displayName,
	}
}

export function buildAssetPackMetadata(config: AssetPackConfig, records: AssetRecord[], sourceCatalog: SourceCatalog | null): unknown {
	const minId = records.length > 0 ? Math.min(...records.map((record) => record.id)) : null
	const maxId = records.length > 0 ? Math.max(...records.map((record) => record.id)) : null
	const assets = Object.fromEntries(
		records
			.toSorted((left, right) => left.id - right.id || left.slug.localeCompare(right.slug))
			.map((record) => [String(record.id), buildAssetPackMetadataEntry(config, record, sourceCatalog)]),
	)

	return {
		schema: 'satisfactory-asset-pack-metadata',
		schemaVersion: 1,
		modRef: config.modRef,
		name: config.name,
		sectionName: config.sectionName,
		assetPath: iconLibraryAssetPath(config),
		idRange: {
			min: minId,
			max: maxId,
		},
		source: {
			name: config.source.name,
			catalog: sourceCatalog?.catalog ?? config.source.catalog,
			catalogVersion: sourceCatalog?.catalogVersion ?? config.source.catalogVersion,
			style: config.source.weight,
			license: config.source.license,
		},
		generation: {
			tool: config.generation.tool,
			version: config.generation.version,
		},
		assets,
	}
}

function buildAssetPackMetadataEntry(config: AssetPackConfig, record: AssetRecord, sourceCatalog: SourceCatalog | null): unknown {
	const catalogResult = sourceCatalog ? catalogEntryForRecord(record, sourceCatalog.byName, config.source.slugOverrides) : null
	const catalogEntry = catalogResult?.catalogEntry

	return {
		slug: record.slug,
		sourceSlug: catalogResult?.sourceSlug ?? record.sourceSlug,
		displayName: record.displayName,
		primaryCategory: catalogEntry?.categories[0] ?? null,
		categories: catalogEntry?.categories ?? [],
		searchTerms: catalogEntry ? cleanSearchTerms(catalogEntry.tags) : [],
		texturePath: record.iconObjectPath,
		sourceTexturePath: record.textureObjectPath,
		iconObjectPath: record.iconObjectPath,
		iconObjectType: record.iconObjectType,
	}
}

async function validateAssetPackMetadata(config: AssetPackConfig, records: AssetRecord[]): Promise<void> {
	const sidecarPath = assetPackMetadataPath(config)
	const actual = JSON.parse(await readFile(sidecarPath, 'utf8')) as unknown
	const sourceCatalog = await loadSourceCatalog(config)
	const expected = buildAssetPackMetadata(config, records, sourceCatalog)

	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${path.relative(process.cwd(), sidecarPath)} does not match generated metadata`)
	}

	console.log(`Asset pack metadata verified from ${path.relative(process.cwd(), sidecarPath)}.`)
}

async function validateIdLockForManifest(
	config: AssetPackConfig,
	manifest: AssetPackManifest,
	options: ReturnType<typeof normalizeOptions>,
): Promise<void> {
	if (!options.idLock) {
		return
	}

	const lockPath = idLockPath(config)
	const idLockRaw = await readJsonIfExists(lockPath)
	if (!idLockRaw) {
		throw new Error(`Missing ID lock file: ${lockPath}`)
	}

	const lock = parseIdLock(idLockRaw, lockPath, config, (value) =>
		normalizeAssetSlug(value, {
			styleSuffixes: config.styleSuffixes,
		}),
	)
	const manifestBySlug = new Map(manifest.assets.map((asset) => [asset.slug, asset]))
	const missing = lock.assets.filter((lockedAsset) => !manifestBySlug.has(lockedAsset.slug)).map((lockedAsset) => lockedAsset.slug)
	const changed = lock.assets.flatMap((lockedAsset) => changedLockedAssetMessage(lockedAsset, manifestBySlug))

	const lowNewIds = manifest.assets
		.filter((asset) => !lock.bySlug.has(asset.slug) && asset.ID <= lock.maxAssignedId)
		.map((asset) => `${asset.slug}: ${asset.ID}`)

	const failures = [
		failureSummary('missing locked asset(s)', missing),
		failureSummary('changed locked ID(s)', changed),
		failureSummary('new asset(s) reuse locked ID range', lowNewIds),
	].filter(isString)

	if (failures.length > 0) {
		throw new Error(`${path.relative(process.cwd(), lockPath)} validation failed: ${failures.join('; ')}`)
	}

	console.log(`ID lock verified ${lock.assets.length} asset(s) from ${path.relative(process.cwd(), lockPath)}.`)
}

function changedLockedAssetMessage(
	lockedAsset: ParsedIdLock['assets'][number],
	manifestBySlug: Map<string, AssetPackManifest['assets'][number]>,
): string[] {
	const manifestAsset = manifestBySlug.get(lockedAsset.slug)

	return manifestAsset && manifestAsset.ID !== lockedAsset.ID
		? [`${lockedAsset.slug}: locked ${lockedAsset.ID}, manifest ${manifestAsset.ID}`]
		: []
}

function failureSummary(label: string, values: string[]): string | null {
	return values.length > 0 ? `${label}: ${values.slice(0, 10).join(', ')}${values.length > 10 ? ', ...' : ''}` : null
}

function isString(value: string | null): value is string {
	return typeof value === 'string'
}

function textureObjectPath(config: AssetPackConfig, textureAssetName: string): string {
	return `/${config.modRef}/${config.unreal.textureDir}/${textureAssetName}.${textureAssetName}`
}

function materialObjectPath(config: AssetPackConfig, materialAssetName: string): string {
	const materialDir = config.background.type === 'sign-image' ? config.background.materialDir : config.unreal.textureDir
	return `/${config.modRef}/${materialDir}/${materialAssetName}.${materialAssetName}`
}

function iconLibraryAssetPath(config: AssetPackConfig): string {
	return `/${config.modRef}/${config.unreal.iconLibraryDir}/${config.unreal.iconLibraryName}.${config.unreal.iconLibraryName}`
}

function coverTargetAspect(record: AssetRecord): number | null {
	const variant = record.backgroundVariant
	if (!variant || variant.mode !== 'cover') {
		return null
	}
	if (variant.targetAspect !== null) {
		return variant.targetAspect
	}
	if (variant.tileWidth !== null && variant.tileHeight !== null) {
		return variant.tileWidth / variant.tileHeight
	}
	throw new Error(`Background cover mode requires targetAspect or tileWidth/tileHeight: ${record.slug}`)
}

function textureSourceForRecord(record: AssetRecord): TextureSource {
	return record.sourceType === 'unreal-texture' ? 'unreal-existing' : 'generated'
}

function validateIconObjectMetadata(
	asset: AssetPackManifest['assets'][number],
	metadata: AssetMetadataFile,
	expectedIconObjectType: IconObjectType,
): void {
	if (expectedIconObjectType === 'sign-background-material-instance') {
		validateMaterialInstanceMetadata(asset, metadata)
		return
	}

	if (metadata.unreal.materialInstance !== null) {
		throw new Error(`${asset.metadataPath} materialInstance must be null for texture icon assets`)
	}
	if (metadata.unreal.expectedIconObjectPath !== metadata.unreal.expectedTextureObjectPath) {
		throw new Error(`${asset.metadataPath} texture icon assets must use the texture object as expectedIconObjectPath`)
	}
}

function validateMaterialInstanceMetadata(asset: AssetPackManifest['assets'][number], metadata: AssetMetadataFile): void {
	const materialInstance = metadata.unreal.materialInstance
	if (!materialInstance || typeof materialInstance !== 'object') {
		throw new Error(`${asset.metadataPath} requires materialInstance metadata for sign-background-material-instance assets`)
	}
	if (!isNonEmptyString(materialInstance.parentMaterialObjectPath)) {
		throw new Error(`${asset.metadataPath} materialInstance.parentMaterialObjectPath must be a non-empty string`)
	}
	if (materialInstance.materialObjectPath !== metadata.unreal.expectedIconObjectPath) {
		throw new Error(`${asset.metadataPath} materialInstance.materialObjectPath does not match expectedIconObjectPath`)
	}
	if (!isNonEmptyString(materialInstance.textureParameter)) {
		throw new Error(`${asset.metadataPath} materialInstance.textureParameter must be a non-empty string`)
	}
	if (!materialInstance.scalarParameters || typeof materialInstance.scalarParameters !== 'object') {
		throw new Error(`${asset.metadataPath} materialInstance.scalarParameters must be an object`)
	}
	if (metadata.unreal.iconLibraryEntry.IconType !== 'EIconType::ESIT_Material') {
		throw new Error(`${asset.metadataPath} sign-background material instances require IconType Material`)
	}
}

function manifestAssetTextureSource(asset: AssetManifestEntry): TextureSource {
	return assertManifestTextureSource(asset)
}

function manifestAssetIconObjectType(asset: AssetManifestEntry): IconObjectType {
	return assertManifestIconObjectType(asset)
}

function manifestAssetTextureObjectPath(config: AssetPackConfig, asset: AssetManifestEntry): string {
	const textureSource = assertManifestTextureSource(asset)
	return textureSource === 'unreal-existing'
		? (asset as UnrealExistingAssetManifestEntry).textureObjectPath
		: textureObjectPath(config, asset.textureAssetName)
}

function assertManifestTextureSource(asset: AssetManifestEntry): TextureSource {
	const textureSource = (asset as Partial<AssetManifestEntry>).textureSource
	const label = `manifest asset ${asset.slug || asset.textureAssetName || '<unknown>'}`

	if (textureSource === 'generated') {
		const texturePath = (asset as Partial<GeneratedAssetManifestEntry>).texturePath
		if (!isNonEmptyString(texturePath)) {
			throw new Error(`${label} with textureSource "generated" must define texturePath`)
		}
		return textureSource
	}

	if (textureSource === 'unreal-existing') {
		const textureObjectPath = (asset as Partial<UnrealExistingAssetManifestEntry>).textureObjectPath
		if (!isNonEmptyString(textureObjectPath)) {
			throw new Error(`${label} with textureSource "unreal-existing" must define textureObjectPath`)
		}
		return textureSource
	}

	throw new Error(`${label} has unsupported textureSource: ${String(textureSource)}`)
}

function assertManifestIconObjectType(asset: AssetManifestEntry): IconObjectType {
	const iconObjectType = (asset as Partial<AssetManifestEntry>).iconObjectType
	const label = `manifest asset ${asset.slug || asset.textureAssetName || '<unknown>'}`

	if (iconObjectType === undefined) {
		return 'texture'
	}
	if (iconObjectType === 'texture' || iconObjectType === 'sign-background-material-instance') {
		return iconObjectType
	}

	throw new Error(`${label} has unsupported iconObjectType: ${String(iconObjectType)}`)
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0
}
