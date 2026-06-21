import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { MAX_LOCAL_ICON_ID } from './ids.js'
import { normalizeAssetSlug } from './naming.js'
import type {
	AssetPackConfig,
	AssetPackOverrides,
	RawAssetPackConfig,
	RawSourceConfig,
	SourceType,
	UnrealTextureSourceAsset,
} from './types.js'

const DEFAULT_STYLE_SUFFIXES = ['bold', 'duotone', 'fill', 'light', 'regular', 'thin']
const VALID_ICON_TYPE_NAMES = ['Building', 'Part', 'Equipment', 'Monochrome', 'Material', 'Custom', 'MapStamp', 'None']
const ICON_TYPES = new Map<string, string>([
	['building', 'EIconType::ESIT_Building'],
	['part', 'EIconType::ESIT_Part'],
	['equipment', 'EIconType::ESIT_Equipment'],
	['monochrome', 'EIconType::ESIT_Monochrome'],
	['material', 'EIconType::ESIT_Material'],
	['custom', 'EIconType::ESIT_Custom'],
	['mapstamp', 'EIconType::ESIT_MapStamp'],
	['map-stamp', 'EIconType::ESIT_MapStamp'],
	['none', 'EIconType::ESIT_None'],
])

export async function loadAssetPackConfig(configPath: string): Promise<AssetPackConfig> {
	const absoluteConfigPath = path.resolve(configPath)
	const configDir = path.dirname(absoluteConfigPath)
	const rawConfig = JSON.parse(await readFile(absoluteConfigPath, 'utf8')) as RawAssetPackConfig

	const modRef = readModRef(rawConfig, configPath)
	const root = resolveFrom(configDir, rawConfig.output?.root ?? '.')
	const source: RawSourceConfig = rawConfig.source ?? {}
	const sourceType = normalizeSourceType(source.type ?? 'svg-folder', configPath)
	const sourceWeight = source.weight ?? rawConfig.sourceWeight ?? (sourceType === 'unreal-texture-list' ? '' : 'fill')
	const sourceStyle = source.styleName ?? (sourceWeight || sourceType)
	const output = rawConfig.output ?? {}
	const unreal = rawConfig.unreal ?? {}
	const generation = rawConfig.generation ?? {}
	const idBase = normalizeIdBase(rawConfig.idBase ?? 50000, configPath)
	const size = normalizePositiveInteger(rawConfig.size ?? 512, `${configPath} size`)

	return {
		configPath: absoluteConfigPath,
		configDir,
		root,
		modRef,
		name: rawConfig.name ?? modRef,
		sectionName: rawConfig.sectionName ?? modRef,
		assetPrefix: rawConfig.assetPrefix ?? `T_${modRef}_`,
		idBase,
		iconType: normalizeIconType(rawConfig.iconType ?? 'Monochrome', configPath),
		size,
		color: rawConfig.color ?? '#ffffff',
		pluginIconAsset: rawConfig.pluginIconAsset ?? null,
		styleSuffixes: rawConfig.styleSuffixes ?? DEFAULT_STYLE_SUFFIXES,
		source: {
			...source,
			type: sourceType,
			dir: resolveFrom(root, source.dir ?? 'Source'),
			weight: sourceWeight,
			styleName: sourceStyle,
			catalogPath: source.catalogPath ? resolveFrom(root, source.catalogPath) : null,
			name: source.name ?? sourceStyle,
			catalog: source.catalog ?? null,
			catalogVersion: source.catalogVersion ?? null,
			license: source.license ?? null,
			slugOverrides: source.slugOverrides ?? {},
			assets: normalizeUnrealTextureSourceAssets(sourceType, source.assets ?? [], configPath),
		},
		output: {
			svgDir: resolveFrom(root, output.svgDir ?? 'SourceArt/SVG'),
			textureDir: resolveFrom(root, output.textureDir ?? 'SourceArt/Textures'),
			metadataDir: resolveFrom(root, output.metadataDir ?? 'SourceArt/Metadata'),
			assetPackMetadataDir: resolveFrom(root, output.assetPackMetadataDir ?? 'Metadata'),
			pluginIconPath: resolveFrom(root, output.pluginIconPath ?? 'Resources/Icon128.png'),
			manifestFile: output.manifestFile ?? `${modRef}.manifest.json`,
			idLockFile: output.idLockFile ?? `${modRef}.id-lock.json`,
			assetPackMetadataFile: output.assetPackMetadataFile ?? `${modRef}_AssetMetadata.json`,
		},
		unreal: {
			textureDir: unreal.textureDir ?? 'Textures',
			iconLibraryDir: unreal.iconLibraryDir ?? 'IconLibraries',
			iconLibraryName: unreal.iconLibraryName ?? `${modRef}_IconLibrary`,
			gameFeatureName: unreal.gameFeatureName ?? modRef,
			textureSettings: {
				MipGenSettings: 'NoMipmaps',
				TextureGroup: 'Project01',
				CompressionSettings: 'Default',
				sRGB: true,
				...(unreal.textureSettings ?? {}),
			},
		},
		generation: {
			tool: generation.tool ?? 'satisfactory-asset-tool',
			version: generation.version ?? '0.1.0',
		},
	}
}

function normalizeSourceType(value: string, source: string): SourceType {
	return value === 'svg-folder' || value === 'png-folder' || value === 'unreal-texture-list'
		? value
		: fail(`${source} source.type must be one of: svg-folder, png-folder, unreal-texture-list`)
}

function normalizeUnrealTextureSourceAssets(
	sourceType: SourceType,
	assets: RawSourceConfig['assets'],
	configPath: string,
): UnrealTextureSourceAsset[] {
	if (sourceType !== 'unreal-texture-list') {
		return []
	}

	if (!Array.isArray(assets) || assets.length === 0) {
		return fail(`${configPath} source.assets must contain at least one asset for source.type "unreal-texture-list"`)
	}

	return assets.map((asset, index) => normalizeUnrealTextureSourceAsset(asset, `${configPath} source.assets[${index}]`))
}

function normalizeUnrealTextureSourceAsset(
	asset: NonNullable<RawSourceConfig['assets']>[number],
	source: string,
): UnrealTextureSourceAsset {
	const slug = assertNormalizedSlug(asset.slug, source)
	const displayName = typeof asset.displayName === 'string' && asset.displayName.trim() ? asset.displayName.trim() : null

	return {
		slug,
		displayName,
		textureObjectPath: normalizeTextureObjectPath(asset.textureObjectPath, source),
	}
}

function assertNormalizedSlug(value: unknown, source: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		return fail(`${source}.slug must be a non-empty normalized asset slug`)
	}

	const slug = value.trim()
	if (normalizeAssetSlug(slug, { styleSuffixes: [] }) !== slug) {
		return fail(`${source}.slug must already be normalized, for example "portable-miner"`)
	}

	return slug
}

function normalizeTextureObjectPath(value: unknown, source: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		return fail(`${source}.textureObjectPath must be a non-empty Unreal object path`)
	}

	const objectPath = value.trim()
	const dotIndex = objectPath.lastIndexOf('.')
	const slashIndex = objectPath.lastIndexOf('/')
	if (!objectPath.startsWith('/') || dotIndex <= slashIndex + 1 || dotIndex === objectPath.length - 1 || /\s/.test(objectPath)) {
		return fail(`${source}.textureObjectPath must look like /Game/Path/Texture.Texture`)
	}

	return objectPath
}

function resolveFrom(base: string, value: string): string {
	return path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value)
}

function readModRef(rawConfig: RawAssetPackConfig, configPath: string): string {
	return rawConfig.modRef && typeof rawConfig.modRef === 'string' ? rawConfig.modRef : fail(`${configPath} must define modRef`)
}

export function applyAssetPackOverrides(config: AssetPackConfig, overrides: AssetPackOverrides): AssetPackConfig {
	const modRef = overrides.modRef ?? config.modRef
	const sourceWeightOverrides = overrides.sourceWeight ? { weight: overrides.sourceWeight, styleName: overrides.sourceWeight } : {}
	const sourceDirOverrides = overrides.sourceDir ? { dir: path.resolve(overrides.sourceDir) } : {}
	const unrealOverrides = overrides.modRef ? { iconLibraryName: `${modRef}_IconLibrary`, gameFeatureName: modRef } : {}

	return {
		...config,
		modRef,
		source: {
			...config.source,
			...sourceDirOverrides,
			...sourceWeightOverrides,
		},
		unreal: {
			...config.unreal,
			...unrealOverrides,
		},
		size: overrides.size !== undefined ? normalizePositiveInteger(overrides.size, 'CLI option --size') : config.size,
		color: overrides.color ?? config.color,
		iconType: overrides.iconType ? normalizeIconType(overrides.iconType, 'CLI option --type') : config.iconType,
		pluginIconAsset: overrides.pluginIconAsset !== undefined ? overrides.pluginIconAsset : config.pluginIconAsset,
		idBase: overrides.idBase !== undefined ? normalizeIdBase(overrides.idBase, 'CLI option --id-base') : config.idBase,
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

function fail(message: string): never {
	throw new Error(message)
}

function normalizeIdBase(value: number, source: string): number {
	return Number.isInteger(value) && value >= 0 && value <= MAX_LOCAL_ICON_ID
		? value
		: fail(`${source} idBase must be an integer from 0 to ${MAX_LOCAL_ICON_ID}`)
}

function normalizePositiveInteger(value: number, source: string): number {
	return Number.isInteger(value) && value > 0 ? value : fail(`${source} must be a positive integer`)
}

function normalizeIconType(value: string, source: string): string {
	const normalized = String(value)
		.trim()
		.replace(/^EIconType::/i, '')
		.replace(/^ESIT[_-]?/i, '')
		.replace(/[_\s]+/g, '-')
		.toLowerCase()
	const iconType = ICON_TYPES.get(normalized)

	return iconType ?? fail(`${source} iconType must be one of: ${VALID_ICON_TYPE_NAMES.join(', ')}`)
}
