# Environment and Project come from a per-account strategy

AWS has no notion of an Environment or a Project, and accounts label them in different ways, so each account picks where awol reads them from in a hand-edited file, `~/.config/awol/accounts/<account ID>.json`: tags with keys the user names, tags with the fixed keys `Environment` and `Project` (the default when there is no file), or the Component's identifier, parsed against a closed list of Environments and Projects with their aliases. The identifier strategy exists because some accounts never tagged their Components consistently but did name them consistently, and parsing names is the only read-only way to group those. awol works out Environment and Project when the dashboard renders, not during a Scan, so editing the file changes the groups without a new Scan.

## Considered Options

- **Tags only, with fixed keys**: no configuration at all, but it groups nothing in accounts whose tags use other keys or that rely on naming conventions instead of tags.
- **The AWS account as the Environment**: needs nothing, but the dashboard shows one account at a time, so it groups nothing within it.
- **Configuration kept in awol's data directory and edited from the dashboard**: one place for everything, but it mixes the user's configuration with state awol writes, and editing alias lists in a UI is a feature of its own.
