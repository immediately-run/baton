# Tickets

This repository's tickets are the `*.mdx` files in this folder (finished ones move to
`archive/`). How tickets work — ids, frontmatter, claiming — is [home.mdx](home.mdx);
the board view lives there. `baton repo init` wrote this file; `.baton/tickets.mjs` is
the source the sync reads (it skips `projects/` and `home.mdx`, which are wiki pages,
not tickets).
