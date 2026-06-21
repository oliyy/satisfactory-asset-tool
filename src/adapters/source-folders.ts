import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { normalizeAssetSlug } from '../core/naming.js'
import type { AssetPackConfig, SourceAsset } from '../core/types.js'

interface SourceAssetCandidate {
	slug: string
	filename: string
	sourceAsset: SourceAsset
	preferred: boolean
}

export async function listAvailableSourceAssets(config: AssetPackConfig): Promise<Map<string, SourceAsset>> {
	if (config.source.type === 'unreal-texture-list') {
		return listConfiguredUnrealTextureAssets(config)
	}

	return config.source.type === 'png-folder' ? listAvailablePngAssets(config) : listAvailableSvgAssets(config)
}

function listConfiguredUnrealTextureAssets(config: AssetPackConfig): Map<string, SourceAsset> {
	const duplicate = firstDuplicate(config.source.assets.map((asset) => asset.slug))
	if (duplicate) {
		throw new Error(`Duplicate unreal texture source asset slug: ${duplicate}`)
	}

	return new Map(
		config.source.assets.map((asset) => [
			asset.slug,
			{
				slug: asset.slug,
				sourcePath: asset.textureObjectPath,
				sourceType: 'unreal-texture',
				displayName: asset.displayName ?? undefined,
				textureObjectPath: asset.textureObjectPath,
			},
		]),
	)
}

async function listAvailableSvgAssets(config: AssetPackConfig): Promise<Map<string, SourceAsset>> {
	const entries = await readdir(config.source.dir, { withFileTypes: true })
	const candidates = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'))
		.map((entry) => sourceSvgCandidate(config, entry.name))

	return candidatesToMap(candidates.filter(isSourceAssetCandidate))
}

async function listAvailablePngAssets(config: AssetPackConfig): Promise<Map<string, SourceAsset>> {
	const entries = await readdir(config.source.dir, { withFileTypes: true })
	const candidates = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
		.map((entry) => sourcePngCandidate(config, entry.name))

	return candidatesToMap(candidates.filter(isSourceAssetCandidate))
}

function sourceSvgCandidate(config: AssetPackConfig, filename: string): SourceAssetCandidate | null {
	const slug = normalizeSourceFilename(config, filename)
	const expectedName = config.source.weight ? `${slug}-${config.source.weight}.svg` : `${slug}.svg`

	return slug
		? {
				slug,
				filename,
				preferred: Boolean(config.source.weight && filename === expectedName),
				sourceAsset: {
					slug,
					sourcePath: path.join(config.source.dir, filename),
					sourceType: 'svg',
				},
			}
		: null
}

function sourcePngCandidate(config: AssetPackConfig, filename: string): SourceAssetCandidate | null {
	const slug = normalizeSourceFilename(config, filename)

	return slug
		? {
				slug,
				filename,
				preferred: true,
				sourceAsset: {
					slug,
					sourcePath: path.join(config.source.dir, filename),
					sourceType: 'png',
				},
			}
		: null
}

function normalizeSourceFilename(config: AssetPackConfig, filename: string): string {
	return normalizeAssetSlug(filename, {
		styleSuffixes: config.styleSuffixes,
	})
}

function candidatesToMap(candidates: SourceAssetCandidate[]): Map<string, SourceAsset> {
	const slugs = [...new Set(candidates.map((candidate) => candidate.slug))]

	return new Map(
		slugs.map((slug) => {
			const slugCandidates = candidates.filter((candidate) => candidate.slug === slug)
			const preferredCandidates = slugCandidates.filter((candidate) => candidate.preferred)
			const selected = uniqueCandidateForSlug(slug, slugCandidates, preferredCandidates)

			return [slug, selected.sourceAsset]
		}),
	)
}

function uniqueCandidateForSlug(
	slug: string,
	candidates: SourceAssetCandidate[],
	preferredCandidates: SourceAssetCandidate[],
): SourceAssetCandidate {
	if (candidates.length === 1) {
		return candidates[0]!
	}

	if (preferredCandidates.length === 1) {
		return preferredCandidates[0]!
	}

	const filenames = candidates
		.map((candidate) => candidate.filename)
		.toSorted()
		.join(', ')
	throw new Error(`Duplicate source files normalize to asset slug "${slug}": ${filenames}`)
}

function isSourceAssetCandidate(candidate: SourceAssetCandidate | null): candidate is SourceAssetCandidate {
	return candidate !== null
}

function firstDuplicate(values: string[]): string | undefined {
	return values.find((value, index) => values.indexOf(value) !== index)
}
