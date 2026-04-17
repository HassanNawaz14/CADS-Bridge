require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const sql = require('mssql');
const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

(async () => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='projects' ORDER BY ORDINAL_POSITION");
    console.log('COLUMNS:', result.recordset.map(r => r.COLUMN_NAME).join(', '));
    await pool.close();
  } catch (err) {
    console.error('CHECK ERROR:', err);
    process.exit(1);
  }
})();