# Vendored muse2api

This folder is a pinned copy of [muse2api](https://github.com/czg86389-hub/muse2api),
the service this plugin sets up and talks to.

- Source commit: `cfcfee41d083cfcf67b1d596c90f2c5e69f63031`
- Vendored: 2026-10-12
- License: MIT, © the muse2api authors — see `LICENSE` in this folder.

Only the files the service needs at runtime are included: its Python
sources, the admin page, requirements, the container files, the
cookie-import tool and the browser extension its admin page offers.
Its tests, docs and deployment extras are not.

The butler installs this copy, so setup needs no GitHub download.
The version moves only when a plugin release deliberately bumps it,
which keeps the plugin tested against exactly the engine it ships.
