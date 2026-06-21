import { readFile } from 'node:fs/promises'
import type path from 'node:path'

export async function readJsonIfExists(filePath: string): Promise<unknown | null> {
	try {
		return JSON.parse(await readFile(filePath, 'utf8'))
	} catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') {
			return null
		}
		throw error
	}
}

export async function assertFile(filePath: string): Promise<void> {
	const { stat } = await import('node:fs/promises')
	const fileStat = await stat(filePath).catch(() => null)
	if (!fileStat?.isFile()) {
		throw new Error(`Missing file: ${filePath}`)
	}
}

export function toPortablePath(filePath: string, pathModule: typeof path): string {
	return filePath.split(pathModule.sep).join('/')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error
}
