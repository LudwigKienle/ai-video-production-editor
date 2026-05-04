# Public Release Process

This repository is download-only. It must contain only public release metadata,
download links, docs, issue templates, and visual assets.

Do not push the application source tree here. The private source checkout must
publish public releases through its guarded script:

```bash
PATH=/opt/homebrew/bin:$PATH npm run release:public -- --version X.Y.Z
```

The public `vX.Y.Z` tag must point to this clean download repository, not to the
private source tree. GitHub's automatic `Source code (zip/tar.gz)` links are
therefore safe because they contain only this repository's public metadata.
