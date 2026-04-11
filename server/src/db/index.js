const sql = require('mssql');
const logger = require('../utils/logger');

const config = {
  server: process.env.DB_SERVER || 'cads-brdge-db-final.database.windows.net',
  port: parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME || 'cads-bridge-db-final',
  user: process.env.DB_USER || 'cads-admin',
  password: process.env.DB_PASSWORD || 'passnahiata123!',
  options: {
    encrypt: process.env.DB_ENCRYPT !== 'false', // Azure requires encrypt=true
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== 'false',
    enableArithAbort: true,
  },
  pool: {
    max: process.env.VERCEL === '1' ? 5 : 20,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  connectionTimeout: 30000,
  requestTimeout: 30000,
};

let pool = null;

const getPool = async () => {
  if (!pool) {
    pool = await new sql.ConnectionPool(config).connect();
    pool.on('error', (err) => {
      logger.error('SQL Pool Error:', err);
      pool = null;
    });
    logger.info(`✅ SQL Server connected to ${config.server}/${config.database}`);
  }
  return pool;
};

const query = async (queryStr, params = {}) => {
  const p = await getPool();
  const request = p.request();
  Object.entries(params).forEach(([key, { type, value }]) => {
    request.input(key, type, value);
  });
  return request.query(queryStr);
};

const transaction = async (callback) => {
  const p = await getPool();
  const trans = new sql.Transaction(p);
  await trans.begin();
  try {
    const result = await callback(trans);
    await trans.commit();
    return result;
  } catch (err) {
    await trans.rollback();
    throw err;
  }
};

module.exports = { sql, getPool, query, transaction };
