import { readFile } from 'node:fs/promises'

import type { AssetPackConfig, AssetRecord, SourceCatalog, SourceCatalogEntry } from '../core/types.js'

export async function loadSourceCatalog(config: AssetPackConfig): Promise<SourceCatalog | null> {
	return config.source.catalogPath ? loadConfiguredSourceCatalog(config, config.source.catalogPath) : null
}

async function loadConfiguredSourceCatalog(config: AssetPackConfig, catalogPath: string): Promise<SourceCatalog> {
	const sourceCatalog = JSON.parse(await readFile(catalogPath, 'utf8')) as {
		catalog?: string
		catalogVersion?: string
		icons?: unknown
	}

	assertCatalogCondition(
		!config.source.catalog || sourceCatalog.catalog === config.source.catalog,
		`${catalogPath} catalog ${sourceCatalog.catalog} does not match ${config.source.catalog}`,
	)
	assertCatalogCondition(
		!config.source.catalogVersion || sourceCatalog.catalogVersion === config.source.catalogVersion,
		`${catalogPath} catalogVersion ${sourceCatalog.catalogVersion} does not match ${config.source.catalogVersion}`,
	)
	assertCatalogCondition(Array.isArray(sourceCatalog.icons), `${catalogPath} must contain an icons array`)

	const entries = (sourceCatalog.icons as SourceCatalogEntry[]).map((entry) => validateSourceCatalogEntry(catalogPath, entry))
	const duplicateName = firstDuplicate(entries.map((entry) => entry.name))
	assertCatalogCondition(!duplicateName, `${catalogPath} contains duplicate catalog entry name: ${duplicateName}`)
	const byName = new Map(entries.map((entry) => [entry.name, entry]))

	return {
		catalog: sourceCatalog.catalog,
		catalogVersion: sourceCatalog.catalogVersion,
		entries,
		byName,
	}
}

export function catalogEntryForRecord(
	record: AssetRecord,
	catalogByName: Map<string, SourceCatalogEntry>,
	slugOverrides: Record<string, string> = {},
): { sourceSlug: string; catalogEntry: SourceCatalogEntry } {
	const sourceSlug = slugOverrides[record.slug] ?? slugOverrides[record.sourceSlug] ?? record.sourceSlug
	const catalogEntry = catalogByName.get(sourceSlug)

	return {
		sourceSlug,
		catalogEntry: catalogEntry ?? fail(`Missing source catalog metadata for ${record.slug} (source slug ${sourceSlug})`),
	}
}

export function cleanSearchTerms(tags: string[] = []): string[] {
	return tags.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0 && !/^\*.*\*$/.test(tag))
}

function validateSourceCatalogEntry(catalogPath: string, entry: SourceCatalogEntry): SourceCatalogEntry {
	assertCatalogCondition(
		typeof entry.name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name),
		`${catalogPath} contains invalid catalog entry name: ${entry.name}`,
	)
	assertCatalogCondition(Array.isArray(entry.categories), `${catalogPath} ${entry.name} must contain a categories array`)
	assertCatalogCondition(Array.isArray(entry.tags), `${catalogPath} ${entry.name} must contain a tags array`)

	return entry
}

function firstDuplicate(values: string[]): string | undefined {
	return values.find((value, index) => values.indexOf(value) !== index)
}

function assertCatalogCondition(condition: unknown, message: string): asserts condition {
	return condition ? undefined : fail(message)
}

function fail(message: string): never {
	throw new Error(message)
}
