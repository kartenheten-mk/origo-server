module.exports = {
  limit: 100,
  // Optional: controls the final /search result order by each row's TYPE value.
  // TYPE normally comes from a table's customType, or from the table name if customType is not set.
  // Types not listed here are still returned after the configured types, preserving their current relative order.
  searchResultTypeOrder: [
      'sok_fast',
      'sok_adress',
      'ortnamn'
  ],
  // Maps /search/:searchEndpoint to one or more models.search configs.
  // /search uses "default" if defined. A value of "*" includes every config in models.search.
  searchEndpoints: {
      // /search uses default and searches both search_verksamhet and search_myndighet.
      // /search/searchmora searches both search_verksamhet and search_myndighet.
      // /search/searchverksamhet searches only search_verksamhet.
      // /search/searchtd searches only search_myndighet.
      default: ['search_verksamhet', 'search_myndighet'],
      searchmora: ['search_verksamhet', 'search_myndighet'],
      searchverksamhet: ['search_verksamhet'],
      searchmyndighet: ['search_myndighet'],
      //searchall: '*'
  },
  connectors: {
      addressEstate: {
          mssql: {
            user: 'xxxxx',
            password: 'xxxxx',
            connectString: 'server name',
            database: 'database name'
          }
      },
      // Defines search connectors. If more than one connector is specified, each search model must specify which connector to use.
      // Multiple connectors of the same database type can use aliases with type, for example pg_verksamhet: { type: 'pg', ... }.
      search: {
          // PostgreSQL connector #1. Replace placeholder values with real credentials.
         pg_verksamhet: {
            type: 'pg',
            user: 'postgres_user_1',
            password: 'postgres_password_1',
            connectString: 'postgres_host_1',
            database: 'verksamhet',
            port: 5432
          },
          // PostgreSQL connector #2. Replace placeholder values with real credentials.
          pg_td: {
            type: 'pg',
            user: 'postgres_user_2',
            password: 'postgres_password_2',
            connectString: 'postgres_host_2',
            database: 'td_db',
            port: 5432
          }
          // ,
          // Example: enable this connector together with pg to search multiple database types.
          // When more than one connector is enabled, each model in models.search should set connector: 'pg', connector: 'mssql', etc.
          // mssql: {
          //   user: 'xxxxx',
          //   password: 'xxxxx',
          //   connectString: 'server name',
          //   database: 'database name'
          // }
      },
      singlesearch: {
          // oracle: {
          //     user: 'xxxxx',
          //     password: 'xxxxx',
          //     connectString: process.env.NODE_ORACLEDB_CONNECTIONSTRING || 'server name:1521/orcl'
          // }
          // mssql: {
          //   user: 'xxxxx',
          //   password: 'xxxxx',
          //   connectString: 'server name',
          //   database: 'database name'
          // }
          pg: {
            user: 'postgres',
            password: 'postgres',
            connectString: 'localhost',
            database: 'rtj',
            port: 5432
          }
      }
  },
  models: {
      singlesearch: {
          // search: {
          //     table: 'table name',
          //     searchField: 'search field name',
          //     schema: 'schema name, for example dbo',
          //     database: 'database name',
          //     useCentroid: true
          // }
          search: {
              table: 'fastighetsytor_sammanslagen',
              searchField: 'FASTIGHET',
              schema: 'public',
              geometryName: 'geom',
              useCentroid: true
          }

      },
      search: {
        // Search config using the pg_verksamhet connector alias above.
        search_verksamhet: {
          connector: 'pg_verksamhet',
          tables: [
            {
              table: 'sok_adress',
              searchExpression: "CONCAT_WS(' | ', beladress, kommundel, fastighet)",
              schema: 'sok',
              geometryName: 'geom',
              title: 'Adress',
              gid: 'gid',
              useCentroid: false
            },
            {
              table: 'sok_fast',
              searchField: 'sokfalt',
              schema: 'sok_moa',
              geometryName: 'geom',
              title: 'Fastigheter',
              gid: 'id',
              useCentroid: false
            }
          ]
        },
        // Search config using the pg_myndighet connector alias above.
        search_myndighet: {
          connector: 'pg_myndighet',
          tables: [
            {
              table: 'ortnamn',
              // customType: 'td',
              searchExpression: "CONCAT_WS(' | ', ortnamn , sockenstadnamn)",
              schema: 'lm',
              geometryName: 'geom',
              title: 'Plats',
              gid: 'id',
              useCentroid: false
            }
          ]
        }
     },
      addressEstate: {
          addresses: {
              table: 'table name',
              searchField: 'search field name',
              schema: 'schema name, for example dbo',
              database: 'database name',
              useCentroid: true,
              fields: ['field name', 'field name']
          },
          estates: {
              table: 'table name',
              searchField: 'search field name',
              schema: 'schema name, for example dbo',
              database: 'database name',
              useCentroid: true,
              fields: ['field name', 'field name']
          }
      }
  }
};
