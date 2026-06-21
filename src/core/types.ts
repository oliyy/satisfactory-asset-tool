export type SourceType = 'svg-folder' | 'png-folder' | 'unreal-texture-list'
export type SourceAssetType = 'svg' | 'png' | 'unreal-texture'
export type TextureSource = 'generated' | 'unreal-existing'

export interface RawAssetPackConfig {
	modRef?: string
	name?: string
	sectionName?: string
	assetPrefix?: string
	idBase?: number
	iconType?: string
	size?: number
	color?: string
	pluginIconAsset?: string | null
	sourceWeight?: string
	styleSuffixes?: string[]
	source?: RawSourceConfig
	output?: RawOutputConfig
	unreal?: RawUnrealConfig
	generation?: RawGenerationConfig
}

export interface RawSourceConfig {
	type?: SourceType
	dir?: string
	weight?: string
	styleName?: string
	catalogPath?: string
	name?: string
	catalog?: string
	catalogVersion?: string
	license?: string
	slugOverrides?: Record<string, string>
	assets?: RawUnrealTextureSourceAsset[]
}

export interface RawUnrealTextureSourceAsset {
	slug?: string
	displayName?: string
	textureObjectPath?: string
}

export interface RawOutputConfig {
	root?: string
	svgDir?: string
	textureDir?: string
	metadataDir?: string
	assetPackMetadataDir?: string
	pluginIconPath?: string
	manifestFile?: string
	idLockFile?: string
	assetPackMetadataFile?: string
}

export interface RawUnrealConfig {
	textureDir?: string
	iconLibraryDir?: string
	iconLibraryName?: string
	gameFeatureName?: string
	textureSettings?: Partial<TextureSettings>
}

export interface RawGenerationConfig {
	tool?: string
	version?: string
}

export interface AssetPackConfig {
	configPath: string
	configDir: string
	root: string
	modRef: string
	name: string
	sectionName: string
	assetPrefix: string
	idBase: number
	iconType: string
	size: number
	color: string
	pluginIconAsset: string | null
	styleSuffixes: string[]
	source: SourceConfig
	output: OutputConfig
	unreal: UnrealConfig
	generation: GenerationConfig
}

export interface SourceConfig {
	type: SourceType
	dir: string
	weight: string
	styleName: string
	catalogPath: string | null
	name: string
	catalog: string | null
	catalogVersion: string | null
	license: string | null
	slugOverrides: Record<string, string>
	assets: UnrealTextureSourceAsset[]
}

export interface UnrealTextureSourceAsset {
	slug: string
	displayName: string | null
	textureObjectPath: string
}

export interface OutputConfig {
	svgDir: string
	textureDir: string
	metadataDir: string
	assetPackMetadataDir: string
	pluginIconPath: string
	manifestFile: string
	idLockFile: string
	assetPackMetadataFile: string
}

export interface UnrealConfig {
	textureDir: string
	iconLibraryDir: string
	iconLibraryName: string
	gameFeatureName: string
	textureSettings: TextureSettings
}

export interface GenerationConfig {
	tool: string
	version: string
}

export interface TextureSettings {
	MipGenSettings: string
	TextureGroup: string
	CompressionSettings: string
	sRGB: boolean
}

export interface AssetPackOverrides {
	sourceDir?: string
	sourceWeight?: string
	size?: number
	color?: string
	iconType?: string
	modRef?: string
	pluginIconAsset?: string | null
	idBase?: number
}

export interface SourceAsset {
	slug: string
	sourcePath: string
	sourceType: SourceAssetType
	displayName?: string
	textureObjectPath?: string
}

export interface AssetRecord extends SourceAsset {
	id: number
	textureAssetName: string
	textureObjectPath: string
	displayName: string
}

export interface IdLockAsset {
	ID: number
	slug: string
	textureAssetName: string
}

export interface IdLockFile {
	schemaVersion: 1
	modRef: string
	idBase: number
	maxAssignedId: number | null
	lockedBy: 'asset'
	assets: IdLockAsset[]
}

export interface ParsedIdLock {
	assets: IdLockAsset[]
	bySlug: Map<string, IdLockAsset>
	byId: Map<number, IdLockAsset>
	idBase: number
	maxAssignedId: number
}

export interface BaseAssetManifestEntry {
	ID: number
	slug: string
	textureAssetName: string
	metadataPath: string
	displayName: string
}

export interface GeneratedAssetManifestEntry extends BaseAssetManifestEntry {
	textureSource: 'generated'
	texturePath: string
}

export interface UnrealExistingAssetManifestEntry extends BaseAssetManifestEntry {
	textureSource: 'unreal-existing'
	textureObjectPath: string
}

export type AssetManifestEntry = GeneratedAssetManifestEntry | UnrealExistingAssetManifestEntry

export interface AssetPackManifest {
	schemaVersion: 1
	modRef: string
	sourceStyle: string
	color: string
	size: number
	localIdBase: number
	localIdMax: number | null
	iconLibraryAssetPath: string
	assetCount: number
	assets: AssetManifestEntry[]
}

export interface AssetMetadataFile {
	source: {
		slug: string
		sourcePath: string
		sourceStyle: string
		color: string
		size: number
	}
	unreal: {
		modRef: string
		textureSource: TextureSource
		textureAssetName: string
		expectedTextureObjectPath: string
		iconLibraryAssetPath: string
		iconLibraryEntry: IconLibraryEntry
		textureSettings: TextureSettings
	}
}

export interface IconLibraryEntry {
	ID: number
	Texture: string
	ItemDescriptor: null | string
	DisplayNameOverride: boolean
	IconName: string
	IconType: string
	Hidden: boolean
	SearchOnly: boolean
	Animated: boolean
}

export interface SourceCatalogEntry {
	name: string
	categories: string[]
	tags: string[]
}

export interface SourceCatalog {
	catalog?: string
	catalogVersion?: string
	entries: SourceCatalogEntry[]
	byName: Map<string, SourceCatalogEntry>
}
