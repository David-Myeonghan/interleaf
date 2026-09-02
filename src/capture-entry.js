// Bundled into extension/sf-bundle.js and injected into the page being captured.
// single-file-core is AGPL-3.0; see NOTICE.
import { getPageData, init } from 'single-file-core/single-file.js';

globalThis.__snapnoteCapture = { getPageData, init };
