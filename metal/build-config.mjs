// Set by the build scripts (npm run apk:metal). 'retail' or 'metal': which shop type the first-time setup screen starts on.
export const DEFAULT_SHOP_TYPE = 'metal';
// The app's version (copied from package.json by scripts/set-variant.mjs).
export const APP_VERSION = '1.2.3';
// Where an APK sent as a file looks for a newer version ("Check for updates"). MUST stay empty for the Google Play build.
export const UPDATE_URL = '';
// 'metal' = this build is only for metal-cutting shops: the "type of shop" choice is not shown. Empty = both choices.
export const ONLY_SHOP_TYPE = 'metal';
// 'metal' = a first visit opens the demo metal shop (demo-metal.mjs) instead of the setup screen. Used for the customer website only.
export const DEMO_SHOP = 'metal';
