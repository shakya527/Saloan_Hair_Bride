require('dotenv').config();
const { pool } = require('./db');

async function testAll() {
  const sql = `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` INT AUTO_INCREMENT PRIMARY KEY,
    \`name\` VARCHAR(120) NOT NULL,
    \`email\` VARCHAR(180) NOT NULL UNIQUE,
    \`phone\` VARCHAR(20) NOT NULL UNIQUE,
    \`password_hash\` VARCHAR(255) NOT NULL,
    \`role\` ENUM('client', 'admin') DEFAULT 'client' NOT NULL,
    \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;

  try {
    await pool.query(sql);
    console.log('✅ Users table created!');
  } catch (err) {
    console.error('Caught in test:', err.message);
  }
}

testAll();
