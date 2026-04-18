/* eslint-disable no-console */
require('dotenv').config();

const { query } = require('../db');

async function main() {
  const count = await query(
    "SELECT COUNT(1) as total, SUM(CASE WHEN status='PUBLISHED' THEN 1 ELSE 0 END) as published FROM glossary_terms"
  );
  console.log(count.recordset[0]);

  const sample = await query(
    "SELECT TOP 5 id, term, status, created_at FROM glossary_terms ORDER BY created_at DESC"
  );
  console.log(sample.recordset);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

