# Ardia logo

Two oil-painted hills (sage `#71955A`, forest `#203F32`) under a sun (`#E6BC62`), on a parchment tile (`#F9F5E3`).
`source/` holds the three paintings, generated with Codex image generation (round 5, "hills"):
`app-icon.png` (the tile), `mark.png` (the hills alone) and `mark-small.png` (flat colours, for 16 pt).

`python3 docs/brand/ardia/build.py` (numpy, Pillow, SciPy) builds every size into `output/brand/ardia/final/`. Where they go:

| Built file | Slot |
|---|---|
| `icon-1024.png` (Apple's template: 824 px body at a 100 px inset, with its shadow) | `apps/browser/macos/Ardia-macOS/Assets.xcassets/AppIcon.appiconset/*` (each size), `apps/browser/assets/app-icon.png` |
| `plate-mark-1024.png`, `plate-mark-<colour>-1024.png` | `AppIconMark.imageset/mark.png` and `AppIconMark-<colour>.imageset/mark.png` (build.py copies them): the plate app-icon variants (`packages/shell/ios/AppIcon.swift`), hills tinted to the plate as on the New Tab page (plum, blue, neutral) |
| `ntp-mark[-<colour>]-{back,front,sun}*.png` | `apps/browser/assets/`: the New Tab page, hills on the bottom edge rising from behind the bar, as three layers that rise one after another (the light hill behind, painted on under the dark one; the dark hill; the sun); one set per profile colour (green is the brand painting). `ntp-mark[-<colour>]*.png` is the whole painting the layers are cut from (not installed) |
| `new-tab-mark*.png` | `apps/browser/assets/new-tab-mark*.png`: one colour (drawn tinted), hills split and the sun cut free |
| `icon-512.png` | `extras/raycast-ardia/assets/icon.png` |
| `apple-touch-icon.png` | `apps/site/public/apple-touch-icon.png` |

The site's header icon, favicon and share image are cut from the same files (`apps/site`).
