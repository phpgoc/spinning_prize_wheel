import adapter from '@sveltejs/adapter-static';

const outputDirectory = process.env.WEB_BUILD_OUT_DIR ?? 'build';

const config = {
  kit: {
    adapter: adapter({
      pages: outputDirectory,
      assets: outputDirectory,
      fallback: '200.html',
      strict: false,
    }),
    prerender: { entries: ['*'] },
  },
};

export default config;
