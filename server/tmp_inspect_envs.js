const { query } = require('./src/db/index');
(async () => {
  try {
    const result = await query('SELECT TOP 10 id, firm_name, env_code, is_active FROM environments');
    console.log(JSON.stringify(result.recordset, null, 2));
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
})();
