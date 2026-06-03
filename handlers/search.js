var dbConfig = require('../conf/dbconfig');
var dbConnectors = require('../lib/dbconnectors');
var searchModel = dbConfig.models.search;
var dbType = require('../lib/dbtype');
var sendResponse = require('../lib/sendresponse');
var model = require('../models/dbmodels');

var getAllModelNames = function() {
  return Object.keys(searchModel);
}

var parseModelList = function(value) {
  if (Array.isArray(value)) {
    return value.reduce(function(result, item) {
      return result.concat(parseModelList(item));
    }, []);
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value.split(',')
    .map(function(modelName) {
      return modelName.trim();
    })
    .filter(Boolean);
}

var resolveModelNames = function(req) {
  var endpoint = req.searchEndpoint || (req.params && req.params.searchEndpoint);
  var searchEndpoints = dbConfig.searchEndpoints || {};

  if (endpoint) {
    if (!Object.prototype.hasOwnProperty.call(searchEndpoints, endpoint)) {
      return {
        error: {
          statusCode: 404,
          body: {
            error: 'Invalid search endpoint',
            endpoint: endpoint,
            allowedEndpoints: Object.keys(searchEndpoints)
          }
        }
      };
    }

    var endpointModels = searchEndpoints[endpoint];
    var endpointModelNames = parseModelList(endpointModels);

    if (endpointModels === '*' || endpointModelNames.indexOf('*') !== -1) {
      return {
        endpoint: endpoint,
        modelNames: getAllModelNames()
      };
    }

    return {
      endpoint: endpoint,
      modelNames: endpointModelNames
    };
  }

  if (req.query.model) {
    var queryModelNames = parseModelList(req.query.model);

    if (queryModelNames.indexOf('*') !== -1) {
      return {
        modelNames: getAllModelNames()
      };
    }

    return {
      modelNames: queryModelNames
    };
  }

  return {
    modelNames: getAllModelNames()
  };
}

var validateModelNames = function(modelNames, endpoint) {
  var invalidModelNames = modelNames.filter(function(modelName) {
    return !Object.prototype.hasOwnProperty.call(searchModel, modelName);
  });

  if (invalidModelNames.length) {
    return {
      statusCode: 400,
      body: {
        error: endpoint ? 'Invalid search endpoint configuration' : 'Invalid search model',
        endpoint: endpoint,
        invalidModels: invalidModelNames,
        allowedModels: getAllModelNames()
      }
    };
  }

  return null;
}

var sendError = function(res, statusCode, body) {
  if (!res.get('Access-Control-Allow-Origin')) {
    res.header('Access-Control-Allow-Origin', '*');
  }
  if (!res.get('Access-Control-Allow-Headers')) {
    res.header('Access-Control-Allow-Headers', 'Content-Type');
  }

  res.status(statusCode).json(body);
}

var search = function(req, res) {
  var query = req.query.q;
  var connectors = dbConfig.connectors.search;
  var resolvedModels = resolveModelNames(req);

  if (resolvedModels.error) {
    return sendError(res, resolvedModels.error.statusCode, resolvedModels.error.body);
  }

  var validationError = validateModelNames(resolvedModels.modelNames, resolvedModels.endpoint);

  if (validationError) {
    return sendError(res, validationError.statusCode, validationError.body);
  }

  if (!resolvedModels.modelNames.length) {
    return sendError(res, 400, {
      error: 'No search models configured for request',
      endpoint: resolvedModels.endpoint,
      allowedModels: getAllModelNames()
    });
  }

  var multiSearchModels = resolvedModels.modelNames.map(function(modelName) {
    return searchModel[modelName];
  });
  
  var finishedModels = 0;
  var mergedResult = [];
  multiSearchModels.forEach((multiSearchModel) => {
    var db = multiSearchModel.connector || dbType(connectors) || 'pg';
    var queries = [];
    var tables = req.query.layers || multiSearchModel.tables;
    tables.forEach((table) => {
      var options = Object.assign({}, connectors[db], multiSearchModel, table);
      options.limit = options.limit || dbConfig.limit;
      if (req.query.limit && req.query.c !== 'true') {
        options.limit = options.limit ? Math.min(options.limit, req.query.limit) : req.query.limit;
      } else {
        options.limit = options.limit || 100;
      }
      var searchString = model[db](query, options);
      queries.push({
        queryString: searchString
      });
    });

    var connector = Object.assign({}, connectors[db], multiSearchModel);
    dbConnectors[db](res, queries, connector)
      .then((result) => {
        mergedResult.push.apply(mergedResult, result);
        finishedModels += 1;
        if(finishedModels == multiSearchModels.length) {
          sendResponse(res, JSON.stringify(mergedResult));
        }
      });
  });
}

module.exports = search;
