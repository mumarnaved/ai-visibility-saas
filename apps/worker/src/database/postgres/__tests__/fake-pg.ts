import type {
  MigrationClient,
  MigrationFile,
  MigrationPool,
} from "../migration-runner.js";

/* ========================================
   FAKE POSTGRES

   Just enough of Postgres for the migration
   runner: schemas, relations, columns, CHECK
   constraints, extensions, schema_migrations
   rows, and real BEGIN/COMMIT/ROLLBACK
   (rollback restores a snapshot, so a file that
   fails midway really does leave nothing
   behind).

   The runner's own bookkeeping SQL is matched
   by shape. Anything else is treated as the
   text of a migration file: it is recorded in
   `ran` and interpreted by a small DDL reader
   that understands exactly what our .sql files
   use. A statement containing BOOM throws.
======================================== */

interface State {
  schemas: Set<string>;
  relations: Set<string>;
  columns: Set<string>;
  constraints: Map<string, string>;
  extensions: Set<string>;
  versions: Map<string, string[]>;
}

function emptyState(): State {
  return {
    schemas: new Set(),
    relations: new Set(),
    columns: new Set(),
    constraints: new Map(),
    extensions: new Set(),
    versions: new Map(),
  };
}

function cloneState(state: State): State {
  return {
    schemas: new Set(state.schemas),
    relations: new Set(state.relations),
    columns: new Set(state.columns),
    constraints: new Map(state.constraints),
    extensions: new Set(state.extensions),
    versions: new Map(
      [...state.versions].map(([k, v]) => [
        k,
        [...v],
      ])
    ),
  };
}

export interface TenantFixture {
  id: string;
  name: string;
  schema_name: string;
  status: string;
  manifest?: unknown;
}

export interface FakePgOptions {
  tenants?: TenantFixture[];
  /* Make manifest UPDATEs throw: all of them, or only for these tenant ids. */
  failManifestWrites?: boolean | string[];
  /* Simulate platform migration 009 not being applied yet. */
  noManifestColumn?: boolean;
  /* Throw when a migration file runs against this schema. */
  failSchemas?: string[];
}

const WRITE_STATEMENT =
  /^\s*(BEGIN|COMMIT|ROLLBACK|CREATE|INSERT|ALTER|DROP|UPDATE|DELETE|SET)/i;

export class FakePg implements MigrationPool {
  state: State = emptyState();

  /* Every migration-file SQL text executed. */
  ran: string[] = [];

  /* Schema each ran[] entry executed against. */
  ranOn: (string | null)[] = [];

  /* Every statement of any kind, in order. */
  log: string[] = [];

  private tenants: TenantFixture[];
  private failSchemas: Set<string>;
  private failManifestWrites: boolean | string[];
  private noManifestColumn: boolean;

  constructor(options: FakePgOptions = {}) {
    this.tenants = options.tenants ?? [];
    this.failSchemas = new Set(
      options.failSchemas ?? []
    );
    this.failManifestWrites =
      options.failManifestWrites ?? false;
    this.noManifestColumn =
      options.noManifestColumn ?? false;
  }

  addTenant(tenant: TenantFixture): void {
    this.tenants.push({ ...tenant });
  }

  /* Deep copy of the platform.tenants rows. */
  tenantRows(): TenantFixture[] {
    return structuredClone(this.tenants);
  }

  tenant(id: string): TenantFixture | undefined {
    return this.tenants.find((t) => t.id === id);
  }

  /* Statements that would change a real database. */
  writes(): string[] {
    return this.log.filter((sql) =>
      WRITE_STATEMENT.test(sql)
    );
  }

  snapshot(): State {
    return cloneState(this.state);
  }

  /*
   * Put a schema into the state an old
   * (pre-tracking) run would have left: the
   * files' objects exist, no schema_migrations.
   */
  seedLegacy(
    schema: string,
    kind: "tenant" | "platform",
    files: MigrationFile[]
  ): void {
    this.state.schemas.add(schema);

    for (const file of files) {
      this.interpret(
        file.sql,
        kind === "tenant" ? schema : null
      );
    }
  }

  async query(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: any[] }> {
    return this.execute(
      { searchPath: null, snapshot: null },
      sql,
      params
    );
  }

  async connect(): Promise<MigrationClient> {
    const ctx: Ctx = {
      searchPath: null,
      snapshot: null,
    };

    return {
      query: (sql, params) =>
        this.execute(ctx, sql, params),
      release: () => undefined,
    };
  }

  /* ---------------------------------------- */

  private execute(
    ctx: Ctx,
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: any[] }> {
    try {
      return Promise.resolve({
        rows: this.run(ctx, sql, params),
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private run(
    ctx: Ctx,
    sql: string,
    params: unknown[]
  ): any[] {
    const text = sql.trim();
    const s = this.state;

    this.log.push(text);

    if (/^BEGIN/i.test(text)) {
      ctx.snapshot = cloneState(s);
      return [];
    }

    if (/^COMMIT/i.test(text)) {
      ctx.snapshot = null;
      ctx.searchPath = null;
      return [];
    }

    if (/^ROLLBACK/i.test(text)) {
      if (ctx.snapshot) {
        this.state = ctx.snapshot;
      }

      ctx.snapshot = null;
      ctx.searchPath = null;
      return [];
    }

    if (/pg_advisory_xact_lock/.test(text)) {
      return [];
    }

    const setPath = text.match(
      /^SET LOCAL search_path TO "([^"]+)"/i
    );

    if (setPath) {
      ctx.searchPath = setPath[1];
      return [];
    }

    const createSchema = text.match(
      /^CREATE SCHEMA IF NOT EXISTS "([^"]+)"/i
    );

    if (createSchema) {
      s.schemas.add(createSchema[1]);
      return [];
    }

    if (/information_schema\.schemata/.test(text)) {
      return [
        { present: s.schemas.has(String(params[0])) },
      ];
    }

    if (/to_regclass/.test(text)) {
      /* "schema"."rel" or "schema".rel (unquoted table) */
      const match = String(params[0]).match(
        /^"([^"]+)"\.(?:"([^"]+)"|(\w+))$/
      );

      return [
        {
          present:
            !!match &&
            s.relations.has(
              `${match[1]}.${match[2] ?? match[3]}`
            ),
        },
      ];
    }

    if (/information_schema\.columns/.test(text)) {
      return [
        {
          present: s.columns.has(
            `${params[0]}.${params[1]}.${params[2]}`
          ),
        },
      ];
    }

    if (/pg_constraint/.test(text)) {
      const definition = s.constraints.get(
        `${params[0]}.${params[1]}.${params[2]}`
      );

      return [
        {
          present:
            definition !== undefined &&
            definition.includes(String(params[3])),
        },
      ];
    }

    if (/pg_extension/.test(text)) {
      return [
        { present: s.extensions.has(String(params[0])) },
      ];
    }

    const createTracking = text.match(
      /^CREATE TABLE IF NOT EXISTS "([^"]+)"\.schema_migrations/i
    );

    if (createTracking) {
      const schema = createTracking[1];

      if (!s.schemas.has(schema)) {
        throw new Error(
          `schema "${schema}" does not exist`
        );
      }

      s.relations.add(`${schema}.schema_migrations`);

      if (!s.versions.has(schema)) {
        s.versions.set(schema, []);
      }

      return [];
    }

    const selectVersions = text.match(
      /^SELECT version FROM "([^"]+)"\.schema_migrations$/i
    );

    if (selectVersions) {
      return (
        s.versions.get(selectVersions[1]) ?? []
      ).map((version) => ({ version }));
    }

    const selectOne = text.match(
      /^SELECT 1 FROM "([^"]+)"\.schema_migrations WHERE version/i
    );

    if (selectOne) {
      return (
        s.versions.get(selectOne[1]) ?? []
      ).includes(String(params[0]))
        ? [{ "?column?": 1 }]
        : [];
    }

    const insert = text.match(
      /^INSERT INTO "([^"]+)"\.schema_migrations/i
    );

    if (insert) {
      const rows = s.versions.get(insert[1]);

      if (!rows) {
        throw new Error(
          `relation "${insert[1]}.schema_migrations" does not exist`
        );
      }

      const version = String(params[0]);

      if (rows.includes(version)) {
        if (/ON CONFLICT/i.test(text)) {
          return [];
        }

        throw new Error(
          `duplicate key value violates unique constraint (${version})`
        );
      }

      rows.push(version);
      return [];
    }

    if (
      /^SELECT manifest FROM platform\.tenants WHERE id/i.test(
        text
      )
    ) {
      const row = this.tenant(String(params[0]));

      return row
        ? [{ manifest: row.manifest ?? null }]
        : [];
    }

    if (
      /^UPDATE platform\.tenants\s+SET manifest = /i.test(
        text
      )
    ) {
      if (
        this.failManifestWrites === true ||
        (Array.isArray(this.failManifestWrites) &&
          this.failManifestWrites.includes(
            String(params[0])
          ))
      ) {
        throw new Error("simulated manifest write failure");
      }

      const row = this.tenant(String(params[0]));

      /* Only honoured if the statement itself carries the guard. */
      const guarded = /AND manifest IS NULL/i.test(text);

      if (
        !row ||
        (guarded &&
          row.manifest !== null &&
          row.manifest !== undefined)
      ) {
        return [];
      }

      row.manifest = JSON.parse(String(params[1]));
      return [{ id: row.id }];
    }

    const setStatus = text.match(
      /^UPDATE platform\.tenants\s+SET\s+status = '(\w+)'/i
    );

    if (setStatus) {
      const row = this.tenant(String(params[0]));

      if (row) {
        row.status = setStatus[1];
      }

      return [];
    }

    if (/FROM platform\.tenants/i.test(text)) {
      if (
        this.noManifestColumn &&
        /manifest/.test(text)
      ) {
        throw new Error(
          'column "manifest" does not exist'
        );
      }

      return this.tenants.map((t) => ({
        ...t,
        manifest: t.manifest ?? null,
      }));
    }

    /* Anything else is a migration file. */
    this.ran.push(text);
    this.ranOn.push(ctx.searchPath);

    if (
      ctx.searchPath !== null &&
      this.failSchemas.has(ctx.searchPath)
    ) {
      throw new Error(
        `simulated failure on schema "${ctx.searchPath}"`
      );
    }

    this.interpret(text, ctx.searchPath);

    return [];
  }

  /*
   * Reads the DDL our migration files use.
   * `schemaDefault` is the search_path schema
   * (tenant files); platform files qualify
   * everything.
   */
  private interpret(
    sql: string,
    schemaDefault: string | null
  ): void {
    const s = this.state;

    const statements = sql
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ")
      .split(";")
      .map((statement) =>
        statement.replace(/\s+/g, " ").trim()
      )
      .filter(Boolean);

    const split = (
      name: string
    ): { schema: string; name: string } => {
      const parts = name.replace(/"/g, "").split(".");

      if (parts.length === 2) {
        return { schema: parts[0], name: parts[1] };
      }

      return {
        schema: schemaDefault ?? "public",
        name: parts[0],
      };
    };

    for (const statement of statements) {
      if (/\bBOOM\b/.test(statement)) {
        throw new Error("BOOM: simulated SQL failure");
      }

      let m: RegExpMatchArray | null;

      if (
        (m = statement.match(
          /^CREATE SCHEMA IF NOT EXISTS (\S+)/i
        ))
      ) {
        s.schemas.add(m[1].replace(/"/g, ""));
      } else if (
        (m = statement.match(
          /^CREATE TABLE IF NOT EXISTS (\S+)/i
        ))
      ) {
        const t = split(m[1]);

        if (!s.schemas.has(t.schema)) {
          throw new Error(
            `schema "${t.schema}" does not exist`
          );
        }

        s.relations.add(`${t.schema}.${t.name}`);
      } else if (
        (m = statement.match(
          /^CREATE INDEX IF NOT EXISTS (\S+) ON (\S+)/i
        ))
      ) {
        const table = split(m[2].replace(/\(.*/, ""));
        s.relations.add(`${table.schema}.${m[1]}`);
      } else if (
        (m = statement.match(
          /^CREATE EXTENSION IF NOT EXISTS (\S+)/i
        ))
      ) {
        s.extensions.add(m[1]);
      } else if (
        (m = statement.match(/^ALTER TABLE (\S+) (.*)$/i))
      ) {
        const table = split(m[1]);
        const clauses = m[2];

        for (const col of clauses.matchAll(
          /ADD COLUMN IF NOT EXISTS (\w+)/gi
        )) {
          s.columns.add(
            `${table.schema}.${table.name}.${col[1]}`
          );
        }

        for (const drop of clauses.matchAll(
          /DROP CONSTRAINT IF EXISTS (\w+)/gi
        )) {
          s.constraints.delete(
            `${table.schema}.${table.name}.${drop[1]}`
          );
        }

        const add = clauses.match(
          /ADD CONSTRAINT (\w+) (.*)$/i
        );

        if (add) {
          s.constraints.set(
            `${table.schema}.${table.name}.${add[1]}`,
            add[2]
          );
        }
      } else if (/^INSERT INTO /i.test(statement)) {
        /* data only; no schema effect to model */
      } else {
        throw new Error(
          `fake-pg cannot interpret: ${statement.slice(0, 80)}`
        );
      }
    }
  }
}

interface Ctx {
  searchPath: string | null;
  snapshot: State | null;
}
