var DEFAULT_LIMIT = 100;
var DEFAULT_MAX_LIMIT = 100;
var DEFAULT_MAX_QUERY_STRING_LENGTH = 100;
var MAX_SEARCH_EXPRESSION_LENGTH = 1000;

function hasOwn(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function createError(message, statusCode) {
  var error = new Error(message);
  error.statusCode = statusCode || 500;
  return error;
}

function parsePositiveInteger(value, fallback) {
  var number = Number(value);
  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }

  return Math.floor(number);
}

function quoteIdentifier(identifier, label) {
  if (identifier === undefined || identifier === null) {
    throw createError('Missing PostgreSQL identifier for ' + label + '.', 500);
  }

  var name = String(identifier).trim();

  if (!name || /\u0000/.test(name)) {
    throw createError('Invalid PostgreSQL identifier for ' + label + ': ' + name, 500);
  }

  return '"' + name.replace(/"/g, '""') + '"';
}

function quoteQualifiedIdentifier(parts, label) {
  return parts.map(function(part, index) {
    return quoteIdentifier(part, label + ' part ' + (index + 1));
  }).join('.');
}

function validateSearchExpression(searchExpression) {
  if (!searchExpression) {
    return '';
  }

  var expression = String(searchExpression).trim();

  if (expression.length > MAX_SEARCH_EXPRESSION_LENGTH || /;|--|\/\*|\*\/|\u0000/.test(expression)) {
    throw createError('Unsafe PostgreSQL searchExpression in search configuration.', 500);
  }

  return expression;
}

function quoteColumnReference(reference, defaultTableAlias) {
  var columnReference = String(reference || '').trim();
  var parts = columnReference.split('.');

  if (parts.length === 1) {
    return defaultTableAlias + '.' + quoteIdentifier(parts[0], 'field');
  }

  if (parts.length === 2) {
    return quoteIdentifier(parts[0], 'field table') + '.' + quoteIdentifier(parts[1], 'field');
  }

  throw createError('Invalid PostgreSQL field reference: ' + columnReference, 500);
}

function formatSelectableField(field, defaultTableAlias) {
  if (typeof field !== 'string') {
    throw createError('PostgreSQL fields must be configured as strings.', 500);
  }

  var trimmedField = field.trim();
  var aliasMatch = trimmedField.match(/^(.+?)\s+AS\s+(.+)$/i);

  if (aliasMatch) {
    return quoteColumnReference(aliasMatch[1], defaultTableAlias) + ' AS ' + quoteIdentifier(aliasMatch[2], 'field alias');
  }

  return quoteColumnReference(trimmedField, defaultTableAlias);
}

function buildFields(fields, defaultTableAlias) {
  if (!fields) {
    return '';
  }

  if (!Array.isArray(fields)) {
    throw createError('PostgreSQL fields must be configured as an array.', 500);
  }

  if (fields.length === 0) {
    return '';
  }

  return fields.map(function(field) {
    return formatSelectableField(field, defaultTableAlias);
  }).join(', ') + ', ';
}

function escapeLikePattern(value) {
  return value.replace(/[!%_]/g, function(match) {
    return '!' + match;
  });
}

function getSearchMode(queryOptions) {
  var searchMode = String(queryOptions.searchMode || queryOptions.matchMode || 'contains').toLowerCase();

  if (searchMode === 'prefix' || searchMode === 'startswith' || searchMode === 'starts_with') {
    return 'prefix';
  }

  if (searchMode === 'contains') {
    return 'contains';
  }

  throw createError('Invalid PostgreSQL searchMode: ' + searchMode, 500);
}

function buildSearchPattern(queryString, searchMode) {
  var escapedQueryString = escapeLikePattern(queryString);

  if (searchMode === 'prefix') {
    return escapedQueryString + '%';
  }

  return '%' + escapedQueryString + '%';
}

var pgDefault = function pgDefault(queryString, queryOptions, defaultLimit, maxQueryStringLength) {
  queryOptions = queryOptions || {};

  var schema = queryOptions.schema;
  var table = queryOptions.table;
  var customType = queryOptions.customType;
  var searchField = queryOptions.searchField;
  var searchExpression = validateSearchExpression(queryOptions.searchExpression);
  var gid = queryOptions.gid || 'gid';
  var fields = queryOptions.fields;
  var geometryField = queryOptions.geometryName || 'geom';
  var useCentroid = hasOwn(queryOptions, 'useCentroid') ? queryOptions.useCentroid : true;
  var maxLength = parsePositiveInteger(maxQueryStringLength || queryOptions.maxQueryStringLength, DEFAULT_MAX_QUERY_STRING_LENGTH);
  var searchValue = queryString === undefined || queryString === null ? '' : String(queryString).trim();

  if (searchValue.length > maxLength) {
    throw createError('queryString exceeds the maximum allowed length of ' + maxLength + ' characters.', 400);
  }

  var tableQualifier = quoteIdentifier(table, 'table');
  var tableReference = quoteQualifiedIdentifier([schema, table], 'table');
  var searchSql = searchExpression || (tableQualifier + '.' + quoteIdentifier(searchField, 'searchField'));
  var geometryReference = tableQualifier + '.' + quoteIdentifier(geometryField, 'geometryName');
  var gidReference = tableQualifier + '.' + quoteIdentifier(gid, 'gid');
  var sqlSearchField = 'CAST(' + searchSql + ' AS TEXT) AS "NAMN", ';
  var sqlFields = buildFields(fields, tableQualifier);
  var values = [];

  function addValue(value) {
    values.push(value);
    return '$' + values.length;
  }

  var typeValue = customType === undefined || customType === null ? table : String(customType);
  var type = addValue(typeValue) + ' AS "TYPE", ';
  var title = queryOptions.title ? addValue(String(queryOptions.title)) + ' AS "TITLE", ' : '';
  var wkt = useCentroid ? 'ST_AsText(ST_PointOnSurface(' + geometryReference + ')) AS "GEOM" ' :
    'ST_AsText(' + geometryReference + ') AS "GEOM" ';
  var configuredDefaultLimit = defaultLimit || queryOptions.defaultLimit || DEFAULT_LIMIT;
  var limitNumber = parsePositiveInteger(queryOptions.limit, parsePositiveInteger(configuredDefaultLimit, DEFAULT_LIMIT));
  var maxLimit = parsePositiveInteger(queryOptions.maxLimit, DEFAULT_MAX_LIMIT);
  var safeLimit = Math.min(limitNumber, maxLimit);
  var searchMode = getSearchMode(queryOptions);
  var searchPattern = buildSearchPattern(searchValue, searchMode);
  var prefixPattern = buildSearchPattern(searchValue, 'prefix');
  var searchPatternPlaceholder = addValue(searchPattern);
  var prefixPatternPlaceholder = addValue(prefixPattern);
  var limitPlaceholder = addValue(safeLimit);

  var searchString =
    'SELECT ' +
    sqlSearchField +
    gidReference + ' AS "GID", ' +
    sqlFields +
    type +
    title +
    wkt +
    ' FROM ' + tableReference +
    ' WHERE CAST(' + searchSql + ' AS TEXT) ILIKE ' + searchPatternPlaceholder + " ESCAPE '!'" +
    ' ORDER BY CASE WHEN CAST(' + searchSql + ' AS TEXT) ILIKE ' + prefixPatternPlaceholder + " ESCAPE '!' THEN 0 ELSE 1 END, " + searchSql +
    ' LIMIT ' + limitPlaceholder + ';';

  return {
    queryString: searchString,
    values: values
  };
};

module.exports = pgDefault;