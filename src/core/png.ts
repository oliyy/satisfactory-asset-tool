import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export async function validateWhiteRgbaPng(filePath: string, expectedSize: number): Promise<void> {
	const png = readPngRgba(await readFile(filePath))

	if (png.width !== expectedSize || png.height !== expectedSize) {
		throw new Error(`${filePath} is ${png.width}x${png.height}; expected ${expectedSize}x${expectedSize}`)
	}

	let transparentPixels = 0
	let visiblePixels = 0

	for (let offset = 0; offset < png.pixels.length; offset += 4) {
		const red = png.pixels[offset]
		const green = png.pixels[offset + 1]
		const blue = png.pixels[offset + 2]
		const alpha = png.pixels[offset + 3]

		if (alpha === 0) {
			transparentPixels += 1
			continue
		}

		visiblePixels += 1
		if (red !== 255 || green !== 255 || blue !== 255) {
			throw new Error(`${filePath} has a non-white visible pixel at byte offset ${offset}`)
		}
	}

	if (visiblePixels === 0) {
		throw new Error(`${filePath} has no visible icon pixels`)
	}

	if (transparentPixels === 0) {
		throw new Error(`${filePath} has no transparent background pixels`)
	}
}

export function readPngRgba(buffer: Buffer): {
	width: number
	height: number
	bitDepth: number
	colorType: number
	pixels: Buffer
} {
	if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		throw new Error('Invalid PNG signature')
	}

	let width = null
	let height = null
	let bitDepth = null
	let colorType = null
	const idatChunks = []
	let offset = PNG_SIGNATURE.length

	while (offset < buffer.length) {
		const length = buffer.readUInt32BE(offset)
		const type = buffer.toString('ascii', offset + 4, offset + 8)
		const dataStart = offset + 8
		const dataEnd = dataStart + length
		const data = buffer.subarray(dataStart, dataEnd)

		if (type === 'IHDR') {
			width = data.readUInt32BE(0)
			height = data.readUInt32BE(4)
			bitDepth = data.readUInt8(8)
			colorType = data.readUInt8(9)
		} else if (type === 'IDAT') {
			idatChunks.push(data)
		} else if (type === 'IEND') {
			break
		}

		offset = dataEnd + 4
	}

	if (width === null || height === null) {
		throw new Error('PNG is missing IHDR')
	}

	if (bitDepth !== 8 || colorType !== 6) {
		throw new Error(`Expected 8-bit RGBA PNG, got bitDepth=${bitDepth} colorType=${colorType}`)
	}

	const bytesPerPixel = 4
	const stride = width * bytesPerPixel
	const inflated = inflateSync(Buffer.concat(idatChunks))
	const pixels = Buffer.alloc(width * height * bytesPerPixel)
	let inputOffset = 0
	let outputOffset = 0
	let previousRow = Buffer.alloc(stride)

	for (let row = 0; row < height; row += 1) {
		const filter = inflated[inputOffset]
		inputOffset += 1
		const currentRow = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride))
		inputOffset += stride

		unfilterRow(currentRow, previousRow, filter, bytesPerPixel)
		currentRow.copy(pixels, outputOffset)
		previousRow = currentRow
		outputOffset += stride
	}

	return { width, height, bitDepth, colorType, pixels }
}

function unfilterRow(row: Buffer, previousRow: Buffer, filter: number, bytesPerPixel: number): void {
	switch (filter) {
		case 0:
			return
		case 1:
			for (let index = 0; index < row.length; index += 1) {
				const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0
				row[index] = (row[index] + left) & 0xff
			}
			return
		case 2:
			for (let index = 0; index < row.length; index += 1) {
				row[index] = (row[index] + previousRow[index]) & 0xff
			}
			return
		case 3:
			for (let index = 0; index < row.length; index += 1) {
				const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0
				const up = previousRow[index]
				row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff
			}
			return
		case 4:
			for (let index = 0; index < row.length; index += 1) {
				const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0
				const up = previousRow[index]
				const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0
				row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 0xff
			}
			return
		default:
			throw new Error(`Unsupported PNG filter type ${filter}`)
	}
}

function paethPredictor(left: number, up: number, upLeft: number): number {
	const p = left + up - upLeft
	const pa = Math.abs(p - left)
	const pb = Math.abs(p - up)
	const pc = Math.abs(p - upLeft)

	if (pa <= pb && pa <= pc) {
		return left
	}
	if (pb <= pc) {
		return up
	}
	return upLeft
}
