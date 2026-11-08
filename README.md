# awol

AWS Out-of-Life: see which of your AWS components have gone absent without support.

## Environments and Projects

The dashboard can group Components by Environment, by Project, and by Product and Release Cycle. Each is turned on and off on its own, and any of them on at once nest in that order. Each AWS account chooses where awol reads them from in a file you write by hand, `~/.config/awol/accounts/<account ID>.json`. awol reads it on every page load, so a change shows without a new Scan. A Component with no Environment or Project goes in a group after all the others.

With no file, awol reads the tags `Environment` and `Project`, whatever the case of their keys, and folds the usual spellings into three Environments: PRD (`PROD`, `PRODUCTION`), STG (`STAG`, `STAGING`) and DEV (`DEVELOPMENT`). Names and aliases always match whatever their case, and tag values that differ only in case show the way most Components spell them. Any other file picks one of three strategies, and a file that names no `environments` gets the same three.

`fixed-tags` is the same as having no file:

```json
{ "strategy": "fixed-tags" }
```

`tags` reads the tag keys you name; a key you leave out gives no Environment, or no Project. Any tag value is an Environment or Project of its own, and aliases fold values into one name:

```json
{
  "strategy": "tags",
  "tagKeys": { "environment": "env", "project": "team" },
  "environments": { "PRD": ["production", "prod"], "STG": ["staging"] }
}
```

`identifier` reads no tags. It splits each Component's identifier (a Lambda function's name, without its version) on `-` and `_`, and a run of tokens that is one of the names or aliases you list, split the same way, whatever its case and wherever it sits, is that Environment or Project: `fe-client-area` matches `PROD-indie-fe-client-area-validatetraffic`. Only whole tokens match, the leftmost run wins, and of two runs starting at the same token, the longer one wins:

```json
{
  "strategy": "identifier",
  "environments": { "PRD": ["PROD"], "STG": ["STAG", "STAGING"], "DEV": [], "TEST": [], "ALL": [] },
  "projects": { "platform": [], "xavier": [], "accounting": [], "website": [] }
}
```

`environments` and `projects` are optional with every strategy; `environments`, when given, replaces the usual three. With either tag strategy, a Scan reads tags with one `resourcegroupstaggingapi get-resources` call per region, which needs `tag:GetResources` (part of `ReadOnlyAccess`). Tags that cannot be read keep their last successful read and show as Stale, as do that region's Components. A Scan under `identifier` reads no tags, so after switching from `identifier` to a tag strategy, Components have no Environment or Project until the next Scan. A file that is not one of these shapes, including one with an empty name or alias or, under `identifier`, one with nothing between two of its `-` or `_`, shows its error on the dashboard, and the table offers no Environment or Project grouping until it is fixed. Scans go on reading tags meanwhile, so a fixed tag configuration has them at once.
