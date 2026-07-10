'use strict';

/**
 * tbproxy.js – ThingsBoard authentication + transparent reverse proxy
 *
 * Combines the former tbauth.js (JWT token management) and tbfullproxy.js
 * (express-http-proxy middleware) into a single module.
 *
 * Exports
 * -------
 *   module.exports.proxy      – express-http-proxy middleware (or null when TB
 *                               is not configured). Mount in app.js:
 *                                 const tbProxy = require('./handlers/tbproxy');
 *                                 if (tbProxy.proxy) {
 *                                   app.use('/tb',     tbProxy.proxy);
 *                                   app.use('/assets', tbProxy.proxy);
 *                                   …
 *                                 }
 *
 *   module.exports.handler    – Express route handler that returns a fresh JWT
 *                               to the caller. Mounted at GET /origoserver/tbauth.
 *
 *   module.exports.getTokens  – async helper that returns { token, refreshToken }.
 *                               Used internally by the proxy and available to any
 *                               other handler that needs a valid TB token.
 *
 * The proxy middleware:
 *   • Forwards ALL requests to the configured ThingsBoard server.
 *   • Automatically injects a valid JWT into every outgoing request header.
 *   • For HTML responses (dashboard pages) it rewrites <base href> so that the
 *     ThingsBoard Angular SPA resolves its sub-requests back through this proxy,
 *     and injects a <script> that pre-loads the JWT into localStorage.
 *   • Rewrites redirect Location headers back through the proxy path.
 */

const axios = require('axios');
const proxy = require('express-http-proxy');
const conf  = require('../conf/config');

const REFRESH_BUFFER = 2 * 60 * 1000; // 2 minutes in ms

// ---- Auth state (module-level singleton) --------------------------------
let jwtToken     = null;
let refreshToken = null;
let expiryTime   = 0;

// ---- Auth helpers -------------------------------------------------------

/**
 * Decode a JWT and return the expiry timestamp in milliseconds.
 */
function getJwtExpiry(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString()
    );
    return payload.exp * 1000;
  } catch (e) {
    return 0;
  }
}

/**
 * Login to ThingsBoard using configured credentials.
 */
async function login(tbConf) {
  const res = await axios.post(`${tbConf.url}/api/auth/login`, {
    username: tbConf.username,
    password: tbConf.password
  });
  jwtToken     = res.data.token;
  refreshToken = res.data.refreshToken;
  expiryTime   = getJwtExpiry(jwtToken);
  console.log('ThingsBoard: logged in, token expires at', new Date(expiryTime).toISOString());
}

/**
 * Refresh the JWT using the stored refresh token.
 */
async function refreshJwt(tbConf) {
  const res = await axios.post(`${tbConf.url}/api/auth/token`, {
    refreshToken: refreshToken
  });
  jwtToken     = res.data.token;
  refreshToken = res.data.refreshToken;
  expiryTime   = getJwtExpiry(jwtToken);
  console.log('ThingsBoard: token refreshed, new expiry at', new Date(expiryTime).toISOString());
}

/**
 * Return a valid JWT token, refreshing or re-logging in as needed.
 */
async function getValidToken(tbConf) {
  const now = Date.now();

  if (jwtToken && now < expiryTime - REFRESH_BUFFER) {
    return jwtToken;
  }

  if (refreshToken) {
    try {
      await refreshJwt(tbConf);
      return jwtToken;
    } catch (e) {
      console.log('ThingsBoard: refresh failed, logging in again...', e.message);
    }
  }

  await login(tbConf);
  return jwtToken;
}

// ---- Public: getTokens --------------------------------------------------

/**
 * Return a valid { token, refreshToken } pair.
 * Used by the proxy middleware internally and available to external callers.
 */
module.exports.getTokens = async function getTokens() {
  const tbConf = conf['thingsboard'];
  if (!tbConf || !tbConf.url || !tbConf.username || !tbConf.password) {
    throw new Error('ThingsBoard proxy not configured');
  }
  const token = await getValidToken(tbConf);
  return { token, refreshToken };
};

// ---- Public: handler (GET /origoserver/tbauth) --------------------------

/**
 * Express route handler: authenticates with ThingsBoard and returns the JWT
 * to the caller for direct use against the ThingsBoard API.
 *
 * GET /origoserver/tbauth
 *
 * Response: { token: <jwt>, refreshToken: <refreshJwt> }
 */
module.exports.handler = async function tbAuth(req, res) {
  const tbConf = conf['thingsboard'];

  if (!tbConf || !tbConf.url || !tbConf.username || !tbConf.password) {
    console.log('ThingsBoard: missing configuration (thingsboard.url / .username / .password)');
    res.status(500).json({ error: 'ThingsBoard proxy not configured' });
    return;
  }

  try {
    const token = await getValidToken(tbConf);
    res.json({ token, refreshToken });
  } catch (err) {
    console.log('ThingsBoard: authentication failed:', err.message);
    res.status(502).json({ error: 'ThingsBoard authentication failed', details: err.message });
  }
};

// ---- Public: proxy middleware -------------------------------------------

const tbConf = conf['thingsboard'];

if (!tbConf || !tbConf.url) {
  console.log('tbproxy: thingsboard not configured – proxy not mounted');
  module.exports.proxy = null;
} else {
  const TB_URL = tbConf.url; // e.g. "https://thingsboard.iot.kurbit.se"

  module.exports.proxy = proxy(TB_URL, {

    // ---- Resolve the forwarded path --------------------------------------
    // When mounted at /tb Express strips that prefix, so req.url is correct.
    // When mounted at /assets, /api, /static etc. the prefix is also stripped,
    // so we must restore it by using req.originalUrl.
    proxyReqPathResolver: function (req) {
      if (req.originalUrl.startsWith('/tb/') || req.originalUrl === '/tb') {
        return req.url; // prefix already stripped correctly by express
      }
      return req.originalUrl; // absolute TB path — keep full path
    },

    // ---- Inject JWT auth header for every outgoing request ---------------
    proxyReqOptDecorator: async function (proxyReqOpts) {
      try {
        const { token } = await module.exports.getTokens();
        proxyReqOpts.headers['X-Authorization'] = `Bearer ${token}`;
        // Remove any host / origin headers that could confuse ThingsBoard
        proxyReqOpts.headers['host'] = new URL(TB_URL).host;
      } catch (e) {
        console.error('tbproxy: could not obtain token:', e.message);
      }
      return proxyReqOpts;
    },

    // ---- For HTML pages: rewrite base href and inject JWT into storage ---
    userResDecorator: async function (proxyRes, proxyResData, userReq, userRes) {
      const ct = proxyRes.headers['content-type'] || '';
      if (!ct.includes('text/html')) {
        return proxyResData;
      }

      try {
        const { token, refreshToken: rt } = await module.exports.getTokens();
        let html = proxyResData.toString('utf8');

        // 1. Rewrite <base href="..."> so the Angular SPA's relative-path
        //    requests stay inside our /tb proxy.
        html = html.replace(
          /(<base\s[^>]*href=")[^"]*"/i,
          '$1/tb/"'
        );

        // 2. Inject a script that pre-loads the JWT into localStorage.
        //    ThingsBoard reads 'jwt_token' on startup to authenticate.
        const inject = '<script>' +
          'try{' +
          'localStorage.setItem(\'jwt_token\',\'' + token + '\');' +
          'localStorage.setItem(\'refresh_token\',\'' + (rt || '') + '\');' +
          '}catch(e){}' +
          '</script>';
        html = html.replace(/<\/head>/i, inject + '</head>');

        return html;
      } catch (e) {
        console.error('tbproxy: html decoration failed:', e.message);
        return proxyResData;
      }
    },

    // ---- Rewrite redirect Location headers back through our proxy --------
    userResHeaderDecorator: function (headers, userReq, userRes, proxyReq, proxyRes) {
      if (headers['location']) {
        headers['location'] = headers['location']
          .replace(TB_URL, '')       // strip absolute origin
          .replace(/^\//, '/tb/');   // prefix with /tb/
      }
      return headers;
    }

  });
}
