/**
 * Constructs a SQL query string for searching in a PostgreSQL database.
 * This version uses sanitization instead of parameterization to mitigate SQL injection.
 * **Important: Sanitization is not as secure as parameterized queries. Use with caution.**
 *
 * @param {string} queryString The string to search for.
 * @param {object} queryOptions An object containing query parameters.
 * @param {string} queryOptions.schema The database schema.
 * @param {string} queryOptions.table The table to search in.
 * @param {string} queryOptions.searchField The field to search within.
 * @param {string[]} [queryOptions.fields] An array of additional fields to include in the result.
 * @param {string} [queryOptions.gid='gid'] The name of the geometry id field.
 * @param {number} [queryOptions.limit] The maximum number of results to return.
 * @param {number} defaultLimit The default limit to use if `queryOptions.limit` is not specified.
 * @param {number} [maxQueryStringLength=255] The maximum length of the queryString allowed. Defaults to 255.
 * @returns {string} The constructed SQL query string.
 * @throws {Error} If the queryString exceeds the maxQueryStringLength.
 */
var pgDefault = function pgDefault(queryString, queryOptions, defaultLimit, maxQueryStringLength = 100) {
    // Destructure the queryOptions object for easy access to its properties, also set default values using destructuring
    const { schema, table, searchField, fields, gid = 'gid', limit: queryLimit } = queryOptions;
  
    // Determine the limit number, using the provided limit, default limit, or 100 as a fallback
    const limitNumber = queryLimit || defaultLimit || 100;
  
      // Check if the queryString exceeds the maximum allowed length
    if (queryString && queryString.length > maxQueryStringLength) {
       // Throw an error if the queryString is too long
      throw new Error(`queryString exceeds the maximum allowed length of ${maxQueryStringLength} characters.`);
    }
  
  
    // Sanitize the queryString to prevent basic SQL injection attempts by removing potentially dangerous characters
      // Converts input to string to handle numbers and other types, and then replaces characters with an empty string.
    const sanitizedQueryString = String(queryString).replace(/['";`%*#@]/g, '');
  
      // Construct the SQL fragment for the search field. If it exist, add "CAST(searchField AS TEXT) AS "NAMN"," if not just "".
    const sqlSearchField = searchField ? `CAST(${searchField} AS TEXT) AS "NAMN",` : "";
  
      // Construct the SQL fragment for the additional fields, if provided. If fields exist, join the fields with a comma, otherwise "".
    const sqlFields = fields ? fields.join(',') + "," : "";
  
    // Construct the SQL fragment for the table type with single quotes around the table name.
    const type = ` '${table}' AS "TYPE", `;
  
    // Construct the SQL fragment for the GEOM field, setting it to NULL
    const geom = ` NULL as "GEOM" `;
  
    // Construct the SQL fragment for the limit, adding the word "LIMIT" with the limitNumber
    const limit = ` LIMIT ${limitNumber}`;
  
  
    // Construct the complete SQL query string using template literals for readability.
    // Inserts all the constructed SQL fragments from the above variables into the SQL template
	// Prioritize entries where the search field starts with the provided prefix
    const searchString = `
      SELECT
         ${sqlSearchField}
         ${gid} AS "GID",
         ${sqlFields}
         ${type}
         ${geom}
      FROM ${schema}.${table}
      WHERE ${searchField} ILIKE '%${sanitizedQueryString}%'
      ${searchField ? `ORDER BY CASE WHEN ${searchField} ILIKE '${sanitizedQueryString}%' THEN 0 ELSE 1 END, ${searchField}` : ""}
      ${limit};
    `;
  
    // Return the constructed SQL query string
    return searchString;
  };
  
  // Export the pgDefault function so it can be used in other modules.
  module.exports = pgDefault;