var dbConfig = require('../conf/dbconfig');
var dbConnectors = require('../lib/dbconnectors');
var searchModel = require('../conf/dbconfig').models.search;
var sendResponse = require('../lib/sendresponse');
var model = require('../models/dbmodels');

function hasOwn(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function sendError(res, statusCode, message) {
  var result = JSON.stringify({
    error: message
  });

  if (!res.get('Access-Control-Allow-Origin')) {
    res.header('Access-Control-Allow-Origin', '*');
  }
  if (!res.get('Access-Control-Allow-Headers')) {
    res.header('Access-Control-Allow-Headers', 'Content-Type');
  }

  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(result)
  });
  res.end(result);
}

function normalizeQueryResult(queryResult) {
  if (queryResult && typeof queryResult === 'object' && queryResult.queryString) {
    return queryResult;
  }

  return {
    queryString: queryResult
  };
}

function getResultType(result) {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  if (hasOwn(result, 'TYPE')) {
    return result.TYPE;
  }

  if (hasOwn(result, 'type')) {
    return result.type;
  }
}

function buildResultTypeOrderMap(resultTypeOrder) {
  var orderMap = {};

  if (!Array.isArray(resultTypeOrder)) {
    return orderMap;
  }

  resultTypeOrder.forEach(function(type, index) {
    if (type === undefined || type === null) {
      return;
    }

    var typeName = String(type);
    if (!hasOwn(orderMap, typeName)) {
      orderMap[typeName] = index;
    }
  });

  return orderMap;
}

function sortSearchResultsByType(results, resultTypeOrder) {
  if (!Array.isArray(results) || !Array.isArray(resultTypeOrder) || resultTypeOrder.length === 0) {
    return results;
  }

  var orderMap = buildResultTypeOrderMap(resultTypeOrder);
  var fallbackOrder = resultTypeOrder.length;

  return results.map(function(result, index) {
    var type = getResultType(result);
    var typeName = type === undefined || type === null ? undefined : String(type);

    return {
      result: result,
      index: index,
      order: typeName !== undefined && hasOwn(orderMap, typeName) ? orderMap[typeName] : fallbackOrder
    };
  }).sort(function(a, b) {
    if (a.order !== b.order) {
      return a.order - b.order;
    }

    return a.index - b.index;
  }).map(function(item) {
    return item.result;
  });
}

function getAllSearchModelNames() {
  return Object.keys(searchModel || {});
}

function getDefaultConnectorName(connectors) {
  if (hasOwn(connectors, 'mssql')) {
    return 'mssql';
  } else if (hasOwn(connectors, 'oracle')) {
    return 'oracle';
  } else if (hasOwn(connectors, 'pg')) {
    return 'pg';
  }

  var connectorNames = Object.keys(connectors || {});
  if (connectorNames.length === 1) {
    return connectorNames[0];
  }
}

function resolveConnector(searchModelConfig, connectors) {
  var connectorName = searchModelConfig.connector || getDefaultConnectorName(connectors) || 'pg';
  var connectorConfig = connectors[connectorName];

  if (!connectorConfig) {
    return {
      error: "Database connector '" + connectorName + "' is not defined for search"
    };
  }

  return {
    name: connectorName,
    config: connectorConfig,
    db: connectorConfig.type || connectorName
  };
}

function normalizeEndpointConfig(endpointConfig, endpointName) {
  var modelNames;

  if (endpointConfig === '*') {
    modelNames = getAllSearchModelNames();
  } else if (Array.isArray(endpointConfig)) {
    modelNames = endpointConfig;
  } else if (typeof endpointConfig === 'string') {
    modelNames = [endpointConfig];
  } else {
    return {
      statusCode: 500,
      error: "Search endpoint '" + endpointName + "' must be configured as an array, string or '*'"
    };
  }

  if (modelNames.length === 0) {
    return {
      statusCode: 500,
      error: "Search endpoint '" + endpointName + "' does not reference any search models"
    };
  }

  return {
    modelNames: modelNames
  };
}

function getEndpointModelNames(endpointName) {
  var searchEndpoints = dbConfig.searchEndpoints;

  if (endpointName) {
    if (searchEndpoints && hasOwn(searchEndpoints, endpointName)) {
      return normalizeEndpointConfig(searchEndpoints[endpointName], endpointName);
    }

    if (!searchEndpoints && hasOwn(searchModel, endpointName)) {
      return {
        modelNames: [endpointName]
      };
    }

    return {
      statusCode: 404,
      error: "Search endpoint '" + endpointName + "' is not defined"
    };
  }

  if (searchEndpoints && hasOwn(searchEndpoints, 'default')) {
    return normalizeEndpointConfig(searchEndpoints.default, 'default');
  }

  if (hasOwn(searchModel, 'search')) {
    return {
      modelNames: ['search']
    };
  }

  return {
    modelNames: getAllSearchModelNames()
  };
}

function getEndpointSearchModels(endpointName) {
  var endpointModelNames = getEndpointModelNames(endpointName);
  var models = [];

  if (endpointModelNames.error) {
    return endpointModelNames;
  }

  for (var i = 0; i < endpointModelNames.modelNames.length; i++) {
    var modelName = endpointModelNames.modelNames[i];
    if (!hasOwn(searchModel, modelName)) {
      return {
        statusCode: 500,
        error: "Search model '" + modelName + "' referenced by endpoint '" + (endpointName || 'default') + "' is not defined"
      };
    }

    models.push({
      name: modelName,
      config: searchModel[modelName]
    });
  }

  return {
    models: models
  };
}

var search = function(req, res) {
  var query = req.query.q;
  var searchEndpoint = req.params.searchEndpoint;
  var connectors = dbConfig.connectors.search;
  var endpointSearchModels = getEndpointSearchModels(searchEndpoint);

  if (endpointSearchModels.error) {
    sendError(res, endpointSearchModels.statusCode, endpointSearchModels.error);
    return;
  }

  if (!connectors) {
    sendError(res, 500, 'Search connector is not defined');
    return;
  }

  var multiSearchModels = endpointSearchModels.models;
  var modelQueries = [];

  for (var i = 0; i < multiSearchModels.length; i++) {
    var multiSearchModel = multiSearchModels[i].config;
    var connector = resolveConnector(multiSearchModel, connectors);
    if (connector.error) {
      sendError(res, 500, connector.error);
      return;
    }

    var db = connector.db;
    var queries = [];
    var tables = req.query.layers || multiSearchModel.tables;

    if (!model[db]) {
      sendError(res, 500, "Search model generator for database type '" + db + "' is not defined");
      return;
    }

    if (!dbConnectors[db]) {
      sendError(res, 500, "Database connector handler for database type '" + db + "' is not defined");
      return;
    }

    if (!Array.isArray(tables)) {
      sendError(res, 500, "Search model '" + multiSearchModels[i].name + "' does not define any tables");
      return;
    }

    var modelError;

    tables.forEach(function(table) {
      if (modelError) {
        return;
      }

      var options = Object.assign({}, connector.config, multiSearchModel, table);
      options.limit = options.limit || dbConfig.limit;
      if (req.query.limit && req.query.c !== 'true') {
        options.limit = options.limit ? Math.min(options.limit, req.query.limit) : req.query.limit;
      } else {
        options.limit = options.limit || 100;
      }

      try {
        queries.push(normalizeQueryResult(model[db](query, options)));
      } catch (err) {
        modelError = err;
      }
    });

    if (modelError) {
      sendError(res, modelError.statusCode || 500, modelError.message || 'Failed to build search query');
      return;
    }

    modelQueries.push({
      name: multiSearchModels[i].name,
      db: db,
      queries: queries,
      connector: Object.assign({}, connector.config, multiSearchModel)
    });
  }

  if (modelQueries.length === 0) {
    sendResponse(res, JSON.stringify([]));
    return;
  }

  var finishedModels = 0;
  var mergedResult = [];
  var responseSent = false;

  modelQueries.forEach(function(modelQuery) {
    dbConnectors[modelQuery.db](res, modelQuery.queries, modelQuery.connector)
      .then(function(result) {
        if (responseSent) {
          return;
        }
        mergedResult.push.apply(mergedResult, result);
        finishedModels += 1;
        if (finishedModels === modelQueries.length) {
          responseSent = true;
          sendResponse(res, JSON.stringify(sortSearchResultsByType(mergedResult, dbConfig.searchResultTypeOrder)));
        }
      })
      .catch(function(err) {
        console.log(err);
        if (!responseSent) {
          responseSent = true;
          sendError(res, 500, "Search failed for model '" + modelQuery.name + "'");
        }
      });
  });
}

module.exports = search;
