# Licence host folder

`node tools/licence.mjs issue` writes one small encrypted file per short code into `k/`.
Publish this folder on any static HTTPS host (for example a GitHub Pages repository) and run
`node tools/licence.mjs set-host <its https URL>` once, then rebuild the app.

Safe to make public: file names are random and contents are encrypted with the short code.
The host cannot read keys, learn codes or create licences — the app still checks the signature.
`node tools/licence.mjs revoke <ID>` deletes a code's file (publish again afterwards).
