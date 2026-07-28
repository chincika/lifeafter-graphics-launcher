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

## Update integrity

Updates use the SHA-256 digest returned by GitHub Release assets, with
`SHA256SUMS.txt` as a fallback. The digest is checked during download, before
replacement, and after the update copy. v2.3.1 intentionally removes the
earlier Ed25519 public/private-key mechanism.

## Security boundary

This hardening raises reverse-engineering and tampering cost; it cannot make a
client-side executable impossible to analyze. There is intentionally no paid
Microsoft Authenticode certificate, so Windows can still display an unknown
publisher warning. SHA-256 detects corruption or replacement against the
digest published by GitHub, but does not provide an independent trust root if
the GitHub account itself is compromised.
