module.exports = {
  limit: 100,
  connectors: {
    search: {
      pg: {
        connectString: "",
        port: 5432,
      },
      mssql: {
        connectString: "",
      },
    },
  },
   models: {
    search: {
      search_verksamhet: {
        connector: "pg",
        database: "",
        user: "",
        password: "",
        schema: "sok_moa",
        gid: "idpkey",
        geometryName: "geom",
        useCentroid: false,
        tables: [
          {
            table: "sok_fast_sammanslaget",
            searchField: "sokfalt",
            title: "Fastigheter",
          },
          {
            table: "sok_adress",
            searchField: "CONCAT_WS(' | ', beladress , kommundel  ,fastighet)",
            title: "Adress",
          },
          {
            table: "sok_vagar",
            searchField: "sokfalt",
            title: "Vägar",
          },
          {
            table: "sok_platser",
            searchField: "sokfalt",
            title: "Platser",
          },
        ],
      },
      search_td: {
        connector: "pg",
        user: "",
        password: "",
        database: "",
        schema: "",
        gid: "td_id",
        geometryName: 'ST_Transform(geom,3006)',
        useCentroid: false,
        tables: [
          {
            table: "dp_plan_y",
            searchField: "CONCAT_WS(' | ', dp_plannummer , dp_aktnummer, dp_plannamn)",
            title: "Detaljplaner",
          },
        ],
      },
    },
  },
};
