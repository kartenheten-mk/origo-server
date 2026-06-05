var dbConfig = require('../conf/dbconfig');
var dbConnectors = require('../lib/dbconnectors');
var dbType = require('../lib/dbtype');
var sendResponse = require('../lib/sendresponse');
var model = require('../models/dbmodels');

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

var singleSearch = function(req, res) {
  var query = req.query.q;
  var connector = dbConfig.connectors.singlesearch;
  var searchModel = dbConfig.models.singlesearch.search;

  searchModel.limit = searchModel.limit || dbConfig.limit;
  if (req.query.limit) {
    searchModel.limit = searchModel.limit ? Math.min(searchModel.limit, req.query.limit) : req.query.limit;
  } else {
    searchModel.limit = searchModel.limit || 100;
  }

  var db = dbType(connector);
  var dbModel = model[db];
  var queryResult;

  try {
    queryResult = normalizeQueryResult(dbModel(query, searchModel));
  } catch (err) {
    sendError(res, err.statusCode || 500, err.message || 'Failed to build search query');
    return;
  }

  var queries = [];

  queries.push(queryResult);

  dbConnectors[db](res, queries, connector[db])
    .then(function(result) {
      sendResponse(res, JSON.stringify(result));
    });

};

module.exports = singleSearch;
