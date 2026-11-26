// "Check for updates" for copies of the app installed from an APK file (not from Google Play).
// The app reads a small file published beside the APK:  { "versionCode": 10202, "version": "1.2.2", "file": "Atmanirbhar-Metal-1.2.2.apk", "notes": "…" }
// Android itself refuses an APK that is not signed with the same key as the installed app, so a wrong file cannot replace the app.
export const versionCode = v => { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/.exec(String(v ?? '')); return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : 0; };

/** Checks the published file. Returns { version, versionCode, apkUrl, notes } or null if it is not usable. */
export function readManifest(data, manifestUrl) {
  let d = data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return null; } }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const code = versionCode(d.version);
  if (!code || d.versionCode !== code) return null;
  if (typeof d.file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.apk$/.test(d.file)) return null;
  if (!/^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9._\/-]*$/.test(String(manifestUrl))) return null;
  const dir = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);          // the APK always comes from the same folder
  return { version: d.version, versionCode: code, apkUrl: dir + d.file, notes: typeof d.notes === 'string' ? d.notes.slice(0, 600) : '' };
}
export const isNewer = (manifest, installedVersion) => !!manifest && manifest.versionCode > versionCode(installedVersion);
