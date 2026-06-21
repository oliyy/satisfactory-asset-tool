import js from '@eslint/js'
import functional from 'eslint-plugin-functional'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{
		ignores: ['dist/**', 'node_modules/**'],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts', 'test/**/*.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				console: 'readonly',
				process: 'readonly',
			},
		},
		plugins: functional.configs.recommended.plugins,
		rules: {
			...functional.configs.recommended.rules,
			'functional/no-expression-statements': 'off',
			'functional/no-return-void': 'off',
			'functional/no-throw-statements': 'off',
			'functional/prefer-immutable-types': 'off',
		},
	},
	{
		files: ['src/cli/**/*.ts', 'src/core/ids.ts', 'src/core/png.ts', 'src/core/svg.ts', 'src/unreal/**/*.ts'],
		rules: {
			'functional/functional-parameters': 'off',
			'functional/immutable-data': 'off',
			'functional/no-conditional-statements': 'off',
			'functional/no-let': 'off',
			'functional/no-loop-statements': 'off',
		},
	},
	{
		files: ['src/asset-pack/**/*.ts'],
		rules: {
			'functional/no-conditional-statements': 'off',
		},
	},
)
