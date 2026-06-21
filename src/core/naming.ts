import path from 'node:path'

export interface NormalizeAssetSlugOptions {
	styleSuffixes?: string[]
}

export function normalizeAssetSlug(value: string, options: NormalizeAssetSlugOptions = {}): string {
	const withoutExtension = path.basename(String(value).trim()).replace(/\.(svg|png|json)$/i, '')
	const withoutConfiguredSuffixes = (options.styleSuffixes ?? []).reduce(
		(normalized, suffix) => normalized.replace(new RegExp(`-${escapeRegExp(suffix)}$`, 'i'), ''),
		withoutExtension,
	)

	return withoutConfiguredSuffixes
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
}

export function toPascalCase(value: string): string {
	return String(value)
		.split(/[^a-z0-9]+/i)
		.filter(Boolean)
		.map((part) => (/^\d+d$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
		.join('')
}

export function toDisplayName(slug: string, overrides: Map<string, string> = DEFAULT_DISPLAY_OVERRIDES): string {
	return String(slug)
		.split('-')
		.filter(Boolean)
		.map((part) => displayPart(part, overrides))
		.join(' ')
}

function displayPart(part: string, overrides: Map<string, string>): string {
	return (
		overrides.get(part) ??
		(/^\d+d$/.test(part) ? part.toUpperCase() : /^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))
	)
}

function escapeRegExp(value: string): string {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const DEFAULT_DISPLAY_OVERRIDES = new Map<string, string>([
	['3d', '3D'],
	['api', 'API'],
	['app', 'App'],
	['bluetooth', 'Bluetooth'],
	['cpu', 'CPU'],
	['css', 'CSS'],
	['dna', 'DNA'],
	['dvd', 'DVD'],
	['figma', 'Figma'],
	['fps', 'FPS'],
	['gif', 'GIF'],
	['git', 'Git'],
	['github', 'GitHub'],
	['gpu', 'GPU'],
	['gps', 'GPS'],
	['hd', 'HD'],
	['html', 'HTML'],
	['id', 'ID'],
	['jpg', 'JPG'],
	['js', 'JS'],
	['keyhole', 'Keyhole'],
	['mp3', 'MP3'],
	['mp4', 'MP4'],
	['png', 'PNG'],
	['qr', 'QR'],
	['rss', 'RSS'],
	['svg', 'SVG'],
	['tiktok', 'TikTok'],
	['tv', 'TV'],
	['usb', 'USB'],
	['wifi', 'Wi-Fi'],
	['youtube', 'YouTube'],
])
