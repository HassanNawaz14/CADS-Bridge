require('dotenv').config();
const { sql, poolPromise } = require('./index');

async function fixConstraints() {
  try {
    const pool = await poolPromise;
    console.log('Connected to Azure SQL. Fixing constraints...');

    // Drop team constraint
    console.log('1. Dropping existing team constraint...');
    await pool.request().query(`
      DECLARE @TeamConstraintName nvarchar(200)
      SELECT @TeamConstraintName = name FROM sys.check_constraints
      WHERE parent_object_id = object_id('users') AND definition LIKE '%team%'

      IF @TeamConstraintName IS NOT NULL
      BEGIN
          EXEC('ALTER TABLE users DROP CONSTRAINT ' + @TeamConstraintName)
      END
    `);

    // Add new team constraint
    console.log('2. Applying new team constraint (CA, DS, NA)...');
    await pool.request().query(`
      ALTER TABLE users ADD CONSTRAINT chk_users_team CHECK (team IN ('CA', 'DS', 'NA'));
    `);

    // Drop role constraint
    console.log('3. Dropping existing role constraint...');
    await pool.request().query(`
      DECLARE @RoleConstraintName nvarchar(200)
      SELECT @RoleConstraintName = name FROM sys.check_constraints
      WHERE parent_object_id = object_id('users') AND definition LIKE '%role%'

      IF @RoleConstraintName IS NOT NULL
      BEGIN
          EXEC('ALTER TABLE users DROP CONSTRAINT ' + @RoleConstraintName)
      END
    `);

    // Add new role constraint
    console.log('4. Applying new role constraint...');
    await pool.request().query(`
      ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('member','admin','platform_admin','super_admin'));
    `);

    console.log('✅ Constraints updated successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to update constraints:', err.message);
    process.exit(1);
  }
}

fixConstraints();
