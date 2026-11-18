# Every merge to main deploys

A merge to `main` ships without an approval step: CI tags the tested images of the apps the merge changed as `:main` only after the whole run passed (`docs/ci-and-images.md`, Release main images), and the production deploy timer deploys `:main` every few minutes (`ops/README.md`). The pull request review and its green CI run are the release gate. Work that must not reach users yet stays off `main` or behind a deployment switch, as statement file import does with `FILE_IMPORT_ENABLED`.
