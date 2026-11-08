import { resourceNameOf, type Service, type Tags } from "./component.ts";

// Names of Environments or Projects, each with its aliases: the other names
// that mean it.
export type Names = Record<string, string[]>;

// Where an account's Environments and Projects come from (ADR 0003): tags,
// under the keys given for each, or each Component's identifier; and the
// names, with their aliases, that fold into each Environment and Project.
// From tags, any value is an Environment or Project of its own; from an
// identifier, only the names given are.
export type AccountConfig = {
  source: { kind: "tags"; environment?: string; project?: string } | { kind: "identifier" };
  environments: Names;
  projects: Names;
};

// The Environments of an account whose configuration names none: the usual
// spellings of production, staging and development.
const USUAL_ENVIRONMENTS: Names = { PRD: ["PROD", "PRODUCTION"], STG: ["STAG", "STAGING"], DEV: ["DEVELOPMENT"] };

// An account with no configuration file: Environments and Projects from the
// tags `Environment` and `Project`, with the usual Environments.
export const DEFAULT_ACCOUNT_CONFIG: AccountConfig = {
  source: { kind: "tags", environment: "Environment", project: "Project" },
  environments: USUAL_ENVIRONMENTS,
  projects: {},
};

// An account's configuration file, as its user writes it, or why it is not
// one: not JSON, not one of the three strategies' shapes, a name or alias
// that is empty, or, read from identifiers, one with nothing between two
// of its - or _. One that names no Environments has the usual ones.
//
//   { "strategy": "fixed-tags", "environments"?: Names, "projects"?: Names }
//   { "strategy": "tags", "tagKeys": { "environment"?: string, "project"?: string },
//     "environments"?: Names, "projects"?: Names }
//   { "strategy": "identifier", "environments"?: Names, "projects"?: Names }
export function parseAccountConfig(text: string): { config: AccountConfig } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { error: `not JSON: ${(error as Error).message}` };
  }
  if (!isObject(json)) return { error: "not a JSON object" };
  const { strategy, tagKeys, environments = USUAL_ENVIRONMENTS, projects = {}, ...rest } = json;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) return { error: `unknown field ${JSON.stringify(unknown[0])}` };
  for (const [field, names] of [["environments", environments], ["projects", projects]] as const) {
    if (!isNames(names)) return { error: `"${field}" is not an object of names, each with a list of aliases` };
    if (spellingsOf(names).some(({ spelling }) => spelling === "")) return { error: `"${field}" has an empty name or alias` };
    if (strategy !== "identifier") continue;
    const split = spellingsOf(names).find(({ spelling }) => tokensOf(spelling).includes(""));
    if (split !== undefined) {
      const which = split.spelling === split.name ? `the name ${JSON.stringify(split.name)}` : `the alias ${JSON.stringify(split.spelling)} of ${JSON.stringify(split.name)}`;
      return { error: `${which} has an empty part between - or _, so it can never match` };
    }
  }
  if (strategy === "fixed-tags" || strategy === "identifier") {
    if (tagKeys !== undefined) return { error: `"tagKeys" is only for the "tags" strategy` };
    const source = strategy === "identifier" ? ({ kind: "identifier" } as const) : DEFAULT_ACCOUNT_CONFIG.source;
    return { config: { source, environments: environments as Names, projects: projects as Names } };
  }
  if (strategy === "tags") {
    if (!isObject(tagKeys)) return { error: '"tagKeys" is missing, or not an object' };
    const { environment, project, ...other } = tagKeys;
    const unknownKeys = Object.keys(other);
    if (unknownKeys.length > 0) return { error: `unknown field ${JSON.stringify(unknownKeys[0])} in "tagKeys"` };
    if (![environment, project].every((key) => key === undefined || (typeof key === "string" && key !== ""))) {
      return { error: '"tagKeys" has a key that is not a string, or is empty' };
    }
    const source = { kind: "tags", environment: environment as string | undefined, project: project as string | undefined } as const;
    return { config: { source, environments: environments as Names, projects: projects as Names } };
  }
  return { error: `unknown "strategy" ${JSON.stringify(strategy)}: one of "fixed-tags", "tags" or "identifier"` };
}

// Whether `value` is a JSON object, not an array or null.
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Whether `value` is names, each with a list of aliases.
function isNames(value: unknown): value is Names {
  return isObject(value) && Object.values(value).every((aliases) => Array.isArray(aliases) && aliases.every((alias) => typeof alias === "string"));
}

// Every way `names` spell each name: the name itself, then its aliases.
function spellingsOf(names: Names): { name: string; spelling: string }[] {
  return Object.entries(names).flatMap(([name, aliases]) => [name, ...aliases].map((spelling) => ({ name, spelling })));
}

// A Component's Environment and Project, where it has them.
export type EnvironmentAndProject = { environment?: string; project?: string };

// The Environment and Project of the Component `identifier` of `service`,
// with `tags`, its tags, as `config` reads them.
//
// From tags, each is the value of its key, whatever the key's case, folded
// into the name it is an alias of, if any, whatever its case. A key the
// configuration does not give reads nothing.
//
// From an identifier, a Lambda function's name without its version, split
// into tokens on - and _, each is the name whose name or alias, split the
// same way, is a run of tokens, whatever its case: the run that starts at the
// first token any does, the longer of two starting there.
export function environmentAndProjectOf(
  config: AccountConfig,
  { service, identifier }: { service: Service; identifier: string },
  tags: Tags = {},
): EnvironmentAndProject {
  const { source, environments, projects } = config;
  if (source.kind === "tags") {
    return withoutUndefined({
      environment: nameOrValue(environments, tagValueOf(tags, source.environment)),
      project: nameOrValue(projects, tagValueOf(tags, source.project)),
    });
  }
  const tokens = tokensOf(resourceNameOf(service, identifier));
  return withoutUndefined({ environment: nameMatchedIn(environments, tokens), project: nameMatchedIn(projects, tokens) });
}

// The value of the tag `key` among `tags`, whatever the key's case, if
// there is a key.
function tagValueOf(tags: Tags, key: string | undefined): string | undefined {
  return key === undefined ? undefined : Object.entries(tags).find(([tagKey]) => tagKey.toLowerCase() === key.toLowerCase())?.[1];
}

// The name among `names` that the tag value `value` is, or is an alias of,
// whatever its case, or else `value` itself; nothing for an empty value.
function nameOrValue(names: Names, value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const lower = value.toLowerCase();
  return spellingsOf(names).find(({ spelling }) => spelling.toLowerCase() === lower)?.name ?? value;
}

// The name among `names` one of whose spellings, as tokens, is a run of
// `tokens`: the run that starts first, the longer of two starting together.
function nameMatchedIn(names: Names, tokens: string[]): string | undefined {
  const spellings = spellingsOf(names).map(({ name, spelling }) => ({ name, run: tokensOf(spelling) }));
  for (let start = 0; start < tokens.length; start++) {
    const matched = spellings.filter(({ run }) => run.every((token, index) => tokens[start + index] === token));
    if (matched.length > 0) return matched.reduce((longest, other) => (other.run.length > longest.run.length ? other : longest)).name;
  }
  return undefined;
}

// `text` split into tokens on - and _, in lower case.
function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/[-_]/);
}

// `rows` with each Environment, and each Project, that differs from another
// only in case spelled one way: the way most of them spell it, ties going to
// the first in code point order.
export function withCommonSpellings<T extends EnvironmentAndProject>(rows: T[]): T[] {
  const environments = commonSpellingsOf(rows.map((row) => row.environment));
  const projects = commonSpellingsOf(rows.map((row) => row.project));
  return rows.map((row) => ({
    ...row,
    ...withoutUndefined({
      environment: row.environment === undefined ? undefined : environments.get(row.environment.toLowerCase()),
      project: row.project === undefined ? undefined : projects.get(row.project.toLowerCase()),
    }),
  }));
}

// The way most of `values` spell each value, by the value in lower case,
// ties going to the first in code point order.
function commonSpellingsOf(values: (string | undefined)[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const value of values) {
    if (value === undefined) continue;
    const spellings = counts.get(value.toLowerCase()) ?? new Map<string, number>();
    spellings.set(value, (spellings.get(value) ?? 0) + 1);
    counts.set(value.toLowerCase(), spellings);
  }
  return new Map([...counts].map(([lower, spellings]) => [lower, [...spellings].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))[0]![0]]));
}

// `environmentAndProject` with only the ones it has.
function withoutUndefined({ environment, project }: EnvironmentAndProject): EnvironmentAndProject {
  return { ...(environment === undefined ? {} : { environment }), ...(project === undefined ? {} : { project }) };
}
