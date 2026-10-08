// NOTE: package.json pins `eslint-plugin-react-hooks` to 7.0.1 via a pnpm
// override. eslint-config-next only asks for ^7.0.0, so a clean install
// otherwise takes 7.1.1, whose broadened React Compiler rules report 133 errors
// across 62 files (mostly react-hooks/set-state-in-effect) and fail the
// --max-warnings=0 gate below.
//
// That rule is already adopted here — see the ~23 inline
// `eslint-disable-next-line react-hooks/set-state-in-effect` directives — so
// switching it off wholesale would drop a standard the codebase actively uses.
// Moving to 7.1 means working through those 133 findings for real; drop the
// override when doing that work. Checked 2026-07-17.
import nextPlugin from 'eslint-config-next';

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'next-env.d.ts',
      'code-review/**',
      'oldstuff/**',
      'coverage/**',
      'standalone/*/dist/**',
      // Playwright e2e artifacts (minified report bundles, traces, auth state).
      'playwright-report/**',
      'test-results/**',
      'e2e/.auth/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '.obsidian/**',
      'public/js/**',
      // Locked worktrees from agent runs would otherwise surface stale
      // warnings from pre-existing code, blocking the zero-warnings push gate.
      '.claude/worktrees/**',
    ],
  },
  ...nextPlugin,
];

export default eslintConfig;
