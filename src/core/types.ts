export type SourceType = 'svg-folder' | 'png-folder' | 'unreal-texture-list'
export type SourceAssetType = 'svg' | 'png' | 'unreal-texture'
export type TextureSource = 'generated' | 'unreal-existing'
export type BackgroundType = 'none' | 'sign-image'
export type SignImageBackgroundMode = 'contain' | 'cover' | 'tile'
export type IconObjectType = 'texture' | 'sign-background-material-instance'

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
	background?: RawBackgroundConfig
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

export interface RawBackgroundConfig {
	type?: BackgroundType
	mode?: SignImageBackgroundMode
	tileWidth?: number
	tileHeight?: number
	baseTileHeight?: number
	targetAspect?: number | string
	fitScale?: number
	refractionDepthBias?: number
	materialDir?: string
	materialAssetPrefix?: string
	parentMaterialObjectPath?: string
	textureParameter?: string
	variants?: RawSignImageBackgroundVariant[]
}

export interface RawSignImageBackgroundVariant {
	suffix?: string
	displayNameSuffix?: string
	mode?: SignImageBackgroundMode
	tileWidth?: number
	tileHeight?: number
	baseTileHeight?: number
	targetAspect?: number | string
	fitScale?: number
	refractionDepthBias?: number
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
	background: BackgroundConfig
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

export type BackgroundConfig = NoBackgroundConfig | SignImageBackgroundConfig

export interface NoBackgroundConfig {
	type: 'none'
}

export interface SignImageBackgroundConfig {
	type: 'sign-image'
	mode: SignImageBackgroundMode
	tileWidth: number | null
	tileHeight: number | null
	baseTileHeight: number
	targetAspect: number | null
	fitScale: number
	refractionDepthBias: number
	materialDir: string
	materialAssetPrefix: string
	parentMaterialObjectPath: string
	textureParameter: string
	variants: SignImageBackgroundVariant[]
}

export interface SignImageBackgroundVariant {
	suffix: string | null
	displayNameSuffix: string | null
	mode: SignImageBackgroundMode
	tileWidth: number | null
	tileHeight: number | null
	baseTileHeight: number
	targetAspect: number | null
	fitScale: number
	refractionDepthBias: number
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
	AddressX?: string
	AddressY?: string
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
	sourceSlug: string
	textureAssetName: string
	textureObjectPath: string
	iconAssetName: string
	iconObjectPath: string
	iconObjectType: IconObjectType
	displayName: string
	backgroundVariant: SignImageBackgroundVariant | null
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
	sourceSlug?: string
	textureAssetName: string
	iconAssetName?: string
	iconObjectPath?: string
	iconObjectType?: IconObjectType
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
		sourceSlug: string
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
		iconObjectType: IconObjectType
		iconAssetName: string
		expectedIconObjectPath: string
		materialInstance: MaterialInstanceMetadata | null
		iconLibraryAssetPath: string
		iconLibraryEntry: IconLibraryEntry
		textureSettings: TextureSettings
	}
}

export interface MaterialInstanceMetadata {
	parentMaterialObjectPath: string
	materialObjectPath: string
	textureParameter: string
	scalarParameters: Record<string, number>
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
