import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = !watch;

/** @type {import('esbuild').BuildOptions} */
const options = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    external: ['vscode', 'fts5-sql-bundle'],
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    minify: production,
    metafile: true,
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[esbuild] watching for changes...');
} else {
    const result = await esbuild.build(options);
    const text = await esbuild.analyzeMetafile(result.metafile);
    console.log(text);
    console.log('[esbuild] build complete');
}
