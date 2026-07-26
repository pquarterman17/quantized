# Quantized brand mark

`quantized-app-icon.png` is the high-resolution source for the application
icon. A segmented white `Q` suggests quantized states; its center carries a
diffraction-like peak, comparison trace, sample points, and subtle polar grid,
while the tail becomes a rising ivory data trace. The large silhouette remains
recognizable at taskbar size and reveals the scientific detail at larger sizes.

Regenerate the platform icon set from the repository root:

```bash
npx --yes @tauri-apps/cli@2.11.2 icon \
  assets/branding/quantized-app-icon.png \
  --output src-tauri/icons
```

The icon was generated and revised with OpenAI's built-in image-generation
tool on 2026-07-26, then cropped, transparency-matted, and converted with the
pinned Tauri icon generator. Keep the violet, white, warm ivory, and vermilion
palette and preserve a recognizable `Q` when making future revisions.
