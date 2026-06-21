import type { AssetPackConfig, AssetRecord, IdLockFile, ParsedIdLock } from './types.js'

export const MAX_LOCAL_ICON_ID = 65535

export function assertNoDuplicates(records: AssetRecord[]): void {
	assertUnique(records, (record) => record.id, 'local asset ID')
	assertUnique(records, (record) => record.slug, 'asset slug')
	assertUnique(records, (record) => record.textureAssetName.toLowerCase(), 'texture asset name')
	assertUnique(records, (record) => record.displayName.toLowerCase(), 'display name')
}

export function assertUnique<T>(records: AssetRecord[], getValue: (record: AssetRecord) => T, label: string): void {
	const seen = new Map<T, AssetRecord>()

	for (const record of records) {
		const value = getValue(record)
		const previous = seen.get(value)
		if (previous) {
			throw new Error(`Duplicate ${label}: ${value} (${previous.slug}, ${record.slug})`)
		}
		seen.set(value, record)
	}
}

export function buildIdLock(records: AssetRecord[], config: AssetPackConfig): IdLockFile {
	const sortedRecords = [...records].sort((left, right) => left.id - right.id || left.slug.localeCompare(right.slug))
	const maxAssignedId = sortedRecords.length > 0 ? Math.max(...sortedRecords.map((record) => record.id)) : null

	return {
		schemaVersion: 1,
		modRef: config.modRef,
		idBase: config.idBase,
		maxAssignedId,
		lockedBy: 'asset',
		assets: sortedRecords.map((record) => ({
			ID: record.id,
			slug: record.slug,
			textureAssetName: record.textureAssetName,
		})),
	}
}

export function parseIdLock(
	idLock: unknown,
	lockPath: string,
	config: AssetPackConfig,
	normalizeAssetSlug: (value: string) => string,
): ParsedIdLock {
	if (!isIdLockFile(idLock)) {
		throw new Error(`${lockPath} is not a valid asset ID lock file`)
	}

	if (idLock.schemaVersion !== 1) {
		throw new Error(`${lockPath} has unsupported schemaVersion ${idLock.schemaVersion}`)
	}

	if (idLock.modRef !== config.modRef) {
		throw new Error(`${lockPath} modRef ${idLock.modRef} does not match ${config.modRef}`)
	}

	if (idLock.lockedBy !== 'asset') {
		throw new Error(`${lockPath} must use lockedBy: "asset"`)
	}

	if (!Array.isArray(idLock.assets)) {
		throw new Error(`${lockPath} must contain an assets array`)
	}

	const bySlug = new Map<string, IdLockFile['assets'][number]>()
	const byId = new Map<number, IdLockFile['assets'][number]>()
	let maxAssignedId = config.idBase - 1

	for (const asset of idLock.assets) {
		if (!Number.isInteger(asset.ID) || asset.ID < 0 || asset.ID > MAX_LOCAL_ICON_ID) {
			throw new Error(`${lockPath} contains invalid ID for ${asset.slug}: ${asset.ID}`)
		}

		if (typeof asset.slug !== 'string' || normalizeAssetSlug(asset.slug) !== asset.slug) {
			throw new Error(`${lockPath} contains invalid normalized asset slug: ${asset.slug}`)
		}

		const previousSlug = bySlug.get(asset.slug)
		if (previousSlug) {
			throw new Error(`${lockPath} contains duplicate locked asset: ${asset.slug}`)
		}

		const previousId = byId.get(asset.ID)
		if (previousId) {
			throw new Error(`${lockPath} contains duplicate locked ID ${asset.ID}: ${previousId.slug}, ${asset.slug}`)
		}

		bySlug.set(asset.slug, asset)
		byId.set(asset.ID, asset)
		maxAssignedId = Math.max(maxAssignedId, asset.ID)
	}

	if (idLock.maxAssignedId !== null && idLock.maxAssignedId !== maxAssignedId) {
		throw new Error(`${lockPath} maxAssignedId ${idLock.maxAssignedId} does not match actual max ${maxAssignedId}`)
	}

	return {
		assets: idLock.assets,
		bySlug,
		byId,
		idBase: idLock.idBase,
		maxAssignedId,
	}
}

export function applyIdLock(records: AssetRecord[], lock: ParsedIdLock | null): AssetRecord[] {
	if (!lock) {
		return records
	}

	let nextId = Math.max(lock.idBase - 1, lock.maxAssignedId) + 1
	const usedIds = new Set(lock.assets.map((asset) => asset.ID))

	const lockedRecords = records.map((record) => {
		const lockedAsset = lock.bySlug.get(record.slug)
		if (lockedAsset) {
			return { ...record, id: lockedAsset.ID }
		}

		while (usedIds.has(nextId)) {
			nextId += 1
		}

		if (nextId > MAX_LOCAL_ICON_ID) {
			throw new Error(
				`Could not assign ID for ${record.slug}; next available ID ${nextId} exceeds maximum supported local ID ${MAX_LOCAL_ICON_ID}`,
			)
		}

		usedIds.add(nextId)
		const assigned = { ...record, id: nextId }
		nextId += 1
		return assigned
	})

	return lockedRecords.sort((left, right) => left.id - right.id || left.slug.localeCompare(right.slug))
}

function isIdLockFile(value: unknown): value is IdLockFile {
	if (!value || typeof value !== 'object') {
		return false
	}
	const candidate = value as Partial<IdLockFile>
	return candidate.schemaVersion === 1 && Array.isArray(candidate.assets)
}
