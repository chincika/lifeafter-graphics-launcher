# LZ4 runtime dependencies

This directory contains the .NET Framework runtime assemblies used by the
strict NXPK auto-adaptation path.

- `K4os.Compression.LZ4.dll` 1.3.8, by Milosz Krajewski, MIT license.
  Source: https://github.com/MiloszKrajewski/K4os.Compression.LZ4
- `System.Memory.dll` 4.5.5, `System.Buffers.dll` 4.5.1,
  `System.Numerics.Vectors.dll` 4.5.0 and
  `System.Runtime.CompilerServices.Unsafe.dll` 6.0.0, by Microsoft,
  MIT license. Source: https://github.com/dotnet/runtime

The assemblies are copied from their corresponding packages published on
NuGet.org. They are not modified by this project.
