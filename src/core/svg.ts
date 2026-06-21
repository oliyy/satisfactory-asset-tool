import { spawn } from 'node:child_process'

interface ParsedTag {
	tagName: string
	attrs: ParsedAttribute[]
	selfClosing: boolean
}

interface ParsedRootTag extends ParsedTag {
	start: number
	end: number
}

interface ParsedAttribute {
	name: string
	value: string
	quote: string
}

export function normalizeSvgColor(svg: string, color: string): string {
	const parsed = parseRootStartTag(svg)
	const attrs = upsertAttribute(parsed.attrs, 'color', color)
	const fillAttr = attrs.find((attr) => attr.name.toLowerCase() === 'fill')

	if (!fillAttr || fillAttr.value === 'currentColor') {
		upsertAttribute(attrs, 'fill', color)
	}

	const startTag = serializeStartTag(parsed.tagName, attrs, parsed.selfClosing)
	return `${svg.slice(0, parsed.start)}${startTag}${svg.slice(parsed.end + 1)}`
}

function parseRootStartTag(svg: string): ParsedRootTag {
	let index = 0

	while (index < svg.length) {
		const start = svg.indexOf('<', index)
		if (start === -1) {
			break
		}

		if (svg.startsWith('<?', start)) {
			const end = svg.indexOf('?>', start + 2)
			if (end === -1) {
				throw new Error('Unterminated XML declaration')
			}
			index = end + 2
			continue
		}

		if (svg.startsWith('<!--', start)) {
			const end = svg.indexOf('-->', start + 4)
			if (end === -1) {
				throw new Error('Unterminated SVG comment')
			}
			index = end + 3
			continue
		}

		if (svg[start + 1] === '!') {
			index = findTagEnd(svg, start) + 1
			continue
		}

		const end = findTagEnd(svg, start)
		const content = svg.slice(start + 1, end)
		const tag = parseTagContent(content)

		if (tag.tagName.toLowerCase() !== 'svg') {
			throw new Error(`Expected root <svg> tag, found <${tag.tagName}>`)
		}

		return { ...tag, start, end }
	}

	throw new Error('Could not find root <svg> tag')
}

function findTagEnd(value: string, start: number): number {
	let quote: string | null = null
	for (let index = start + 1; index < value.length; index += 1) {
		const char = value[index]

		if (quote) {
			if (char === quote) {
				quote = null
			}
			continue
		}

		if (char === '"' || char === "'") {
			quote = char
			continue
		}

		if (char === '>') {
			return index
		}
	}

	throw new Error('Unterminated SVG start tag')
}

function parseTagContent(content: string): ParsedTag {
	let index = 0
	index = skipWhitespace(content, index)

	const tagNameStart = index
	while (index < content.length && !/\s|\//.test(content[index])) {
		index += 1
	}

	const tagName = content.slice(tagNameStart, index)
	const attrs: ParsedAttribute[] = []
	let selfClosing = false

	while (index < content.length) {
		index = skipWhitespace(content, index)

		if (content[index] === '/') {
			selfClosing = true
			index += 1
			continue
		}

		if (index >= content.length) {
			break
		}

		const nameStart = index
		while (index < content.length && !/[\s=/]/.test(content[index])) {
			index += 1
		}

		const name = content.slice(nameStart, index)
		index = skipWhitespace(content, index)

		let value = ''
		let quote = '"'
		if (content[index] === '=') {
			index += 1
			index = skipWhitespace(content, index)
			if (content[index] === '"' || content[index] === "'") {
				quote = content[index]
				index += 1
				const valueStart = index
				while (index < content.length && content[index] !== quote) {
					index += 1
				}
				value = content.slice(valueStart, index)
				index += 1
			} else {
				const valueStart = index
				while (index < content.length && !/\s|\//.test(content[index])) {
					index += 1
				}
				value = content.slice(valueStart, index)
			}
		}

		if (name) {
			attrs.push({ name, value, quote })
		}
	}

	return { tagName, attrs, selfClosing }
}

function skipWhitespace(value: string, index: number): number {
	while (index < value.length && /\s/.test(value[index])) {
		index += 1
	}
	return index
}

function upsertAttribute(attrs: ParsedAttribute[], name: string, value: string): ParsedAttribute[] {
	const attr = attrs.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())
	if (attr) {
		attr.value = value
	} else {
		attrs.push({ name, value, quote: '"' })
	}
	return attrs
}

function serializeStartTag(tagName: string, attrs: ParsedAttribute[], selfClosing: boolean): string {
	const serializedAttrs = attrs
		.map((attr) => ` ${attr.name}=${attr.quote ?? '"'}${escapeAttribute(attr.value)}${attr.quote ?? '"'}`)
		.join('')
	return `<${tagName}${serializedAttrs}${selfClosing ? ' /' : ''}>`
}

function escapeAttribute(value: string): string {
	return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export function renderPng(svgPath: string, pngPath: string, size: number): Promise<void> {
	return run('rsvg-convert', ['--width', String(size), '--height', String(size), '--format', 'png', '--output', pngPath, svgPath])
}

export function run(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: ['ignore', 'inherit', 'inherit'],
		})

		child.on('error', reject)
		child.on('close', (code) => {
			if (code === 0) {
				resolve()
			} else {
				reject(new Error(`${command} exited with code ${code}`))
			}
		})
	})
}
