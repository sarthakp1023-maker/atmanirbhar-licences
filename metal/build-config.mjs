// Set by the build scripts (npm run apk:metal). 'retail' or 'metal': which shop type the first-time setup screen starts on.
export const DEFAULT_SHOP_TYPE = 'metal';
// The app's version (copied from package.json by scripts/set-variant.mjs).
export const APP_VERSION = '1.2.2';
// Where an APK sent as a file looks for a newer version ("Check for updates"). MUST stay empty for the Google Play build.
export const UPDATE_URL = '';
