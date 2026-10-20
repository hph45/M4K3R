# Retained third-party material

`licenses/` contains the identified full license/exception texts and provenance evidence for ROM, WASM kernels and library data. `scripts/release/sources.json` pins source archive URLs and SHA-256 checksums. The packager downloads missing archives into `.local-data/release-sources/`, verifies them and copies only those listed archives into `third_party/sources/` in the release.

`licenses/Espressif-KiCad-library-license.md` is the separately retained `espressif/kicad-libraries/main/LICENSE.md`, retrieved on 2026-10-18 for the catalog's ESP32-C3-DevKitM-1 footprint. It specifies CC-BY-SA 4.0 with an electronic-design/generated-file exception and says the conditions match KiCad's official libraries. The footprint's Espressif origin is distinct from its KiCad-derived symbol; see the full attribution in `THIRD_PARTY_NOTICES.md`.

Included source archives:

- RP2040 B1 bootrom revision `00a4a191…` and its pinned Pico SDK `26653ea8…`. Extract the SDK into the bootrom tree's `pico_sdk` directory when reproducing the original build. Upstream README identifies GCC Arm 9.2.1 and a debug build. That exact build was not reproduced during packaging.
- replicad `e4b05f67…`, including `packages/replicad-opencascadejs/build-source`, generated build configuration and wrappers.
- opencascade.js `ebd263f1…`, including Dockerfile, patches and `DEPS.json`; OCCT `b8f597c6…`, FreeType `de8b92dd…` and RapidJSON `24b5e7a8…` from that recipe. These are the recipe's source identities, not an independent attestation of the publisher's npm binary.
- PlaneGCS `9d26baef…`, including copied FreeCAD solver sources, bindings, CMake and Docker recipe. The recipe references Emscripten 6.0.10 and unpinned apt Eigen/Boost packages; rebuilding may need the original dependency environment. Their identified license texts are retained separately.

`dependencies/` and `dependency-inventory.json` are generated inside each release from the actually installed npm packages. The original library files remain replaceable; source archives can be inspected or rebuilt using the upstream instructions. The source snapshot and build recipes are provided without claiming that every legal or reproducibility issue is resolved. See [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).
