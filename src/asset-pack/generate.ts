import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { catalogEntryForRecord, cleanSearchTerms, loadSourceCatalog } from '../adapters/catalog-metadata.js'
import { listAvailableSourceAssets } from '../adapters/source-folders.js'
import { assertFile, readJsonIfExists, toPortablePath } from '../core/fs.js'
import { applyIdLock, assertNoDuplicates, buildIdLock, MAX_LOCAL_ICON_ID, parseIdLock } from '../core/ids.js'
import { normalizeAssetSlug, toDisplayName, toPascalCase } from '../core/naming.js'
import { validateWhiteRgbaPng } from '../core/png.js'
import { normalizeSvgColor, renderPng } from '../core/svg.js'
import type {
	AssetManifestEntry,
	AssetMetadataFile,
	AssetPackConfig,
	AssetPackManifest,
	AssetRecord,
	GeneratedAssetManifestEntry,
	ParsedIdLock,
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
		sourcePath: manifestAssetTextureObjectPath(config, asset),
		sourceType: manifestAssetTextureSource(asset) === 'unreal-existing' ? ('unreal-texture' as const) : ('svg' as const),
		textureAssetName: asset.textureAssetName,
		textureObjectPath: manifestAssetTextureObjectPath(config, asset),
		displayName: asset.displayName,
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
	if (metadata.unreal.expectedTextureObjectPath !== manifestAssetTextureObjectPath(config, asset)) {
		throw new Error(`${asset.metadataPath} expectedTextureObjectPath does not match manifest`)
	}
	if (entry.Texture !== metadata.unreal.expectedTextureObjectPath) {
		throw new Error(`${asset.metadataPath} icon library Texture does not match expectedTextureObjectPath`)
	}

	if (textureSource === 'generated') {
		const pngPath = path.resolve(metadataDir, (asset as GeneratedAssetManifestEntry).texturePath)
		await assertFile(pngPath)
	}

	if (textureSource === 'generated' && options.validatePng) {
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
		writePluginIcon: options.writePluginIcon ?? config.source.type !== 'unreal-texture-list',
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

	const lastId = config.idBase + selected.length - 1
	if (lastId > MAX_LOCAL_ICON_ID) {
		throw new Error(
			`Selected ${selected.length} asset(s) with idBase ${config.idBase} would end at ${lastId}; maximum supported local ID is ${MAX_LOCAL_ICON_ID}`,
		)
	}

	return selected.map((slug, index) => {
		const sourceAsset = availableAssets.get(slug)
		if (!sourceAsset) {
			throw new Error(`Missing selected source asset: ${slug}`)
		}

		const textureAssetName = `${config.assetPrefix}${toPascalCase(slug)}`
		return {
			...sourceAsset,
			id: config.idBase + index,
			textureAssetName,
			textureObjectPath: sourceAsset.textureObjectPath ?? textureObjectPath(config, textureAssetName),
			displayName: sourceAsset.displayName ?? toDisplayName(slug),
		}
	})
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

	if (record.sourceType === 'svg') {
		const sourceSvg = await readFile(record.sourcePath, 'utf8')
		const whiteSvg = normalizeSvgColor(sourceSvg, config.color)
		const svgOutPath = path.join(config.output.svgDir, `${record.textureAssetName}.svg`)
		await writeFile(svgOutPath, `${whiteSvg.trimEnd()}\n`, 'utf8')
		await renderPng(svgOutPath, pngOutPath, config.size)
	} else {
		await copyFile(record.sourcePath, pngOutPath)
	}

	if (options.validatePng) {
		await validateWhiteRgbaPng(pngOutPath, config.size)
	}

	const metadata = buildAssetMetadata(config, record)
	await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
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

export function buildAssetMetadata(config: AssetPackConfig, record: AssetRecord): AssetMetadataFile {
	const sourcePath =
		record.sourceType === 'unreal-texture' ? record.textureObjectPath : toPortablePath(path.relative(config.root, record.sourcePath), path)
	const textureSource = textureSourceForRecord(record)

	return {
		source: {
			slug: record.slug,
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
			iconLibraryAssetPath: iconLibraryAssetPath(config),
			iconLibraryEntry: {
				ID: record.id,
				Texture: record.textureObjectPath,
				ItemDescriptor: null,
				DisplayNameOverride: record.sourceType === 'unreal-texture',
				IconName: record.displayName,
				IconType: config.iconType,
				Hidden: false,
				SearchOnly: false,
				Animated: false,
			},
			textureSettings: config.unreal.textureSettings,
		},
	}
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
		textureAssetName: record.textureAssetName,
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
		textureAssetName: record.textureAssetName,
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
		sourceSlug: catalogResult?.sourceSlug ?? record.slug,
		displayName: record.displayName,
		primaryCategory: catalogEntry?.categories[0] ?? null,
		categories: catalogEntry?.categories ?? [],
		searchTerms: catalogEntry ? cleanSearchTerms(catalogEntry.tags) : [],
		texturePath: record.textureObjectPath,
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

function iconLibraryAssetPath(config: AssetPackConfig): string {
	return `/${config.modRef}/${config.unreal.iconLibraryDir}/${config.unreal.iconLibraryName}.${config.unreal.iconLibraryName}`
}

function textureSourceForRecord(record: AssetRecord): TextureSource {
	return record.sourceType === 'unreal-texture' ? 'unreal-existing' : 'generated'
}

function manifestAssetTextureSource(asset: AssetManifestEntry): TextureSource {
	return assertManifestTextureSource(asset)
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

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0
}
