import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

test('rejects partially numeric positive integer options', async () => {
	await assertCliRejects(['scan-textures', '--output', 'candidates.json', '--limit', '10abc'], /--limit must be an integer/)
	await assertCliRejects(['scan-textures', '--output', 'candidates.json', '--preview-limit', '1.5'], /--preview-limit must be an integer/)
	await assertCliRejects(
		['scan-textures', '--output', 'candidates.json', '--dimensions-limit', '25items'],
		/--dimensions-limit must be an integer/,
	)
})

test('rejects partially numeric local asset ID options', async () => {
	const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'sat-cli-id-base-'))
	const configPath = path.join(outputRoot, 'asset-pack.config.json')

	await writeFile(
		configPath,
		`${JSON.stringify(
			{
				modRef: 'CliPack',
				source: {
					type: 'unreal-texture-list',
					assets: [
						{
							slug: 'portable-miner',
							textureObjectPath: '/Game/FactoryGame/IconDesc_PortableMiner_256.IconDesc_PortableMiner_256',
						},
					],
				},
				output: {
					root: outputRoot,
				},
			},
			null,
			2,
		)}\n`,
		'utf8',
	)

	await assertCliRejects(['list', '--config', configPath, '--id-base', '10abc'], /--id-base must be an integer/)
})

async function assertCliRejects(args: string[], pattern: RegExp): Promise<void> {
	await assert.rejects(
		execFileAsync(process.execPath, ['dist/src/cli/index.js', ...args], {
			cwd: path.resolve('.'),
		}),
		(error: unknown) => {
			assert.ok(isExecFailure(error))
			assert.match(error.stderr, pattern)
			return true
		},
	)
}

interface ExecFailure extends Error {
	stderr: string
	stdout: string
	code: number
}

function isExecFailure(error: unknown): error is ExecFailure {
	return error instanceof Error && 'stderr' in error && 'stdout' in error && 'code' in error
}
