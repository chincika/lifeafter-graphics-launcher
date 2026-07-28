# Release hardening

The public repository is release-only. This private repository contains the
development source and must remain private.

## Frame-rate core

Production builds do not compile the FPS/NPK implementation in
`LifeAfterPresetLauncher.cs`. The implementation is built from
`private-core/fpscore` as a native Windows executable:

1. `encode-assets.js` encrypts the reviewed slot payloads for embedding.
2. `build.ps1` runs the Go tests and builds with Garble literal, identifier,
   package-path, source-position, debug-info and symbol stripping.
3. The build writes `desktop-app/frame-core-integrity.json`.
4. Electron verifies that hash before every frame-core invocation.

The legacy managed implementation is retained only as private migration
reference behind `LEGACY_MANAGED_FPS_CORE`; normal builds do not define it.

## Electron boundary

Electron fuses disable RunAsNode, `NODE_OPTIONS`, CLI inspection and loading
outside the packaged ASAR. Embedded ASAR integrity validation is enabled.
Renderer sandboxing and context isolation remain enabled.

## Update authenticity

Release updates require `release-manifest.json` and
`release-manifest.sig`. The signature uses Ed25519 and is verified against
`desktop-app/update-public-key.pem` before any download is accepted. SHA-256
is checked during download, before replacement, and after the update copy.

The private key is intentionally outside every repository:

`C:\Users\Admin\Documents\lifeafter-private-signing\release-ed25519-private.pem`

Set `LIFEAFTER_RELEASE_PRIVATE_KEY` to that path and run:

```powershell
node release-tools\sign-release.js <portable-exe> <version> <output-directory>
```

Never commit, upload, print or copy the private key into a release directory.

## Security boundary

This hardening raises reverse-engineering and tampering cost; it cannot make a
client-side executable impossible to analyze. There is intentionally no paid
Microsoft Authenticode certificate, so Windows can still display an unknown
publisher warning. Ed25519 protects this application's update channel but is
not a substitute for Authenticode reputation.
