import defaultIcon from '../../../src-tauri/icons/app-icon.svg?raw';
import type { RequestHandler } from './$types';

export const prerender = true;

export const GET: RequestHandler = () => new Response(defaultIcon, {
  headers: {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  },
});
