import type { Reroute } from '@sveltejs/kit';
import { logicalRouteFromHtmlPath } from './lib/file-navigation';

/** 让 SvelteKit 在 file:// 和静态服务器中按物理 HTML 文件识别页面。 */
export const reroute: Reroute = ({ url }) => logicalRouteFromHtmlPath(url.pathname) ?? undefined;
