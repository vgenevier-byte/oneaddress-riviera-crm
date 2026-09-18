# Native IZORD presentation source

The presentation modules are a scoped TypeScript port of the native OpenXML engine in `IZORD_Invest_Fiche_Projet_Locations_v3 (1).html`, supplied by the user. Source SHA-256: `8c3fe11e16c96f80091a8a3b5602d8d324a18c3bae0bb2256539e17a9e7427d1`.

- `presentation.ts`: original `makePpt`, validated isolated project input, abort support.
- `presentation-maps.ts`: original `maps` text-to-shape mappings.
- `presentation-layout.ts`: original `renderedFont`, `photoLayout`, captions and headers.
- `presentation-notes.ts`: original non-example calculation notes and source references.
- `presentation-gallery.ts`: original native third-slide assembly and metadata updates.
- `presentation-xml.ts`: original XML editing helpers.
- `presentation-assets.json`: original blank photographs, slide geometry/style specifications, and sanitized original template; no example project or examplePhotos array.

The source template is retained in native editable form at 12,192,000 × 6,858,000 EMU (960 × 540 preview). Its four demonstration photographs are replaced by the source's blank photographs. All dynamic default text is replaced with the original engine's blank-project mappings. Demonstration photo descriptions, default notes and document properties are neutralized. The demonstration thumbnail and unused printer-settings binary, with their relationships/content-type entries, are removed. Masters, layouts, shapes, theme, fonts, positioning and original mappings remain. Sanitized template SHA-256: `45497b81dbf57d5e3aad5c50934d7035c7ad46bccf70cbadbfd759fdb8685863`.

Sanitization applies to the embedded starting template only. The engine does not erase names, sources, notes or photographs deliberately supplied in a project import, including words that occurred in the historical example.

JSZip 3.10.1 matches the source engine's embedded version and is loaded as the exact npm dependency. Its MIT license is retained in `licenses/JSZip-3.10.1-MIT.md`.

Reproducible parity coverage is in `tests/izord/presentation-parity.browser.mjs`. It runs the unchanged original HTML and the port on the same fictitious inputs in a new isolated Playwright context, comparing native editable slide XML, notes, images and dimensions. Differences allowed by that comparison are only the documented removal/neutralization of template residues.
