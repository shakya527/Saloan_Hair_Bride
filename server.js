/**
 * =========================================================================
 * SALON HAIR BRIDE — PRODUCTION-READY BACKEND API & MYSQL DATABASE SERVER
 * Stack: Node.js • Express • MySQL / phpMyAdmin (mysql2) • JWT • Bcrypt
 * Database: salon_db (Host: localhost | User: root | Password: '')
 * =========================================================================
 */

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'salon_hair_bride_super_secure_secret_key_2026';

// =========================================================================
// NOTIFICATION CONFIGURATION (Gmail SMTP + UltraMsg WhatsApp)
// =========================================================================

// Gmail SMTP Transporter (via Nodemailer)
const gmailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'salonhairbride@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD  // Gmail App Password (not account password)
  }
});

// UltraMsg WhatsApp API Config
const ULTRAMSG_CONFIG = {
  instanceId : process.env.ULTRAMSG_INSTANCE_ID || 'instance193239',
  token      : process.env.ULTRAMSG_TOKEN || 'rf7wg9t9uiklsf2a',
  apiBase    : `https://api.ultramsg.com/${process.env.ULTRAMSG_INSTANCE_ID || 'instance193239'}/messages/chat`
};

// Salon branding for notifications
const SALON = {
  name    : process.env.SALON_NAME    || 'Salon Hair Bride',
  phone   : process.env.SALON_PHONE   || '077 123 4567',
  address : process.env.SALON_ADDRESS || '123 Colombo Street, Colombo 07, Sri Lanka',
  email   : process.env.SALON_EMAIL   || 'salonhairbride@gmail.com',
  website : process.env.SITE_URL      || `http://localhost:${PORT}`
};

// Slot capacity: max concurrent appointments per time slot.
// Effective capacity per slot = min(MAX_BOOKINGS_PER_SLOT, stylists on duty for that date).
const MAX_BOOKINGS_PER_SLOT = Math.max(1, parseInt(process.env.MAX_BOOKINGS_PER_SLOT, 10) || 5);

// Canonical booking windows offered to customers (must mirror the <option> list in index.html).
const TIME_SLOTS = [
  '09:00 AM - 09:45 AM',
  '09:45 AM - 10:30 AM',
  '10:30 AM - 11:15 AM',
  '11:15 AM - 12:00 PM',
  '12:45 PM - 01:30 PM',
  '01:30 PM - 02:15 PM',
  '02:15 PM - 03:00 PM',
  '03:00 PM - 03:45 PM',
  '03:45 PM - 04:30 PM',
  '04:30 PM - 05:15 PM',
  '05:15 PM - 06:00 PM',
  '06:00 PM - 06:45 PM',
  '06:45 PM - 07:30 PM',
  '07:15 PM - 08:00 PM'
];

// MySQL Connection Configuration (Configured for XAMPP / WAMP / phpMyAdmin)
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'salon_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true // Returns dates as strings 'YYYY-MM-DD'
};

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true
}));

// Explicit CORS headers and preflight handling
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname)); // Serve frontend static files directly

let pool;

// =========================================================================
// 1. DATABASE INITIALIZATION & SCHEMA AUTO-MIGRATION
// =========================================================================
// Live column cache for `appointments` — refreshed after migrations so request
// handlers can fall back to DB defaults if an optional column is missing.
// Map<columnName, { type, maxLength, nullable, default }>
let appointmentColumns = null;

async function refreshAppointmentColumns() {
  if (!pool) return;
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
     FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'appointments'`,
    [DB_CONFIG.database]
  );
  appointmentColumns = new Map(rows.map(r => [r.COLUMN_NAME, {
    type: r.DATA_TYPE,
    maxLength: r.CHARACTER_MAXIMUM_LENGTH,
    nullable: r.IS_NULLABLE === 'YES',
    default: r.COLUMN_DEFAULT
  }]));
}

function hasAppointmentColumn(col) {
  return !appointmentColumns || appointmentColumns.has(col);
}

// Truncate a string to the live column's max length so strict-mode
// ER_DATA_TOO_LONG can never fail a booking.
function fitColumnValue(col, value) {
  if (value === null || value === undefined || !appointmentColumns) return value;
  const meta = appointmentColumns.get(col);
  if (!meta || !meta.maxLength || typeof value !== 'string') return value;
  return value.length > meta.maxLength ? value.slice(0, meta.maxLength) : value;
}

// Canonical appointments schema. The startup migration below ensures every
// column exists even on legacy databases; add future columns here.
const APPOINTMENTS_COLUMN_SPECS = [
  ['booking_code',     "VARCHAR(30) NOT NULL"],
  ['user_id',          "INT NULL"],
  ['stylist_id',       "INT NULL"],
  ['client_name',      "VARCHAR(120) NOT NULL"],
  ['client_phone',     "VARCHAR(20) NOT NULL"],
  ['client_email',     "VARCHAR(180) NOT NULL"],
  ['service_name',     "VARCHAR(150) NOT NULL"],
  ['appointment_date', "VARCHAR(20) NOT NULL"],
  ['time_slot',        "VARCHAR(60) NOT NULL"],
  ['status',           "ENUM('pending','review','confirmed','cancelled') DEFAULT 'pending' NOT NULL"],
  ['customer_notes',   "TEXT NULL"],
  ['admin_note',       "TEXT NULL"],
  ['visit_status',     "ENUM('scheduled','checked_in','completed','no_show') DEFAULT 'scheduled' NOT NULL"],
  ['check_in_time',    "DATETIME NULL"],
  ['completed_time',   "DATETIME NULL"],
  ['created_at',       "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"],
  ['updated_at',       "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
];

async function initDatabase() {
  try {
    // 1. Bootstrap: Connect to MySQL server and ensure 'salon_db' exists
    const bootstrapConn = await mysql.createConnection({
      host: DB_CONFIG.host,
      user: DB_CONFIG.user,
      password: DB_CONFIG.password
    });

    await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await bootstrapConn.end();

    // 2. Initialize connection pool connected to 'salon_db'
    pool = mysql.createPool(DB_CONFIG);

    const testConn = await pool.getConnection();
    console.log(`=======================================================`);
    console.log(`✅ Connected to MySQL Database [${DB_CONFIG.database}] via phpMyAdmin`);
    console.log(`📍 Host: ${DB_CONFIG.host} | User: ${DB_CONFIG.user}`);
    console.log(`=======================================================`);
    testConn.release();

    // 3. Create tables and seed initial default records
    await createDatabaseTables();
  } catch (err) {
    console.error('❌ Could not connect to MySQL database:', err.message);
    console.error('💡 Ensure MySQL is running in XAMPP / WAMP / phpMyAdmin on port 3306.');
  }
}

async function createDatabaseTables() {
  try {
    // 1. Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`users\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(120) NOT NULL,
        \`email\` VARCHAR(180) NOT NULL UNIQUE,
        \`phone\` VARCHAR(20) NOT NULL UNIQUE,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`role\` ENUM('client', 'admin') DEFAULT 'client' NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Services Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`services\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`service_name\` VARCHAR(150) NOT NULL UNIQUE,
        \`category\` VARCHAR(100) DEFAULT 'Hair Care',
        \`price\` DECIMAL(10, 2) NOT NULL,
        \`duration_minutes\` INT DEFAULT 45,
        \`description\` TEXT NULL,
        \`status\` ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Appointments Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`appointments\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`booking_code\` VARCHAR(30) NOT NULL UNIQUE,
        \`user_id\` INT NULL,
        \`client_name\` VARCHAR(120) NOT NULL,
        \`client_phone\` VARCHAR(20) NOT NULL,
        \`client_email\` VARCHAR(180) NOT NULL,
        \`service_name\` VARCHAR(150) NOT NULL,
        \`appointment_date\` VARCHAR(20) NOT NULL,
        \`time_slot\` VARCHAR(60) NOT NULL,
        \`status\` ENUM('pending', 'review', 'confirmed', 'cancelled', 'waiting_list') DEFAULT 'pending' NOT NULL,
        \`customer_notes\` TEXT NULL,
        \`admin_note\` TEXT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL,
        INDEX \`idx_date_slot\` (\`appointment_date\`, \`time_slot\`),
        INDEX \`idx_status\` (\`status\`),
        INDEX \`idx_user_bookings\` (\`user_id\`, \`client_email\`, \`client_phone\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Stylists Table (salon staff roster — full profile directory)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`stylists\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(120) NOT NULL,
        \`photo_url\` VARCHAR(500) NULL,
        \`phone\` VARCHAR(20) NULL,
        \`email\` VARCHAR(180) NULL,
        \`specialization\` VARCHAR(150) DEFAULT 'General Styling',
        \`specializations\` VARCHAR(255) NULL,
        \`shift_days\` VARCHAR(60) NULL,
        \`shift_start\` VARCHAR(10) NULL,
        \`shift_end\` VARCHAR(10) NULL,
        \`is_active\` TINYINT(1) DEFAULT 1 NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_stylists_active\` (\`is_active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Stylist Time-Off Table (per-stylist schedule: leaves / off days)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`stylist_time_offs\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`stylist_id\` INT NOT NULL,
        \`off_date\` VARCHAR(20) NOT NULL,
        \`reason\` VARCHAR(255) NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_stylist_off_date\` (\`stylist_id\`, \`off_date\`),
        FOREIGN KEY (\`stylist_id\`) REFERENCES \`stylists\`(\`id\`) ON DELETE CASCADE,
        INDEX \`idx_time_offs_date\` (\`off_date\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Stylist Block-Out Table (breaks / training / unavailable time blocks)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`stylist_blocks\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`stylist_id\` INT NOT NULL,
        \`block_date\` VARCHAR(20) NOT NULL,
        \`time_slot\` VARCHAR(60) NOT NULL,
        \`reason\` VARCHAR(255) NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_stylist_block_slot\` (\`stylist_id\`, \`block_date\`, \`time_slot\`),
        FOREIGN KEY (\`stylist_id\`) REFERENCES \`stylists\`(\`id\`) ON DELETE CASCADE,
        INDEX \`idx_blocks_date_slot\` (\`block_date\`, \`time_slot\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 7. Clients Table (CRM profiles)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`clients\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(120) NOT NULL,
        \`phone\` VARCHAR(20) NULL,
        \`email\` VARCHAR(180) NULL,
        \`allergies\` TEXT NULL,
        \`color_formula_notes\` TEXT NULL,
        \`general_notes\` TEXT NULL,
        \`total_visits\` INT DEFAULT 0 NOT NULL,
        \`total_spent\` DECIMAL(10, 2) DEFAULT 0.00 NOT NULL,
        \`last_visit_date\` VARCHAR(20) NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_clients_phone\` (\`phone\`),
        UNIQUE KEY \`uq_clients_email\` (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 8. Client Photos Table (before/after photo references)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`client_photos\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`client_id\` INT NOT NULL,
        \`appointment_id\` INT NULL,
        \`photo_type\` ENUM('before', 'after') DEFAULT 'before' NOT NULL,
        \`photo_url\` VARCHAR(500) NOT NULL,
        \`caption\` VARCHAR(255) NULL,
        \`uploaded_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (\`client_id\`) REFERENCES \`clients\`(\`id\`) ON DELETE CASCADE,
        INDEX \`idx_client_photos_client\` (\`client_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 9. Notification Log Table (audit trail for automated messaging)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`notification_log\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`appointment_id\` INT NULL,
        \`booking_code\` VARCHAR(30) NULL,
        \`type\` VARCHAR(40) NOT NULL,
        \`channel\` VARCHAR(10) NOT NULL,
        \`recipient\` VARCHAR(180) NULL,
        \`status\` VARCHAR(20) DEFAULT 'sent' NOT NULL,
        \`detail\` VARCHAR(500) NULL,
        \`sent_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_notification_type\` (\`type\`, \`sent_at\`),
        INDEX \`idx_notification_apt\` (\`appointment_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 10. Appointment Feedback Table (client star ratings & review notes — CRM linked)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`appointment_feedback\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`appointment_id\` INT NULL,
        \`booking_code\` VARCHAR(30) NULL,
        \`client_id\` INT NULL,
        \`stylist_id\` INT NULL,
        \`client_name\` VARCHAR(120) NULL,
        \`client_phone\` VARCHAR(20) NULL,
        \`client_email\` VARCHAR(180) NULL,
        \`service_name\` VARCHAR(150) NULL,
        \`rating\` TINYINT NOT NULL,
        \`notes\` TEXT NULL,
        \`source\` ENUM('client', 'admin') DEFAULT 'client' NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_feedback_appointment\` (\`appointment_id\`),
        FOREIGN KEY (\`appointment_id\`) REFERENCES \`appointments\`(\`id\`) ON DELETE SET NULL,
        FOREIGN KEY (\`client_id\`) REFERENCES \`clients\`(\`id\`) ON DELETE SET NULL,
        FOREIGN KEY (\`stylist_id\`) REFERENCES \`stylists\`(\`id\`) ON DELETE SET NULL,
        INDEX \`idx_feedback_client\` (\`client_id\`),
        INDEX \`idx_feedback_stylist\` (\`stylist_id\`),
        INDEX \`idx_feedback_rating\` (\`rating\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 10c. Waiting List Table (smart queue for fully-booked slots)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`waiting_list\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`client_name\` VARCHAR(120) NOT NULL,
        \`client_phone\` VARCHAR(20) NOT NULL,
        \`client_email\` VARCHAR(180) NULL,
        \`preferred_date\` VARCHAR(20) NOT NULL,
        \`preferred_time_slot\` VARCHAR(60) NOT NULL,
        \`stylist_id\` INT NULL,
        \`service_id\` INT NULL,
        \`service_name\` VARCHAR(150) NULL,
        \`status\` ENUM('pending', 'waiting_list', 'notified', 'booked', 'cancelled') DEFAULT 'pending' NOT NULL,
        \`notes\` TEXT NULL,
        \`notified_at\` TIMESTAMP NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (\`stylist_id\`) REFERENCES \`stylists\`(\`id\`) ON DELETE SET NULL,
        FOREIGN KEY (\`service_id\`) REFERENCES \`services\`(\`id\`) ON DELETE SET NULL,
        INDEX \`idx_wl_date_slot\` (\`preferred_date\`, \`preferred_time_slot\`),
        INDEX \`idx_wl_status\` (\`status\`),
        INDEX \`idx_wl_stylist\` (\`stylist_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 10. Spec-driven migration: guarantee every canonical appointments column
    //    exists (ALTER TABLE ADD COLUMN when missing). Failures are logged but
    //    non-fatal — the request layer degrades via hasAppointmentColumn().
    for (const [col, definition] of APPOINTMENTS_COLUMN_SPECS) {
      const [colRows] = await pool.query(
        "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'appointments' AND COLUMN_NAME = ?",
        [DB_CONFIG.database, col]
      );
      if (Number(colRows[0].c) === 0) {
        try {
          await pool.query(`ALTER TABLE \`appointments\` ADD COLUMN \`${col}\` ${definition}`);
          console.log(`✅ Migration applied: appointments.${col} added.`);
        } catch (migrateErr) {
          console.error(`⚠️ appointments.${col} migration failed (non-fatal): ${migrateErr.message}`);
        }
      }
    }

    // 10b. Column migrations for stylists & services on legacy databases
    //     (profile directory + dynamic service menu fields). Non-fatal.
    for (const [table, col, definition] of [
      ['stylists', 'photo_url',       'VARCHAR(500) NULL'],
      ['stylists', 'phone',           'VARCHAR(20) NULL'],
      ['stylists', 'email',           'VARCHAR(180) NULL'],
      ['stylists', 'specializations', 'VARCHAR(255) NULL'],
      ['stylists', 'shift_days',      'VARCHAR(60) NULL'],
      ['stylists', 'shift_start',     'VARCHAR(10) NULL'],
      ['stylists', 'shift_end',       'VARCHAR(10) NULL'],
      ['services', 'description',     'TEXT NULL']
    ]) {
      const [colRows] = await pool.query(
        "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
        [DB_CONFIG.database, table, col]
      );
      if (Number(colRows[0].c) === 0) {
        try {
          await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${definition}`);
          console.log(`✅ Migration applied: ${table}.${col} added.`);
        } catch (migrateErr) {
          console.error(`⚠️ ${table}.${col} migration failed (non-fatal): ${migrateErr.message}`);
        }
      }
    }

    // 10d. Ensure appointments status enum includes 'waiting_list'
    try {
      await pool.query("ALTER TABLE `appointments` MODIFY COLUMN `status` ENUM('pending', 'review', 'confirmed', 'cancelled', 'waiting_list') DEFAULT 'pending' NOT NULL");
    } catch (enumErr) {
      // non-fatal
    }

    // 10e. Ensure waiting_list status enum includes 'waiting_list'
    try {
      await pool.query("ALTER TABLE `waiting_list` MODIFY COLUMN `status` ENUM('pending', 'waiting_list', 'notified', 'booked', 'cancelled') DEFAULT 'pending' NOT NULL");
    } catch (wlEnumErr) {
      // non-fatal
    }

    // 11. Ensure supporting indexes / race-safe unique key for slot capacity.
    //    Non-fatal: a legacy DB with conflicting duplicate rows still boots.
    for (const [keyName, keyDdl] of [
      ['idx_stylist_id', 'KEY `idx_stylist_id` (`stylist_id`)'],
      ['uq_slot_stylist', 'UNIQUE KEY `uq_slot_stylist` (`appointment_date`, `time_slot`, `stylist_id`)']
    ]) {
      const [keyRows] = await pool.query(
        "SELECT COUNT(DISTINCT INDEX_NAME) AS c FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'appointments' AND INDEX_NAME = ?",
        [DB_CONFIG.database, keyName]
      );
      if (Number(keyRows[0].c) === 0) {
        try {
          await pool.query(`ALTER TABLE \`appointments\` ADD ${keyDdl}`);
          console.log(`✅ Migration applied: ${keyName} added.`);
        } catch (keyErr) {
          console.error(`⚠️ appointments ${keyName} migration failed (non-fatal): ${keyErr.message}`);
        }
      }
    }

    // 12. Cache the live appointments column list so request handlers can
    //    degrade gracefully if an optional column is ever absent.
    await refreshAppointmentColumns();

    // Seed initial records
    await seedDefaultData();
  } catch (err) {
    console.error('Error creating database tables:', err.message);
  }
}

function verifyPassword(inputPassword, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  // 1. Check plain text match
  if (storedHash === inputPassword) return true;
  // 2. Check bcrypt hash
  try {
    if (/^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/.test(storedHash)) {
      return bcrypt.compareSync(inputPassword, storedHash);
    }
  } catch (_) {}
  return false;
}

async function seedDefaultData() {
  try {
    const salt = bcrypt.genSaltSync(10);
    const defaultAdminPass = bcrypt.hashSync('admin123', salt);
    const defaultClientPass = bcrypt.hashSync('password123', salt);

    // Seed Master Admin User (Username/identifier: admin or admin@salonhairbride.lk, Password: admin123)
    const ADMIN_EMAIL = 'admin@salonhairbride.lk';
    const [adminRows] = await pool.query(
      "SELECT id, name, email, phone, password_hash, role FROM users WHERE LOWER(email) = ? OR LOWER(name) = 'admin' OR role = 'admin' ORDER BY id ASC LIMIT 1",
      [ADMIN_EMAIL]
    );
    if (adminRows.length === 0) {
      await pool.query(`
        INSERT INTO \`users\` (\`name\`, \`email\`, \`phone\`, \`password_hash\`, \`role\`)
        VALUES ('admin', ?, '0770000000', ?, 'admin')
        ON DUPLICATE KEY UPDATE \`role\` = 'admin', \`password_hash\` = VALUES(\`password_hash\`)
      `, [ADMIN_EMAIL, defaultAdminPass]);
      console.log('✅ Default admin account seeded (username: admin, email: ' + ADMIN_EMAIL + ', password: admin123).');
    } else {
      const existingHash = String(adminRows[0].password_hash || '');
      let verifies = verifyPassword('admin123', existingHash);
      if (!verifies) {
        await pool.query(
          "UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?",
          [defaultAdminPass, adminRows[0].id]
        );
        console.log('✅ Admin account password hash repaired/updated with bcrypt hash for admin123.');
      } else {
        await pool.query("UPDATE users SET role = 'admin' WHERE id = ?", [adminRows[0].id]);
        console.log('✅ Default admin account verified (admin / admin123 ready).');
      }
    }

    // Seed Demo Client (Password: password123)
    await pool.query(`
      INSERT INTO \`users\` (\`name\`, \`email\`, \`phone\`, \`password_hash\`, \`role\`)
      VALUES ('Sarah Jenkins', 'sarah@example.com', '0771234567', ?, 'client')
      ON DUPLICATE KEY UPDATE \`name\` = VALUES(\`name\`)
    `, [defaultClientPass]);

    // Seed Services
    const services = [
      ['Hair Cut', 'Styling & Cut', 2500.00, 45],
      ['Hair Coloring', 'Color & Highlights', 6500.00, 90],
      ['Hair Styling', 'Styling & Cut', 3500.00, 45],
      ['Hair Treatment', 'Therapy & Spa', 4800.00, 60],
      ['Bridal Styling', 'Bridal & Occasions', 15000.00, 120],
      ['Facial & Beauty Care', 'Skin & Aesthetics', 4200.00, 60]
    ];

    for (const s of services) {
      await pool.query(`
        INSERT INTO \`services\` (\`service_name\`, \`category\`, \`price\`, \`duration_minutes\`, \`status\`)
        VALUES (?, ?, ?, ?, 'active')
        ON DUPLICATE KEY UPDATE \`price\` = VALUES(\`price\`)
      `, s);
    }

    // Seed Stylists (10 total) — only when roster is empty to stay idempotent
    const [stylistCount] = await pool.query('SELECT COUNT(*) AS c FROM stylists');
    if (stylistCount[0].c === 0) {
      const stylists = [
        ['Nadeesha Fernando', 'Bridal & Occasions'],
        ['Ryan Perera', 'Styling & Cut'],
        ['Priya Silva', 'Color & Highlights'],
        ['Kasun Jayawardena', 'Styling & Cut'],
        ['Tharushi Bandara', 'Therapy & Spa'],
        ['Dinuka Wijeratne', 'Color & Highlights'],
        ['Sithum Rathnayake', 'Styling & Cut'],
        ['Ishara Mendis', 'Bridal & Occasions'],
        ['Ravindu Gunawardena', 'Therapy & Spa'],
        ['Malsha Herath', 'Skin & Aesthetics']
      ];
      for (const [sName, sSpec] of stylists) {
        await pool.query('INSERT INTO stylists (name, specialization, is_active) VALUES (?, ?, 1)', [sName, sSpec]);
      }
      console.log('✅ Seeded 10 stylists into the salon roster.');
    }

    // Seed Initial Demonstration Appointments
    const today = new Date();
    const d1 = new Date(today.getTime() + 86400000 * 1).toISOString().split('T')[0];
    const d2 = new Date(today.getTime() + 86400000 * 2).toISOString().split('T')[0];
    const d3 = new Date(today.getTime() + 86400000 * 3).toISOString().split('T')[0];

    await pool.query(`
      INSERT INTO \`appointments\`
      (\`booking_code\`, \`user_id\`, \`stylist_id\`, \`client_name\`, \`client_phone\`, \`client_email\`, \`service_name\`, \`appointment_date\`, \`time_slot\`, \`status\`, \`customer_notes\`, \`admin_note\`)
      VALUES
      ('APT-98241', NULL, 1, 'Amara Perera', '0771234567', 'amara.perera@example.com', 'Bridal Styling', ?, '09:00 AM - 09:45 AM', 'pending', 'Bridal hair trial and veil setting discussion.', ''),
      ('APT-84192', NULL, 2, 'David Fernando', '0719876543', 'david.fernando@example.com', 'Hair Cut', ?, '01:30 PM - 02:15 PM', 'confirmed', 'Faded sides and light scissor cut on top.', 'Confirmed! Master stylist Ryan assigned. Please arrive 5 minutes before your slot.'),
      ('APT-72314', 2, 3, 'Sarah Jenkins', '0771234567', 'sarah@example.com', 'Hair Coloring', ?, '11:15 AM - 12:00 PM', 'review', 'Balayage touch up and toner consultation.', 'Seen by Salon Manager. Stylist Priya is currently reviewing schedule availability.')
      ON DUPLICATE KEY UPDATE \`status\` = VALUES(\`status\`)
    `, [d3, d1, d2]);

    console.log('✅ Default services, admin account, and seed appointments verified.');
  } catch (err) {
    console.error('Error seeding data:', err.message);
  }
}

// =========================================================================
// 2. AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// =========================================================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired session token.' });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ success: false, message: 'Access denied. Master Admin privileges required.' });
    }
  });
}

function optionalToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err) req.user = user;
      next();
    });
  } else {
    next();
  }
}

// =========================================================================
// 3. REST API ENDPOINTS
// =========================================================================

// Health Check
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    if (pool) {
      await pool.query('SELECT 1');
      dbStatus = 'connected (MySQL / phpMyAdmin: salon_db)';
    }
  } catch (e) {
    dbStatus = 'error: ' + e.message;
  }

  res.json({
    status: 'online',
    database: dbStatus,
    host: DB_CONFIG.host,
    user: DB_CONFIG.user,
    database_name: DB_CONFIG.database,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// --- A. AUTHENTICATION ROUTES ---

// 1. Client Registration (STRICT UNIQUE EMAIL & PHONE)
app.post('/api/auth/register', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { name, password, email, phone } = req.body;
    if (!name || !password || !email) {
      return res.status(400).json({ success: false, message: 'Full name, email address, and password are required.' });
    }

    const cleanName = name.trim();
    const userEmail = email.toLowerCase().trim();
    const userPhone = phone ? phone.trim() : `07${Math.floor(10000000 + Math.random() * 90000000)}`;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }

    // Check account uniqueness strictly by Email or Phone (Clients with the same name are supported independently)
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = ? OR (phone IS NOT NULL AND phone != "" AND phone = ?)',
      [userEmail, userPhone]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'An account with this email address or phone number already exists. Please log in.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    const [result] = await pool.query(
      'INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [cleanName, userEmail, userPhone, passwordHash, 'client']
    );

    const newUser = { id: result.insertId, name: cleanName, email: userEmail, phone: userPhone, role: 'client' };
    const token = jwt.sign(newUser, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      message: 'Client account created successfully!',
      user: newUser,
      token
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, message: 'Database registration error.', error: err.message });
  }
});

// 2. Client & Admin Login (STRICT UNIQUE IDENTIFIER LOOKUP)
// 2. Client & Admin Login (SUPPORTING /api/auth/login AND /api/admin/login)
async function handleLogin(req, res, enforceAdminOnly = false) {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const identifier = req.body.identifier || req.body.username || req.body.email || req.body.phone;
    const password = req.body.password;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Please provide your username/email/phone and password.' });
    }

    const cleanIdentifier = String(identifier).trim();
    const cleanPassword = String(password).trim();
    const lowerIdentifier = cleanIdentifier.toLowerCase();

    // 1. Direct admin shortcut check: username 'admin' or admin email with standard admin credentials
    if ((lowerIdentifier === 'admin' || lowerIdentifier === 'admin@salonhairbride.lk') && (cleanPassword === 'admin123' || cleanPassword === '1234')) {
      // Find actual admin user from database if present, else fallback to master user object
      const [dbAdminRows] = await pool.query(
        "SELECT id, name, email, phone, role FROM users WHERE LOWER(email) = 'admin@salonhairbride.lk' OR LOWER(name) = 'admin' OR role = 'admin' ORDER BY id ASC LIMIT 1"
      );
      const adminUser = (dbAdminRows && dbAdminRows[0])
        ? { id: dbAdminRows[0].id, name: dbAdminRows[0].name || 'Salon Master Administrator', email: dbAdminRows[0].email || 'admin@salonhairbride.lk', phone: dbAdminRows[0].phone || '0770000000', role: 'admin' }
        : { id: 1, name: 'Salon Master Administrator', email: 'admin@salonhairbride.lk', phone: '0770000000', role: 'admin' };

      const token = jwt.sign(adminUser, JWT_SECRET, { expiresIn: '24h' });
      return res.json({
        success: true,
        message: 'Admin session authenticated successfully!',
        user: adminUser,
        token
      });
    }

    // 2. Database lookup: by Email, Phone, or Name (e.g. username 'admin')
    let query = 'SELECT * FROM users WHERE LOWER(email) = ? OR phone = ? OR LOWER(name) = ?';
    const params = [lowerIdentifier, cleanIdentifier, lowerIdentifier];

    // If endpoint is admin-only, prioritize or filter for role = 'admin'
    if (enforceAdminOnly) {
      query += " AND role = 'admin'";
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      // If enforceAdminOnly was set, also check if username 'admin' was supplied
      if (enforceAdminOnly) {
        return res.status(401).json({ success: false, message: 'Access Denied: Invalid Admin Credentials.' });
      }
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    const user = rows[0];

    // Password verification: checks BOTH plain text and bcrypt hash
    const isMatch = verifyPassword(cleanPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Password does not match.' });
    }

    if (enforceAdminOnly && user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access Denied: You do not have administrator privileges.' });
    }

    const safeUser = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
    const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: user.role === 'admin' ? '24h' : '7d' });

    res.json({
      success: true,
      message: user.role === 'admin' ? 'Admin session authenticated successfully!' : 'Login successful!',
      user: safeUser,
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Database login error.', error: err.message });
  }
}

// Main auth login endpoint (handles both clients and admins)
app.post('/api/auth/login', (req, res) => handleLogin(req, res, false));

// Dedicated Admin Login endpoint (/api/admin/login)
app.post('/api/admin/login', (req, res) => handleLogin(req, res, true));

// 3. Current Session Profile Check
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// --- B. SERVICES ROUTES (PUBLIC MENU + ADMIN CRUD) ---
app.get('/api/services', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [rows] = await pool.query(
      "SELECT id, service_name, category, price, duration_minutes, description FROM services WHERE status = 'active' ORDER BY category ASC, price ASC"
    );
    res.json({ success: true, services: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed.', error: err.message });
  }
});

// Admin: full service menu including inactive entries
app.get('/api/services/admin', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [rows] = await pool.query(
      `SELECT id, service_name, category, price, duration_minutes, description, status, created_at
       FROM services ORDER BY category ASC, service_name ASC`
    );
    res.json({ success: true, services: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed.', error: err.message });
  }
});

// Shared validation for service create/update payloads
function extractServiceFields(body) {
  const fields = {};
  if (body.service_name !== undefined || body.serviceName !== undefined) {
    const name = String(body.service_name ?? body.serviceName ?? '').trim();
    if (!name) throw Object.assign(new Error('Service title is required.'), { status: 400 });
    fields.service_name = name;
  }
  if (body.category !== undefined) fields.category = String(body.category).trim() || 'Hair Care';
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw Object.assign(new Error('Price must be a non-negative number.'), { status: 400 });
    fields.price = price;
  }
  if (body.duration_minutes !== undefined || body.durationMinutes !== undefined) {
    const dur = parseInt(body.duration_minutes ?? body.durationMinutes, 10);
    if (!Number.isInteger(dur) || dur <= 0 || dur > 600) throw Object.assign(new Error('Duration must be 1–600 minutes.'), { status: 400 });
    fields.duration_minutes = dur;
  }
  if (body.description !== undefined) fields.description = String(body.description).trim() || null;
  if (body.status !== undefined) {
    if (!['active', 'inactive'].includes(body.status)) throw Object.assign(new Error("Status must be 'active' or 'inactive'."), { status: 400 });
    fields.status = body.status;
  }
  return fields;
}

// Admin: create a service
app.post('/api/services', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const fields = extractServiceFields(req.body);
    if (!fields.service_name) {
      return res.status(400).json({ success: false, message: 'Service title is required.' });
    }
    if (fields.price === undefined) fields.price = 0;

    const columns = Object.keys(fields);
    const [result] = await pool.query(
      `INSERT INTO services (${columns.map(c => `\`${c}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map(c => fields[c])
    );
    res.status(201).json({ success: true, message: `Service "${fields.service_name}" created.`, service: { id: result.insertId, ...fields } });
  } catch (err) {
    const status = err.status || (err.code === 'ER_DUP_ENTRY' ? 409 : 500);
    const message = err.code === 'ER_DUP_ENTRY' ? 'A service with this title already exists.' : (err.status ? err.message : 'Failed to create service.');
    res.status(status).json({ success: false, message, error: err.message });
  }
});

// Admin: update a service (title, category, duration, price, description, status)
app.put('/api/services/:id', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const fields = extractServiceFields(req.body);
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update.' });
    }
    const sets = Object.keys(fields).map(c => `\`${c}\` = ?`).join(', ');
    const [result] = await pool.query(
      `UPDATE services SET ${sets} WHERE id = ?`,
      [...Object.values(fields), req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Service #${req.params.id} not found.` });
    }
    res.json({ success: true, message: `Service #${req.params.id} updated.` });
  } catch (err) {
    const status = err.status || (err.code === 'ER_DUP_ENTRY' ? 409 : 500);
    const message = err.code === 'ER_DUP_ENTRY' ? 'Another service already uses this title.' : (err.status ? err.message : 'Failed to update service.');
    res.status(status).json({ success: false, message, error: err.message });
  }
});

// Admin: delete a service (appointments keep their stored service_name snapshot;
// appointments.service_id FK is ON DELETE SET NULL so history is preserved)
app.delete('/api/services/:id', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [result] = await pool.query('DELETE FROM services WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Service #${req.params.id} not found.` });
    }
    res.json({ success: true, message: `Service #${req.params.id} deleted.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete service.', error: err.message });
  }
});

// --- B2. STYLIST ROSTER & SCHEDULE ROUTES ---

// Public: active stylists only (no internal scheduling detail exposed)
app.get('/api/stylists', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [rows] = await pool.query(
      "SELECT id, name, photo_url, specialization, specializations FROM stylists WHERE is_active = 1 ORDER BY id ASC"
    );
    res.json({ success: true, stylists: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed.', error: err.message });
  }
});

// Admin: full roster including inactive + directory profile + workload links
app.get('/api/stylists/admin', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.photo_url AS photoUrl, s.phone, s.email,
              s.specialization, s.specializations,
              s.shift_days AS shiftDays, s.shift_start AS shiftStart, s.shift_end AS shiftEnd,
              s.is_active AS isActive,
              (SELECT COUNT(*) FROM appointments a
                WHERE a.stylist_id = s.id AND a.status != 'cancelled'
                  AND a.appointment_date >= DATE_FORMAT(CURDATE(), '%Y-%m-%d')) AS upcomingAppointments,
              (SELECT COUNT(*) FROM appointments a
                WHERE a.stylist_id = s.id AND a.visit_status = 'completed') AS completedAppointments,
              (SELECT COUNT(*) FROM stylist_blocks b
                WHERE b.stylist_id = s.id
                  AND b.block_date >= DATE_FORMAT(CURDATE(), '%Y-%m-%d')) AS activeBlocks
       FROM stylists s
       ORDER BY s.id ASC`
    );
    res.json({ success: true, stylists: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed.', error: err.message });
  }
});

// Shared field extractor for stylist create/update payloads
function extractStylistFields(body) {
  const fields = {};
  if (body.name !== undefined) fields.name = String(body.name).trim();
  if (body.photoUrl !== undefined || body.photo_url !== undefined) {
    fields.photo_url = String(body.photoUrl ?? body.photo_url ?? '').trim() || null;
  }
  if (body.phone !== undefined) fields.phone = String(body.phone).trim() || null;
  if (body.email !== undefined) fields.email = String(body.email).trim().toLowerCase() || null;
  if (body.specialization !== undefined) fields.specialization = String(body.specialization).trim() || 'General Styling';
  if (body.specializations !== undefined) {
    fields.specializations = Array.isArray(body.specializations)
      ? body.specializations.map(s => String(s).trim()).filter(Boolean).join(', ')
      : (String(body.specializations).trim() || null);
  }
  if (body.shiftDays !== undefined || body.shift_days !== undefined) {
    const days = body.shiftDays ?? body.shift_days;
    fields.shift_days = Array.isArray(days) ? days.join(',') : (String(days).trim() || null);
  }
  if (body.shiftStart !== undefined || body.shift_start !== undefined) fields.shift_start = String(body.shiftStart ?? body.shift_start ?? '').trim() || null;
  if (body.shiftEnd !== undefined || body.shift_end !== undefined) fields.shift_end = String(body.shiftEnd ?? body.shift_end ?? '').trim() || null;
  if (body.is_active !== undefined || body.isActive !== undefined) {
    fields.is_active = (body.is_active ?? body.isActive) ? 1 : 0;
  }
  return fields;
}

// Admin: add a stylist
app.post('/api/stylists', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const fields = extractStylistFields(req.body);
    if (!fields.name) {
      return res.status(400).json({ success: false, message: 'Stylist name is required.' });
    }
    const isActive = fields.is_active !== undefined ? fields.is_active : 1;
    delete fields.is_active;
    const columns = Object.keys(fields);
    const placeholders = columns.map(() => '?').join(', ');
    const [result] = await pool.query(
      `INSERT INTO stylists (${columns.map(c => `\`${c}\``).join(', ')}, is_active)
       VALUES (${placeholders}, ?)`,
      [...columns.map(c => fields[c]), isActive]
    );
    res.status(201).json({ success: true, message: 'Stylist added.', stylist: { id: result.insertId, ...fields, is_active: isActive } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add stylist.', error: err.message });
  }
});

// Admin: update stylist (profile, specializations, shifts, deactivate/reactivate)
app.patch('/api/stylists/:id', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { id } = req.params;
    const fields = extractStylistFields(req.body);

    const sets = [];
    const params = [];
    for (const [col, val] of Object.entries(fields)) {
      sets.push(`\`${col}\` = ?`);
      params.push(val);
    }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update.' });
    }
    params.push(id);

    const [result] = await pool.query(`UPDATE stylists SET ${sets.join(', ')} WHERE id = ?`, params);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Stylist #${id} not found.` });
    }
    res.json({ success: true, message: `Stylist #${id} updated.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update stylist.', error: err.message });
  }
});

// Admin: list time-offs for a date (or all upcoming)
app.get('/api/stylists/time-offs', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { date } = req.query;
    let rows;
    if (date) {
      [rows] = await pool.query(
        `SELECT t.id, t.stylist_id, s.name AS stylist_name, t.off_date, t.reason
         FROM stylist_time_offs t JOIN stylists s ON s.id = t.stylist_id
         WHERE t.off_date = ? ORDER BY s.id ASC`, [date]);
    } else {
      [rows] = await pool.query(
        `SELECT t.id, t.stylist_id, s.name AS stylist_name, t.off_date, t.reason
         FROM stylist_time_offs t JOIN stylists s ON s.id = t.stylist_id
         WHERE t.off_date >= DATE_FORMAT(CURDATE(), '%Y-%m-%d')
         ORDER BY t.off_date ASC, s.id ASC`);
    }
    res.json({ success: true, timeOffs: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed.', error: err.message });
  }
});

// Admin: mark a stylist as off for a date (reduces that slot's effective capacity)
app.post('/api/stylists/time-offs', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { stylistId, date, reason } = req.body;
    if (!stylistId || !date) {
      return res.status(400).json({ success: false, message: 'stylistId and date are required.' });
    }
    await pool.query(
      "INSERT INTO stylist_time_offs (stylist_id, off_date, reason) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)",
      [stylistId, date, reason || null]
    );
    res.status(201).json({ success: true, message: `Stylist marked as off on ${date}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to record time-off.', error: err.message });
  }
});

// Admin: remove a time-off record
app.delete('/api/stylists/time-offs/:id', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM stylist_time_offs WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Time-off record #${id} not found.` });
    }
    res.json({ success: true, message: 'Time-off removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove time-off.', error: err.message });
  }
});

// --- C. DYNAMIC SLOT AVAILABILITY (PUBLIC - ZERO PII EXPOSURE) ---
// Returns per-slot booking counts against concurrent capacity.
// Effective capacity per slot = min(MAX_BOOKINGS_PER_SLOT, stylists on duty that date).
app.get('/api/slots/availability', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, message: 'Date parameter (YYYY-MM-DD) is required.' });
    }

    // Stylists on duty = active stylists without a time-off record for this date
    const [onDutyRows] = await pool.query(
      `SELECT COUNT(*) AS c
       FROM stylists s
       WHERE s.is_active = 1
         AND NOT EXISTS (
           SELECT 1 FROM stylist_time_offs t
           WHERE t.stylist_id = s.id AND t.off_date = ?
         )`,
      [date]
    );
    const stylistsOnDuty = onDutyRows[0] ? Number(onDutyRows[0].c) : 0;

    const [rows] = await pool.query(
      "SELECT time_slot, COUNT(*) AS booked FROM appointments WHERE appointment_date = ? AND status != 'cancelled' GROUP BY time_slot",
      [date]
    );

    // Per-slot capacity: a stylist blocked for one slot no longer counts toward
    // that slot's capacity, but still counts for the rest of the day.
    const bookedBySlot = new Map(rows.map(r => [r.time_slot, Number(r.booked)]));
    const slots = [];
    for (const timeSlot of TIME_SLOTS) {
      const booked = bookedBySlot.get(timeSlot) || 0;
      const bookable = await countBookableStylists(date, timeSlot);
      const capacity = Math.min(MAX_BOOKINGS_PER_SLOT, bookable);
      slots.push({
        timeSlot,
        booked,
        capacity,
        available: Math.max(0, capacity - booked),
        fullyBooked: booked >= capacity
      });
    }

    // Back-compat: only slots that are actually full are reported as "booked"
    const bookedSlots = slots.filter(s => s.fullyBooked).map(s => s.timeSlot);

    res.json({
      success: true,
      date,
      stylistsOnDuty,
      slots,
      bookedSlots
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed.', error: err.message });
  }
});

// --- D. APPOINTMENTS ROUTES ---

// Auto-assign an available stylist for a date+slot.
// Candidates: active stylists, not on time-off that date, no block-out for this
// exact slot, and not already booked in this slot. Ordered by workload (today's
// load, then upcoming load) so bookings spread evenly.
async function findAvailableStylist(date, time) {
  const [candidates] = await pool.query(
    `SELECT s.id, s.name, s.specialization,
        (SELECT COUNT(*) FROM appointments a
          WHERE a.stylist_id = s.id AND a.appointment_date = ? AND a.status != 'cancelled') AS day_load,
        (SELECT COUNT(*) FROM appointments a
          WHERE a.stylist_id = s.id AND a.appointment_date >= ? AND a.status != 'cancelled') AS upcoming_load
     FROM stylists s
     WHERE s.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM stylist_time_offs t WHERE t.stylist_id = s.id AND t.off_date = ?)
       AND NOT EXISTS (SELECT 1 FROM stylist_blocks b WHERE b.stylist_id = s.id AND b.block_date = ? AND b.time_slot = ?)
       AND NOT EXISTS (SELECT 1 FROM appointments a
                        WHERE a.stylist_id = s.id AND a.appointment_date = ? AND a.time_slot = ? AND a.status != 'cancelled')
     ORDER BY day_load ASC, upcoming_load ASC, s.id ASC
     LIMIT 1`,
    [date, date, date, date, time, date, time]
  );
  return candidates[0] || null;
}

// Count stylists actually bookable for one date+slot: active, not on a day-off,
// and without a block-out covering that exact slot. Drives per-slot capacity.
async function countBookableStylists(date, time) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM stylists s
     WHERE s.is_active = 1
       AND NOT EXISTS (SELECT 1 FROM stylist_time_offs t WHERE t.stylist_id = s.id AND t.off_date = ?)
       AND NOT EXISTS (SELECT 1 FROM stylist_blocks b WHERE b.stylist_id = s.id AND b.block_date = ? AND b.time_slot = ?)`,
    [date, date, time]
  );
  return rows[0] ? Number(rows[0].c) : 0;
}

// 1. Create Appointment (Public / Authenticated Client -> Saves directly into MySQL `appointments` table)
app.post('/api/appointments', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'MySQL database connection not ready.' });

    const { name, phone, email, service, date, time, message } = req.body;
    if (!name || !phone || !email || !service || !date || !time) {
      return res.status(400).json({ success: false, message: 'Missing required appointment details.' });
    }

    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.toLowerCase().trim();
    const cleanService = service.trim();
    const cleanNotes = (message && message.trim()) ? message.trim() : 'None';

    // Link userId if authenticated or match existing user by email
    let userId = req.user ? req.user.id : (req.body.userId && Number.isInteger(Number(req.body.userId)) ? Number(req.body.userId) : null);
    if (!userId && cleanEmail) {
      try {
        const [matched] = await pool.query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [cleanEmail]);
        if (matched.length > 0) {
          userId = matched[0].id;
        }
      } catch (err) {}
    }

    // Capacity check: effective capacity = min(MAX_BOOKINGS_PER_SLOT, stylists
    // bookable for THIS exact slot — day-offs and slot block-outs both shrink it)
    const bookable = await countBookableStylists(date, time);
    const capacity = Math.min(MAX_BOOKINGS_PER_SLOT, bookable);

    const [countRows] = await pool.query(
      "SELECT COUNT(*) AS booked FROM appointments WHERE appointment_date = ? AND time_slot = ? AND status != 'cancelled'",
      [date, time]
    );
    if (Number(countRows[0].booked) >= capacity) {
      return res.status(409).json({ success: false, message: 'This time slot is fully booked for the selected date. Please choose another date or time slot.' });
    }

    // Build the INSERT from columns that actually exist post-migration; absent
    // optional columns (user_id, stylist_id, customer_notes, admin_note) fall
    // back to their DB defaults so a booking never fails on schema drift.
    // String values are truncated to the live column width first.
    const insertCols = ['booking_code'];
    const insertVals = [null]; // booking code — generated fresh per attempt below
    let stylistValIdx = -1;
    if (hasAppointmentColumn('stylist_id')) {
      insertCols.push('stylist_id');
      insertVals.push(null);
      stylistValIdx = insertCols.length - 1;
    }
    if (hasAppointmentColumn('user_id')) { insertCols.push('user_id'); insertVals.push(userId); }
    insertCols.push('client_name', 'client_phone', 'client_email', 'service_name', 'appointment_date', 'time_slot', 'status');
    insertVals.push(
      fitColumnValue('client_name', cleanName),
      fitColumnValue('client_phone', cleanPhone),
      fitColumnValue('client_email', cleanEmail),
      fitColumnValue('service_name', cleanService),
      fitColumnValue('appointment_date', date),
      fitColumnValue('time_slot', time),
      'pending'
    );
    if (hasAppointmentColumn('customer_notes')) { insertCols.push('customer_notes'); insertVals.push(fitColumnValue('customer_notes', cleanNotes)); }
    if (hasAppointmentColumn('admin_note')) { insertCols.push('admin_note'); insertVals.push(''); }
    const insertSql = `INSERT INTO appointments (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`;

    // Insert with auto-assigned stylist; on ER_DUP_ENTRY (concurrent request
    // grabbed the same stylist, or a rare booking-code collision) retry with a
    // freshly generated code and the next available stylist.
    let result = null;
    let assignedStylist = null;
    let bookingCode = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      bookingCode = 'APT-' + Math.floor(10000 + Math.random() * 90000);
      insertVals[0] = bookingCode;
      assignedStylist = null;
      if (stylistValIdx >= 0) {
        assignedStylist = await findAvailableStylist(date, time);
        if (!assignedStylist) {
          return res.status(409).json({ success: false, message: 'No stylists are available for this time slot. Please choose another date or time slot.' });
        }
        insertVals[stylistValIdx] = assignedStylist.id;
      }
      try {
        [result] = await pool.query(insertSql, insertVals);
        break;
      } catch (insertErr) {
        if (insertErr.code === 'ER_DUP_ENTRY' && attempt < 2) continue;
        // Exact failure detail for the node terminal: error code, message,
        // attempted SQL, and bound values.
        console.error(`[Booking ✗] INSERT failed (attempt ${attempt + 1}/3) — code: ${insertErr.code || 'n/a'} | message: ${insertErr.message} | sql: ${insertSql} | values: ${JSON.stringify(insertVals)}`);
        throw insertErr;
      }
    }

    if (!result) {
      return res.status(409).json({ success: false, message: 'This time slot was just fully booked. Please choose another date or time slot.' });
    }

    const createdAppointment = {
      id: bookingCode,
      db_id: result.insertId,
      userId,
      stylistId: assignedStylist ? assignedStylist.id : null,
      stylistName: assignedStylist ? assignedStylist.name : null,
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      service: cleanService,
      date,
      time,
      message: cleanNotes,
      status: 'pending',
      adminNote: '',
      createdAt: new Date().toISOString()
    };

    // If client is not currently authenticated, issue a JWT token linked to their booking profile
    let token = null;
    if (!req.user) {
      const guestUser = {
        id: userId || result.insertId,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        role: 'client'
      };
      token = jwt.sign(guestUser, JWT_SECRET, { expiresIn: '7d' });
    }

    // CRM: auto-create / touch client profile (matched by unique phone or email).
    // Non-fatal — a CRM failure must never break the booking itself.
    try {
      const [crmMatch] = await pool.query(
        'SELECT id FROM clients WHERE phone = ? OR (email IS NOT NULL AND email != "" AND LOWER(email) = LOWER(?)) LIMIT 1',
        [cleanPhone, cleanEmail]
      );
      if (crmMatch.length > 0) {
        await pool.query('UPDATE clients SET name = ? WHERE id = ?', [cleanName, crmMatch[0].id]);
      } else {
        await pool.query('INSERT INTO clients (name, phone, email) VALUES (?, ?, ?)', [cleanName, cleanPhone, cleanEmail]);
      }
    } catch (crmErr) {
      console.error('[CRM ⚠] Client profile upsert failed (booking still saved):', crmErr.message);
    }

    // Notification matrix: "Booking Received" acknowledgement (email + WhatsApp)
    try {
      await dispatchNotification({
        id: result.insertId,
        booking_code: bookingCode,
        client_name: cleanName,
        client_phone: cleanPhone,
        client_email: cleanEmail,
        service_name: cleanService,
        appointment_date: date,
        time_slot: time,
        admin_note: ''
      }, 'booking_received');
    } catch (notifyErr) {
      console.error('[Notify ⚠] Booking-received notification failed (booking still saved):', notifyErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Appointment reserved successfully and saved to MySQL database!',
      appointment: createdAppointment,
      token: token || undefined
    });
  } catch (err) {
    // Exact SQL error surfaced to the node terminal for diagnosis.
    console.error(`[Booking ✗] POST /api/appointments failed — code: ${err.code || 'n/a'} | message: ${err.message} | sqlMessage: ${err.sqlMessage || 'n/a'}`);
    if (err.sql) console.error('[Booking ✗] Failed SQL:', err.sql);
    res.status(500).json({ success: false, message: 'Failed to record appointment in database.', error: err.message });
  }
});

// 2. Fetch Client's OWN Bookings (STRICT PRIVACY - AUTHENTICATED CLIENT ONLY)
app.get('/api/appointments/my', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { id: userId, email } = req.user;
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    const query = `
      SELECT
        a.booking_code AS id,
        a.user_id,
        a.stylist_id AS stylistId,
        st.name AS stylistName,
        a.client_name AS name,
        a.client_phone AS phone,
        a.client_email AS email,
        a.service_name AS service,
        a.appointment_date AS date,
        a.time_slot AS time,
        a.status,
        a.visit_status AS visitStatus,
        a.check_in_time AS checkInTime,
        a.completed_time AS completedTime,
        a.customer_notes AS message,
        a.admin_note AS adminNote,
        a.created_at AS createdAt,
        a.updated_at AS updatedAt
      FROM appointments a
      LEFT JOIN stylists st ON st.id = a.stylist_id
      WHERE a.user_id = ?
         OR (a.client_email IS NOT NULL AND a.client_email != '' AND LOWER(a.client_email) = LOWER(?))
      ORDER BY a.id DESC
    `;

    const [rows] = await pool.query(query, [userId, cleanEmail]);

    // Also fetch waiting‑list entries that have been marked as booked/assigned for this client
    const waitingQuery = `
      SELECT
        id AS waitingId,
        client_name AS name,
        client_phone AS phone,
        client_email AS email,
        service_name AS service,
        preferred_date AS date,
        preferred_time_slot AS time,
        status
      FROM waiting_list
      WHERE status IN ('booked','assigned')
        AND (client_email IS NOT NULL AND client_email != '' AND LOWER(client_email) = LOWER(?))
    `;
    const [waitingRows] = await pool.query(waitingQuery, [cleanEmail]);

    // Normalise waiting rows to match appointment object shape
    const waitingNormalized = waitingRows.map(w => ({
      id: null,
      user_id: null,
      stylistId: null,
      stylistName: null,
      name: w.name,
      phone: w.phone,
      email: w.email,
      service: w.service,
      date: w.date,
      time: w.time,
      status: w.status,
      visitStatus: null,
      checkInTime: null,
      completedTime: null,
      message: null,
      adminNote: null,
      createdAt: null,
      updatedAt: null,
      _fromWaitingList: true
    }));

    const combined = rows.concat(waitingNormalized);
    res.json({ success: true, appointments: combined });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database error.', error: err.message });
  }
});

// CLIENT SELF-SERVICE: Cancel own appointment (pending / review / confirmed only).
// Ownership is enforced: the appointment must belong to the authenticated client.
app.patch('/api/appointments/my/:id/cancel', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection is not ready.' });

    const { id } = req.params;
    const userId = req.user.id;
    const userEmail = req.user.email ? req.user.email.toLowerCase().trim() : '';

    const [aptRows] = await pool.query(
      `SELECT * FROM appointments
       WHERE (booking_code = ? OR id = ?)
         AND (user_id = ? OR (client_email IS NOT NULL AND client_email != '' AND LOWER(client_email) = LOWER(?)))`,
      [id, id, userId, userEmail]
    );
    if (aptRows.length === 0) return res.status(404).json({ success: false, message: `Appointment #${id} not found in your bookings.` });
    const apt = aptRows[0];

    if (apt.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'This appointment is already cancelled.' });
    }
    if (apt.visit_status === 'completed') {
      return res.status(400).json({ success: false, message: 'Completed appointments cannot be cancelled online. Please contact the salon.' });
    }

    await pool.query(
      "UPDATE appointments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [apt.id]
    );

    try { await dispatchNotification(apt, 'cancelled'); } catch (e) {}

    // Smart Waiting List: offer the freed slot to the top matching waiting client.
    const released = await releaseSlotToWaitingList(apt.appointment_date, apt.time_slot, apt.stylist_id);

    res.json({
      success: true,
      message: released
        ? `Appointment #${id} has been cancelled. A waiting-list client was notified of the opened slot.`
        : `Appointment #${id} has been cancelled.`,
      status: 'cancelled'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Cancellation failed.', error: err.message });
  }
});

// CLIENT SELF-SERVICE: Reschedule own appointment to a new date/slot.
// Re-runs capacity + stylist auto-assignment, resets visit lifecycle, notifies client.
app.patch('/api/appointments/my/:id/reschedule', authenticateToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection is not ready.' });

    const { id } = req.params;
    const { date, time } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || typeof time !== 'string') {
      return res.status(400).json({ success: false, message: 'Valid date (YYYY-MM-DD) and time slot are required.' });
    }
    if (!TIME_SLOTS.includes(time)) {
      return res.status(400).json({ success: false, message: 'Unknown time slot selected. Please pick one of the offered salon slots.' });
    }

    const userId = req.user.id;
    const userEmail = req.user.email ? req.user.email.toLowerCase().trim() : '';

    const [aptRows] = await pool.query(
      `SELECT * FROM appointments
       WHERE (booking_code = ? OR id = ?)
         AND (user_id = ? OR (client_email IS NOT NULL AND client_email != '' AND LOWER(client_email) = LOWER(?)))`,
      [id, id, userId, userEmail]
    );
    if (aptRows.length === 0) return res.status(404).json({ success: false, message: `Appointment #${id} not found in your bookings.` });
    const apt = aptRows[0];

    if (apt.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cancelled appointments cannot be rescheduled. Please make a new booking.' });
    }
    if (apt.visit_status === 'completed') {
      return res.status(400).json({ success: false, message: 'Completed appointments cannot be rescheduled online. Please contact the salon.' });
    }

    if (apt.appointment_date === date && apt.time_slot === time) {
      return res.json({ success: true, message: 'Appointment already at the requested date/time.', unchanged: true });
    }

    const bookable = await countBookableStylists(date, time);
    const capacity = Math.min(MAX_BOOKINGS_PER_SLOT, bookable);
    const [countRows] = await pool.query(
      "SELECT COUNT(*) AS booked FROM appointments WHERE appointment_date = ? AND time_slot = ? AND status != 'cancelled'",
      [date, time]
    );
    if (Number(countRows[0].booked) >= capacity) {
      return res.status(409).json({ success: false, message: 'That time slot is fully booked. Please choose another slot.' });
    }

    const newStylist = await findAvailableStylist(date, time);
    if (!newStylist) {
      return res.status(409).json({ success: false, message: 'No stylists available for the requested slot.' });
    }

    await pool.query(
      `UPDATE appointments
       SET appointment_date = ?, time_slot = ?, stylist_id = ?,
           visit_status = 'scheduled', check_in_time = NULL, completed_time = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [date, time, newStylist.id, apt.id]
    );

    try {
      await dispatchNotification({ ...apt, appointment_date: date, time_slot: time }, 'rescheduled');
    } catch (e) {}

    // Smart Waiting List: the vacated original slot is now free — offer it.
    if (apt.appointment_date !== date || apt.time_slot !== time) {
      await releaseSlotToWaitingList(apt.appointment_date, apt.time_slot, apt.stylist_id);
    }

    res.json({ success: true, message: `Appointment #${id} rescheduled to ${date} ${time}.`, stylistName: newStylist.name });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Reschedule failed.', error: err.message });
  }
});

// 3. Fetch Master Dispatch Bookings (AUTHENTICATED ADMIN ONLY)
app.get('/api/appointments/admin', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const query = `
      SELECT
        a.booking_code AS id,
        a.user_id,
        a.stylist_id AS stylistId,
        st.name AS stylistName,
        a.client_name AS name,
        a.client_phone AS phone,
        a.client_email AS email,
        a.service_name AS service,
        a.appointment_date AS date,
        a.time_slot AS time,
        a.status,
        a.visit_status AS visitStatus,
        a.check_in_time AS checkInTime,
        a.completed_time AS completedTime,
        a.customer_notes AS message,
        a.admin_note AS adminNote,
        a.created_at AS createdAt,
        a.updated_at AS updatedAt
      FROM appointments a
      LEFT JOIN stylists st ON st.id = a.stylist_id
      WHERE a.status != 'waiting_list'
      ORDER BY a.id DESC
    `;

    const [rows] = await pool.query(query);
    res.json({ success: true, appointments: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve appointments.', error: err.message });
  }
});

// 4. Update Appointment Status (ADMIN ONLY)
app.patch('/api/appointments/:id/status', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { id } = req.params;
    const { status, adminNote, moveToWaitingList } = req.body || {};

    if (!['pending', 'review', 'confirmed', 'completed', 'cancelled', 'waiting_list'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value. Must be pending, review, confirmed, completed, cancelled, or waiting_list.' });
    }

    // Capture the pre-update row so a cancellation or waiting-list move can release its slot
    const [beforeRows] = await pool.query('SELECT * FROM appointments WHERE booking_code = ? OR id = ? LIMIT 1', [id, id]);
    if (beforeRows.length === 0) {
      return res.status(404).json({ success: false, message: `Appointment #${id} not found.` });
    }
    const b = beforeRows[0];
    const wasActive = b.status !== 'cancelled' && b.status !== 'waiting_list';

    // If moving to waiting list
    if (status === 'waiting_list' || (status === 'cancelled' && moveToWaitingList)) {
      let svcId = b.service_id || null;
      let svcName = b.service_name || 'Salon Service';
      if (!svcId && svcName) {
        try {
          const [svcRows] = await pool.query('SELECT id, service_name FROM services WHERE service_name = ? LIMIT 1', [svcName]);
          if (svcRows.length > 0) {
            svcId = svcRows[0].id;
            svcName = svcRows[0].service_name;
          }
        } catch (_) {}
      }

      const prefDate = (b.appointment_date instanceof Date
        ? b.appointment_date.toISOString().split('T')[0]
        : String(b.appointment_date || '')).split('T')[0] || new Date().toISOString().split('T')[0];

      const wlNote = adminNote || b.customer_notes || `Placed on Priority Waiting List from booking #${b.booking_code || b.id}`;
      const [wlInsert] = await pool.query(
        `INSERT INTO waiting_list
           (client_name, client_phone, client_email, preferred_date, preferred_time_slot, stylist_id, service_id, service_name, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting_list', ?)`,
        [
          b.client_name,
          b.client_phone,
          b.client_email || null,
          prefDate,
          b.time_slot || 'Any Time',
          b.stylist_id || null,
          svcId,
          svcName,
          wlNote
        ]
      );

      // Update status to 'waiting_list' in appointments table
      await pool.query(
        `UPDATE appointments
         SET status = 'waiting_list', admin_note = COALESCE(?, admin_note),
             stylist_id = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE booking_code = ? OR id = ?`,
        [wlNote, id, id]
      );

      if (wasActive) {
        await releaseSlotToWaitingList(prefDate, b.time_slot, b.stylist_id);
      }

      const customerMsg = `Dear ${b.client_name}, your requested appointment for ${svcName} on ${prefDate} (${b.time_slot || 'Any Time'}) is currently placed on our Priority Waiting List as the slot is fully booked. We will notify you immediately as soon as a slot opens up!`;

      // Trigger automated customer notification (Email / SMS)
      const notifyApt = {
        ...b,
        status: 'waiting_list',
        admin_note: wlNote,
        service_name: svcName
      };
      await dispatchNotification(notifyApt, 'waiting_list_joined');

      return res.json({
        success: true,
        message: 'Appointment moved to Waiting List and notification sent to client.',
        movedToWaitingList: true,
        status: 'waiting_list',
        waitingListId: wlInsert.insertId,
        customerNotification: customerMsg,
        entry: {
          id: wlInsert.insertId,
          client_name: b.client_name,
          client_phone: b.client_phone,
          client_email: b.client_email || null,
          preferred_date: prefDate,
          preferred_time_slot: b.time_slot || 'Any Time',
          stylist_id: b.stylist_id || null,
          service_id: svcId,
          service_name: svcName,
          status: 'waiting_list',
          notes: wlNote
        }
      });
    }

    const query = `
      UPDATE appointments
      SET status = ?, admin_note = COALESCE(?, admin_note),
          stylist_id = CASE WHEN ? = 'cancelled' THEN NULL ELSE stylist_id END,
          visit_status = CASE WHEN ? = 'completed' THEN 'completed' ELSE visit_status END,
          completed_time = CASE WHEN ? = 'completed' THEN NOW() ELSE completed_time END,
          updated_at = CURRENT_TIMESTAMP
      WHERE booking_code = ? OR id = ?
    `;

    const [updateResult] = await pool.query(query, [status, adminNote, status, status, status, id, id]);

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Appointment #${id} not found.` });
    }

    // Notification matrix: fire typed notifications on terminal status changes
    if (status === 'confirmed' || status === 'cancelled' || status === 'completed') {
      const [aptRows] = await pool.query('SELECT * FROM appointments WHERE booking_code = ? OR id = ?', [id, id]);
      if (aptRows.length > 0) {
        if (status === 'completed') {
          const completedApt = aptRows[0];
          try {
            const [svc] = await pool.query('SELECT price FROM services WHERE service_name = ? LIMIT 1', [completedApt.service_name]);
            const price = svc.length > 0 ? Number(svc[0].price) : 0;
            const [crm] = await pool.query(
              'SELECT id FROM clients WHERE phone = ? OR (email IS NOT NULL AND email != "" AND LOWER(email) = LOWER(?)) LIMIT 1',
              [completedApt.client_phone, completedApt.client_email]
            );
            if (crm.length > 0) {
              await pool.query(
                'UPDATE clients SET total_visits = total_visits + 1, total_spent = total_spent + ?, last_visit_date = ? WHERE id = ?',
                [price, completedApt.appointment_date, crm[0].id]
              );
            } else if (completedApt.client_phone) {
              await pool.query(
                'INSERT INTO clients (name, phone, email, total_visits, total_spent, last_visit_date) VALUES (?, ?, ?, 1, ?, ?)',
                [completedApt.client_name, completedApt.client_phone, completedApt.client_email || null, price, completedApt.appointment_date]
              );
            }
          } catch (crmErr) {
            console.error('[CRM ⚠] Completion totals update failed:', crmErr.message);
          }
          await dispatchNotification(completedApt, 'review_request');
        } else {
          await dispatchNotification(aptRows[0], status === 'confirmed' ? 'confirmed' : 'cancelled');
        }
      }
    }

    // Smart Waiting List: a freshly-cancelled slot frees capacity — offer it to the top matching waiting client.
    if (status === 'cancelled' && wasActive && beforeRows.length > 0) {
      const released = await releaseSlotToWaitingList(b.appointment_date, b.time_slot, b.stylist_id);
      if (released) {
        return res.json({
          success: true,
          message: `Appointment #${id} cancelled. Waiting-list client ${released.client_name} was notified of the opened slot.`,
          notifiedClient: released,
          releasedEntry: released
        });
      }
    }

    res.json({ success: true, message: `Appointment #${id} status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database update failed.', error: err.message });
  }
});

// Dedicated route to move an appointment directly into the waiting list
app.post('/api/appointments/:id/move-to-waiting-list', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { id } = req.params;
    const { notes } = req.body || {};

    let b = null;
    const [aptRows] = await pool.query('SELECT * FROM appointments WHERE booking_code = ? OR id = ? LIMIT 1', [id, id]);
    if (aptRows.length > 0) {
      b = aptRows[0];
    } else if (req.body && (req.body.name || req.body.client_name)) {
      b = {
        id: id,
        booking_code: id,
        client_name: req.body.name || req.body.client_name,
        client_phone: req.body.phone || req.body.client_phone || '0770000000',
        client_email: req.body.email || req.body.client_email || null,
        appointment_date: req.body.date || req.body.preferred_date || new Date().toISOString().split('T')[0],
        time_slot: req.body.time || req.body.preferred_time_slot || 'Any Time',
        stylist_id: req.body.stylist_id || req.body.stylistId || null,
        service_id: req.body.service_id || req.body.serviceId || null,
        service_name: req.body.service || req.body.service_name || 'Salon Service',
        customer_notes: req.body.notes || req.body.message || '',
        status: 'pending'
      };
    } else {
      return res.status(404).json({ success: false, message: `Appointment #${id} not found.` });
    }

    let svcId = b.service_id || null;
    let svcName = b.service_name || 'Salon Service';
    if (!svcId && svcName) {
      try {
        const [svcRows] = await pool.query('SELECT id, service_name FROM services WHERE service_name = ? LIMIT 1', [svcName]);
        if (svcRows.length > 0) {
          svcId = svcRows[0].id;
          svcName = svcRows[0].service_name;
        }
      } catch (_) {}
    }

    const prefDate = (b.appointment_date instanceof Date
      ? b.appointment_date.toISOString().split('T')[0]
      : String(b.appointment_date || '')).split('T')[0] || new Date().toISOString().split('T')[0];

    const wasActive = b.status !== 'cancelled' && b.status !== 'waiting_list';
    const wlNote = notes || b.customer_notes || `Placed on Priority Waiting List from booking #${b.booking_code || b.id}`;

    const [wlInsert] = await pool.query(
      `INSERT INTO waiting_list
         (client_name, client_phone, client_email, preferred_date, preferred_time_slot, stylist_id, service_id, service_name, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting_list', ?)`,
      [
        b.client_name,
        b.client_phone,
        b.client_email || null,
        prefDate,
        b.time_slot || 'Any Time',
        b.stylist_id || null,
        svcId,
        svcName,
        wlNote
      ]
    );

    // Update appointment status to 'waiting_list' in appointments table
    await pool.query(
      `UPDATE appointments
       SET status = 'waiting_list', admin_note = COALESCE(?, admin_note),
           stylist_id = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE booking_code = ? OR id = ?`,
      [wlNote, id, id]
    );

    if (wasActive) {
      await releaseSlotToWaitingList(prefDate, b.time_slot, b.stylist_id);
    }

    const customerMsg = `Dear ${b.client_name}, your requested appointment for ${svcName} on ${prefDate} (${b.time_slot || 'Any Time'}) is currently placed on our Priority Waiting List as the slot is fully booked. We will notify you immediately as soon as a slot opens up!`;

    // Trigger automated customer notification (Email / SMS)
    const notifyApt = {
      ...b,
      status: 'waiting_list',
      admin_note: wlNote,
      service_name: svcName
    };
    await dispatchNotification(notifyApt, 'waiting_list_joined');

    res.status(201).json({
      success: true,
      message: 'Appointment moved to Waiting List and notification sent to client.',
      movedToWaitingList: true,
      status: 'waiting_list',
      waitingListId: wlInsert.insertId,
      customerNotification: customerMsg,
      entry: {
        id: wlInsert.insertId,
        client_name: b.client_name,
        client_phone: b.client_phone,
        client_email: b.client_email || null,
        preferred_date: prefDate,
        preferred_time_slot: b.time_slot,
        stylist_id: b.stylist_id,
        service_id: svcId,
        service_name: svcName,
        status: 'waiting_list',
        notes: wlNote
      }
    });
  } catch (err) {
    console.error('Move appointment to waiting list error:', err);
    res.status(500).json({ success: false, message: 'Failed to move appointment to waiting list.', error: err.message });
  }
});

// 5. Update Salon Admin Note (ADMIN ONLY)
app.patch('/api/appointments/:id/note', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { id } = req.params;
    const { adminNote } = req.body;

    const query = `
      UPDATE appointments 
      SET admin_note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE booking_code = ? OR id = ?
    `;

    await pool.query(query, [adminNote || '', id, id]);
    res.json({ success: true, message: 'Salon note updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update note.', error: err.message });
  }
});

// 6. Delete Individual Appointment Record (Users or Admins)
app.delete('/api/appointments/:id', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { id } = req.params;

    // Capture the target rows first so a successful delete can release their
    // slots to the waiting list. Only non-cancelled rows free real capacity.
    const [targets] = await pool.query(
      "SELECT appointment_date, time_slot, stylist_id FROM appointments WHERE (booking_code = ? OR id = ?) AND status != 'cancelled'",
      [id, id]
    );
    const releaseFreedSlots = async () => {
      for (const t of targets) {
        await releaseSlotToWaitingList(t.appointment_date, t.time_slot, t.stylist_id);
      }
    };

    // Check if user is admin
    if (req.user && req.user.role === 'admin') {
      const [result] = await pool.query('DELETE FROM appointments WHERE booking_code = ? OR id = ?', [id, id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `Appointment #${id} not found in database.` });
      }
      await releaseFreedSlots();
      return res.json({ success: true, message: `Appointment #${id} record deleted from MySQL database.` });
    }

    // If client is logged in, verify ownership or booking code
    if (req.user && req.user.role === 'client') {
      const [result] = await pool.query(
        'DELETE FROM appointments WHERE (booking_code = ? OR id = ?) AND (user_id = ? OR (client_email IS NOT NULL AND client_email != "" AND LOWER(client_email) = LOWER(?)))',
        [id, id, req.user.id || 0, req.user.email || '']
      );
      if (result.affectedRows > 0) {
        await releaseFreedSlots();
        return res.json({ success: true, message: `Appointment #${id} deleted successfully.` });
      }
    }

    // Direct booking code deletion fallback
    const [result] = await pool.query('DELETE FROM appointments WHERE booking_code = ? OR id = ?', [id, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Appointment #${id} not found in database.` });
    }

    await releaseFreedSlots();
    res.json({ success: true, message: `Appointment #${id} record deleted successfully from MySQL database.` });
  } catch (err) {
    console.error('Delete appointment error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete appointment from database.', error: err.message });
  }
});

// 7. Bulk Delete Appointments (Delete All)
app.delete('/api/appointments', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { scope } = req.query;

    // If a logged-in client calls without explicit admin scope, clear only client's own bookings
    if (req.user && req.user.role === 'client' && scope !== 'all') {
      const [result] = await pool.query(
        'DELETE FROM appointments WHERE user_id = ? OR (client_email IS NOT NULL AND client_email != "" AND LOWER(client_email) = LOWER(?))',
        [req.user.id || 0, req.user.email || '']
      );
      return res.json({
        success: true,
        message: `All your appointment records (${result.affectedRows}) have been cleared from database.`,
        deletedCount: result.affectedRows
      });
    }

    // Admin or Master clear: delete all records from appointments table
    const [result] = await pool.query('DELETE FROM appointments');
    res.json({
      success: true,
      message: `All appointment records (${result.affectedRows}) deleted successfully from MySQL database.`,
      deletedCount: result.affectedRows
    });
  } catch (err) {
    console.error('Bulk delete appointments error:', err);
    res.status(500).json({ success: false, message: 'Failed to clear appointments from database.', error: err.message });
  }
});
// =========================================================================
// 5b. SMART WAITING LIST — queue for fully-booked slots + auto slot release
// =========================================================================

/**
 * Send the "slot just opened" alert to a waiting-list entry via the existing
 * email/WhatsApp matrix and audit it in notification_log. Never throws.
 */
async function notifyWaitingClient(entry) {
  try {
    const pseudoApt = {
      id: null,
      booking_code: `WL-${entry.id}`,
      client_name: entry.client_name,
      client_phone: entry.client_phone,
      client_email: entry.client_email,
      service_name: entry.service_name || 'Salon Service',
      appointment_date: entry.preferred_date,
      time_slot: entry.preferred_time_slot,
      stylist_id: entry.stylist_id || null
    };
    await dispatchNotification(pseudoApt, 'slot_available');
  } catch (err) {
    console.error('[WaitingList ⚠] slot_available notification failed:', err.message);
  }
}

/**
 * Automatic Slot Release — when an appointment is cancelled/deleted/rescheduled
 * away, find the TOP matching pending waiting-list client for that date+slot and
 * promote them to 'notified', firing an automated alert. Matching is tolerant:
 * a waiting entry with no specific slot (empty) matches any freed slot that day,
 * and an entry with no stylist preference matches any stylist. Never throws.
 * @returns {Promise<object|null>} the notified waiting-list row, or null.
 */
async function releaseSlotToWaitingList(date, timeSlot, stylistId) {
  try {
    if (!pool || !date) return null;

    const sId = (Number.isInteger(Number(stylistId)) && Number(stylistId) > 0) ? Number(stylistId) : null;
    const slot = (timeSlot || '').trim();

    // Query waiting_list for matching preferred_date and stylist_id (or flexible stylist)
    // Ordered to prioritize exact slot matches first, then earliest pending queue entry.
    const [candidates] = await pool.query(
      `SELECT * FROM waiting_list
       WHERE status = 'pending'
         AND preferred_date = ?
         AND (stylist_id = ? OR stylist_id IS NULL OR ? IS NULL)
       ORDER BY
         CASE
           WHEN (? IS NOT NULL AND stylist_id = ? AND preferred_time_slot = ? AND ? != '') THEN 0
           WHEN (? IS NOT NULL AND stylist_id = ? AND (preferred_time_slot IS NULL OR preferred_time_slot = '' OR preferred_time_slot LIKE '%Any%')) THEN 1
           WHEN (? IS NOT NULL AND stylist_id = ?) THEN 2
           WHEN (preferred_time_slot = ? AND ? != '') THEN 3
           ELSE 4
         END ASC,
         created_at ASC, id ASC
       LIMIT 1`,
      [
        date, sId, sId,
        sId, sId, slot, slot,
        sId, sId,
        sId, sId,
        slot, slot
      ]
    );

    if (candidates.length === 0) return null;
    const entry = candidates[0];

    await pool.query(
      "UPDATE waiting_list SET status = 'notified', notified_at = CURRENT_TIMESTAMP WHERE id = ?",
      [entry.id]
    );
    entry.status = 'notified';

    console.log(`[WaitingList ✓] Slot released ${date} ${slot} → flagged top waiting client #${entry.id} (${entry.client_name}) as notified.`);
    await notifyWaitingClient(entry);
    return entry;
  } catch (err) {
    console.error('[WaitingList ⚠] releaseSlotToWaitingList failed:', err.message);
    return null;
  }
}

/**
 * Convert a waiting-list entry into a real appointment (admin manually assigns a
 * freed slot). Re-runs capacity + stylist auto-assignment, marks the entry
 * 'booked', and sends a confirmation. Returns the created booking summary.
 */
async function bookFromWaitingList(entry) {
  const date = entry.preferred_date;
  const time = entry.preferred_time_slot;

  const bookable = await countBookableStylists(date, time);
  const capacity = Math.min(MAX_BOOKINGS_PER_SLOT, bookable);
  const [countRows] = await pool.query(
    "SELECT COUNT(*) AS booked FROM appointments WHERE appointment_date = ? AND time_slot = ? AND status != 'cancelled'",
    [date, time]
  );
  if (Number(countRows[0].booked) >= capacity) {
    const err = new Error('That slot is already full again — cannot assign right now.');
    err.status = 409;
    throw err;
  }

  // Prefer the client's requested stylist if still free; otherwise auto-assign.
  let stylist = null;
  if (entry.stylist_id) {
    const [rows] = await pool.query('SELECT id, name FROM stylists WHERE id = ? AND is_active = 1 LIMIT 1', [entry.stylist_id]);
    if (rows.length) {
      const [busy] = await pool.query(
        "SELECT COUNT(*) AS c FROM appointments WHERE stylist_id = ? AND appointment_date = ? AND time_slot = ? AND status != 'cancelled'",
        [entry.stylist_id, date, time]
      );
      if (Number(busy[0].c) === 0) stylist = rows[0];
    }
  }
  if (!stylist) stylist = await findAvailableStylist(date, time);
  if (!stylist) {
    const err = new Error('No stylist available for that slot right now.');
    err.status = 409;
    throw err;
  }

  const bookingCode = 'APT-' + Math.floor(10000 + Math.random() * 90000);
  const serviceName = entry.service_name || 'Salon Service';
  await pool.query(
    `INSERT INTO appointments
       (booking_code, stylist_id, client_name, client_phone, client_email, service_name, service_id, appointment_date, time_slot, status, customer_notes, admin_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
    [
      bookingCode, stylist.id, entry.client_name, entry.client_phone, entry.client_email || '',
      serviceName, entry.service_id || null, date, time,
      entry.notes || 'Booked from waiting list.',
      'Assigned from the Smart Waiting List.'
    ]
  );

  await pool.query("UPDATE waiting_list SET status = 'booked' WHERE id = ?", [entry.id]);

  const apt = {
    booking_code: bookingCode,
    client_name: entry.client_name,
    client_phone: entry.client_phone,
    client_email: entry.client_email,
    service_name: serviceName,
    appointment_date: date,
    time_slot: time,
    stylist_id: stylist.id,
    admin_note: 'Assigned from the Smart Waiting List.'
  };
  try { await dispatchNotification(apt, 'confirmed'); } catch (e) {}
  return { bookingCode, stylistName: stylist.name, date, time };
}

// Public: join the waiting list for a fully-booked slot.
app.post('/api/waiting-list', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const b = req.body || {};
    const clientName  = String(b.client_name || b.clientName || b.name || '').trim();
    const clientPhone = String(b.client_phone || b.clientPhone || b.phone || '').trim();
    const clientEmail = String(b.client_email || b.clientEmail || b.email || '').trim().toLowerCase();
    const prefDate    = String(b.preferred_date || b.preferredDate || b.date || '').trim();
    const rawSlot     = String(b.preferred_time_slot || b.preferredTimeSlot || b.time || b.timeSlot || '').trim();
    const prefSlot    = rawSlot || 'Any Time';
    const serviceName = b.service_name || b.serviceName ? String(b.service_name || b.serviceName).trim() : null;
    const notes       = b.notes ? String(b.notes).trim() : null;
    const stylistId   = Number.isInteger(Number(b.stylist_id ?? b.stylistId)) && Number(b.stylist_id ?? b.stylistId) > 0 ? Number(b.stylist_id ?? b.stylistId) : null;
    let   serviceId   = Number.isInteger(Number(b.service_id ?? b.serviceId)) && Number(b.service_id ?? b.serviceId) > 0 ? Number(b.service_id ?? b.serviceId) : null;

    if (!clientName || !clientPhone || !prefDate) {
      return res.status(400).json({ success: false, message: 'Name, phone, and preferred date are required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(prefDate)) {
      return res.status(400).json({ success: false, message: 'Preferred date must be in YYYY-MM-DD format.' });
    }

    // Resolve service_id from the service name when the id wasn't supplied.
    if (!serviceId && serviceName) {
      try {
        const [svc] = await pool.query('SELECT id FROM services WHERE service_name = ? LIMIT 1', [serviceName]);
        if (svc.length) serviceId = svc[0].id;
      } catch (e) {}
    }

    // Avoid exact duplicate active entries (same phone + date + slot).
    const [dupe] = await pool.query(
      "SELECT id FROM waiting_list WHERE client_phone = ? AND preferred_date = ? AND preferred_time_slot = ? AND status IN ('pending','notified') LIMIT 1",
      [clientPhone, prefDate, prefSlot]
    );
    if (dupe.length) {
      return res.status(409).json({ success: false, message: 'You are already on the waiting list for this slot.' });
    }

    const [result] = await pool.query(
      `INSERT INTO waiting_list
         (client_name, client_phone, client_email, preferred_date, preferred_time_slot, stylist_id, service_id, service_name, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [clientName, clientPhone, clientEmail || null, prefDate, prefSlot, stylistId, serviceId, serviceName, notes]
    );

    const [posRows] = await pool.query(
      "SELECT COUNT(*) AS ahead FROM waiting_list WHERE status = 'pending' AND preferred_date = ? AND preferred_time_slot = ? AND created_at < (SELECT created_at FROM waiting_list WHERE id = ?)",
      [prefDate, prefSlot, result.insertId]
    );
    const position = Number(posRows[0].ahead) + 1;

    const entry = {
      id: result.insertId,
      client_name: clientName,
      clientName,
      client_phone: clientPhone,
      clientPhone,
      client_email: clientEmail || null,
      clientEmail: clientEmail || null,
      preferred_date: prefDate,
      preferredDate: prefDate,
      preferred_time_slot: prefSlot,
      preferredTimeSlot: prefSlot,
      stylist_id: stylistId,
      stylistId,
      service_id: serviceId,
      serviceId,
      service_name: serviceName,
      serviceName,
      status: 'pending',
      notes,
      position
    };

    res.status(201).json({
      success: true,
      id: result.insertId,
      position,
      entry,
      data: entry,
      message: `You've joined the waiting list for ${prefDate} (${prefSlot}). You're #${position} in line — we'll alert you the moment a spot opens.`
    });
  } catch (err) {
    console.error('Waiting list join error:', err);
    res.status(500).json({ success: false, message: 'Failed to join the waiting list.', error: err.message });
  }
});

// Admin: list waiting-list entries with optional filters + summary counts.
app.get('/api/waiting-list', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    // Auto-sync: ensure any appointments with status = 'waiting_list' are present in waiting_list table
    try {
      const [unlinkedApts] = await pool.query(`
        SELECT a.* FROM appointments a
        WHERE a.status = 'waiting_list'
          AND NOT EXISTS (
            SELECT 1 FROM waiting_list w
            WHERE w.client_phone = a.client_phone
              AND w.preferred_date = DATE_FORMAT(a.appointment_date, '%Y-%m-%d')
              AND w.preferred_time_slot = a.time_slot
          )
      `);
      for (const apt of unlinkedApts) {
        let sId = apt.service_id || null;
        let sName = apt.service_name || 'Salon Service';
        if (!sId && sName) {
          try {
            const [sRows] = await pool.query('SELECT id, service_name FROM services WHERE service_name = ? LIMIT 1', [sName]);
            if (sRows.length > 0) {
              sId = sRows[0].id;
              sName = sRows[0].service_name;
            }
          } catch (_) {}
        }
        const aDate = (apt.appointment_date instanceof Date ? apt.appointment_date.toISOString().split('T')[0] : String(apt.appointment_date || '')).split('T')[0];
        await pool.query(`
          INSERT INTO waiting_list
            (client_name, client_phone, client_email, preferred_date, preferred_time_slot, stylist_id, service_id, service_name, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting_list', ?)
        `, [
          apt.client_name,
          apt.client_phone,
          apt.client_email || null,
          aDate,
          apt.time_slot || 'Any Time',
          apt.stylist_id || null,
          sId,
          sName,
          apt.admin_note || apt.customer_notes || `Placed on Priority Waiting List from booking #${apt.booking_code || apt.id}`
        ]);
      }
    } catch (syncErr) {
      console.warn('Waiting list auto-sync note (non-fatal):', syncErr.message);
    }

    const { status, date, stylistId } = req.query;
    const where = [];
    const params = [];
    if (status && status !== 'all') {
      if (status === 'pending' || status === 'waiting_list') {
        where.push("(w.status = 'pending' OR w.status = 'waiting_list')");
      } else if (['notified', 'booked', 'cancelled'].includes(status)) {
        where.push('w.status = ?');
        params.push(status);
      }
    }
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { where.push('w.preferred_date = ?'); params.push(date); }
    if (stylistId && Number.isInteger(Number(stylistId))) { where.push('w.stylist_id = ?'); params.push(Number(stylistId)); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT
         w.id,
         w.client_name, w.client_name AS clientName,
         w.client_phone, w.client_phone AS clientPhone,
         w.client_email, w.client_email AS clientEmail,
         w.preferred_date, w.preferred_date AS preferredDate,
         w.preferred_time_slot, w.preferred_time_slot AS preferredTimeSlot,
         w.stylist_id, w.stylist_id AS stylistId,
         st.name AS stylistName,
         w.service_id, w.service_id AS serviceId,
         COALESCE(w.service_name, svc.service_name) AS serviceName,
         COALESCE(w.service_name, svc.service_name) AS service_name,
         w.status, w.notes,
         w.notified_at, w.notified_at AS notifiedAt,
         w.created_at, w.created_at AS createdAt,
         (SELECT COUNT(*) + 1 FROM waiting_list w2
            WHERE w2.status IN ('pending', 'waiting_list') AND w2.preferred_date = w.preferred_date
              AND w2.preferred_time_slot = w.preferred_time_slot AND w2.created_at < w.created_at) AS queuePosition
       FROM waiting_list w
       LEFT JOIN stylists st ON st.id = w.stylist_id
       LEFT JOIN services svc ON svc.id = w.service_id
       ${whereSql}
       ORDER BY FIELD(w.status, 'waiting_list', 'pending', 'notified', 'booked', 'cancelled'), w.preferred_date ASC, w.created_at ASC, w.id ASC`,
      params
    );

    const [sumRows] = await pool.query(
      "SELECT status, COUNT(*) AS c FROM waiting_list GROUP BY status"
    );
    const summary = { pending: 0, waiting_list: 0, notified: 0, booked: 0, cancelled: 0, total: 0 };
    sumRows.forEach(r => {
      summary[r.status] = Number(r.c);
      summary.total += Number(r.c);
    });
    // For pending queue count, combine 'pending' and 'waiting_list'
    const pendingTotal = (summary.pending || 0) + (summary.waiting_list || 0);
    summary.pending = pendingTotal;
    summary.waiting_list = pendingTotal;

    res.json({
      success: true,
      entries: rows,
      data: rows,
      waitingList: rows,
      summary
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve waiting list.', error: err.message });
  }
});

// Admin: update a waiting-list entry's status (and optionally notify on 'notified').
app.patch('/api/waiting-list/:id/status', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['pending', 'waiting_list', 'notified', 'booked', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be pending, waiting_list, notified, booked or cancelled.' });
    }

    const [rows] = await pool.query('SELECT * FROM waiting_list WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: `Waiting list entry #${id} not found.` });
    const entry = rows[0];

    if (status === 'notified') {
      await pool.query("UPDATE waiting_list SET status = 'notified', notified_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
      await notifyWaitingClient({ ...entry, status: 'notified' });
      return res.json({ success: true, message: `Alert sent to ${entry.client_name}.`, status: 'notified' });
    }

    await pool.query('UPDATE waiting_list SET status = ? WHERE id = ?', [status, id]);
    res.json({ success: true, message: `Waiting list entry #${id} marked ${status}.`, status });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update waiting list entry.', error: err.message });
  }
});

// Admin: assign a freed slot to a waiting client (creates a real appointment).
app.post('/api/waiting-list/:id/assign', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM waiting_list WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: `Waiting list entry #${id} not found.` });

    const booking = await bookFromWaitingList(rows[0]);
    res.json({
      success: true,
      message: `Slot assigned to ${rows[0].client_name} — booking ${booking.bookingCode} created with ${booking.stylistName}.`,
      booking
    });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to assign slot.' });
  }
});

// Admin: manually (re)trigger the slot-available alert for an entry.
app.post('/api/waiting-list/:id/notify', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM waiting_list WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: `Waiting list entry #${id} not found.` });
    await pool.query("UPDATE waiting_list SET status = 'notified', notified_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    await notifyWaitingClient({ ...rows[0], status: 'notified' });
    res.json({ success: true, message: `Availability alert sent to ${rows[0].client_name}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send alert.', error: err.message });
  }
});

// Admin: delete a waiting-list entry.
app.delete('/api/waiting-list/:id', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [result] = await pool.query('DELETE FROM waiting_list WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: `Waiting list entry #${req.params.id} not found.` });
    res.json({ success: true, message: `Waiting list entry #${req.params.id} removed.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete waiting list entry.', error: err.message });
  }
});

// =========================================================================
// 6. DAY-VIEW DISPATCH BOARD (ADMIN ONLY) — per-stylist live timeline
// =========================================================================
app.get('/api/dispatch/board', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : null;
    if (!date) return res.status(400).json({ success: false, message: 'Date parameter (YYYY-MM-DD) is required.' });

    const [stylists] = await pool.query(
      'SELECT id, name, specialization FROM stylists WHERE is_active = 1 ORDER BY name ASC'
    );

    const [apts] = await pool.query(
      `SELECT
         a.id, a.booking_code AS bookingCode, a.stylist_id AS stylistId,
         a.client_name AS clientName, a.client_phone AS clientPhone, a.client_email AS clientEmail,
         a.service_name AS service, a.time_slot AS timeSlot,
         a.status, a.visit_status AS visitStatus,
         a.check_in_time AS checkInTime, a.completed_time AS completedTime,
         a.customer_notes AS customerNotes, a.admin_note AS adminNote
       FROM appointments a
       WHERE a.appointment_date = ? AND a.status != 'cancelled'
       ORDER BY a.time_slot ASC`,
      [date]
    );

    const [blocks] = await pool.query(
      'SELECT b.id, b.stylist_id AS stylistId, b.time_slot AS timeSlot, b.reason FROM stylist_blocks b WHERE b.block_date = ?',
      [date]
    );

    const [offs] = await pool.query(
      'SELECT t.stylist_id AS stylistId, t.reason FROM stylist_time_offs t WHERE t.off_date = ?',
      [date]
    );

    const board = stylists.map(s => ({
      stylistId: s.id,
      name: s.name,
      specialization: s.specialization,
      onDayOff: offs.some(o => o.stylistId === s.id),
      appointments: apts.filter(a => a.stylistId === s.id),
      blocks: blocks.filter(b => b.stylistId === s.id)
    }));

    res.json({ success: true, date, board, unassigned: apts.filter(a => !a.stylistId) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to build dispatch board.', error: err.message });
  }
});

// Public: fetch invoice for a booking
app.get('/api/invoice/:bookingCode', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { bookingCode } = req.params;
    const [aptRows] = await pool.query(
      `SELECT a.*, s.price FROM appointments a LEFT JOIN services s ON a.service_id = s.id WHERE a.booking_code = ? OR a.id = ?`,
      [bookingCode, bookingCode]
    );
    if (aptRows.length === 0) {
      return res.status(404).json({ success: false, message: `Appointment ${bookingCode} not found.` });
    }
    const apt = aptRows[0];
    const invoice = {
      salon: {
        name: 'Salon Hair Bird',
        address: '123 Colombo Street, Colombo 07, Sri Lanka',
        phone: '077 123 4567',
        email: 'info@salonhairbird.com'
      },
      invoiceId: apt.booking_code,
      clientName: apt.client_name,
      clientPhone: apt.client_phone,
      clientEmail: apt.client_email,
      service: apt.service_name,
      price: apt.price || 0,
      date: apt.appointment_date,
      timeSlot: apt.time_slot,
      stylistId: apt.stylist_id
    };
    res.json({ success: true, invoice });
  } catch (err) {
    console.error('Invoice fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch invoice.', error: err.message });
  }
});

// =========================================================================
// 7. VISIT LIFECYCLE (ADMIN ONLY) — check-in / complete / no-show
// =========================================================================
app.patch('/api/appointments/:id/visit', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { id } = req.params;
    const { visitStatus } = req.body;
    if (!['scheduled', 'checked_in', 'completed', 'no_show'].includes(visitStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid visitStatus. Must be scheduled, checked_in, completed, or no_show.' });
    }

    const [aptRows] = await pool.query('SELECT * FROM appointments WHERE booking_code = ? OR id = ?', [id, id]);
    if (aptRows.length === 0) return res.status(404).json({ success: false, message: `Appointment #${id} not found.` });
    const apt = aptRows[0];

    const sets = ['visit_status = ?'];
    const params = [visitStatus];
    if (visitStatus === 'checked_in') { sets.push('check_in_time = NOW()'); }
    if (visitStatus === 'completed')  { sets.push('completed_time = NOW()', 'status = "completed"'); }
    if (visitStatus === 'scheduled')  { sets.push('check_in_time = NULL', 'completed_time = NULL'); }

    await pool.query(
      `UPDATE appointments SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...params, apt.id]
    );

    // Completion side-effects: CRM totals + review request
    if (visitStatus === 'completed') {
      try {
        const [svc] = await pool.query('SELECT price FROM services WHERE service_name = ? LIMIT 1', [apt.service_name]);
        const price = svc.length > 0 ? Number(svc[0].price) : 0;
        const [crm] = await pool.query(
          'SELECT id FROM clients WHERE phone = ? OR (email IS NOT NULL AND email != "" AND LOWER(email) = LOWER(?)) LIMIT 1',
          [apt.client_phone, apt.client_email]
        );
        if (crm.length > 0) {
          await pool.query(
            'UPDATE clients SET total_visits = total_visits + 1, total_spent = total_spent + ?, last_visit_date = ? WHERE id = ?',
            [price, apt.appointment_date, crm[0].id]
          );
        } else if (apt.client_phone) {
          await pool.query(
            'INSERT INTO clients (name, phone, email, total_visits, total_spent, last_visit_date) VALUES (?, ?, ?, 1, ?, ?)',
            [apt.client_name, apt.client_phone, apt.client_email || null, price, apt.appointment_date]
          );
        }
      } catch (crmErr) {
        console.error('[CRM ⚠] Completion totals update failed:', crmErr.message);
      }
      try { await dispatchNotification(apt, 'review_request'); } catch (e) {}
    }

    // No-show side-effect: follow-up message
    if (visitStatus === 'no_show') {
      try { await dispatchNotification(apt, 'no_show_followup'); } catch (e) {}
    }

    res.json({ success: true, message: `Appointment #${id} visit status updated to ${visitStatus}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update visit status.', error: err.message });
  }
});

// =========================================================================
// 8. RESCHEDULE / REASSIGN (ADMIN ONLY)
// =========================================================================
app.patch('/api/appointments/:id/reschedule', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { id } = req.params;
    const { date, time } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || typeof time !== 'string') {
      return res.status(400).json({ success: false, message: 'Valid date (YYYY-MM-DD) and time slot are required.' });
    }

    const [aptRows] = await pool.query('SELECT * FROM appointments WHERE booking_code = ? OR id = ?', [id, id]);
    if (aptRows.length === 0) return res.status(404).json({ success: false, message: `Appointment #${id} not found.` });
    const apt = aptRows[0];

    if (apt.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cancelled appointments cannot be rescheduled. Rebook instead.' });
    }

    if (apt.appointment_date === date && apt.time_slot === time) {
      return res.json({ success: true, message: 'Appointment already at the requested date/time.', unchanged: true });
    }

    // Capacity check for the NEW slot (current booking occupies the old slot only)
    const bookable = await countBookableStylists(date, time);
    const capacity = Math.min(MAX_BOOKINGS_PER_SLOT, bookable);
    const [countRows] = await pool.query(
      "SELECT COUNT(*) AS booked FROM appointments WHERE appointment_date = ? AND time_slot = ? AND status != 'cancelled'",
      [date, time]
    );
    if (Number(countRows[0].booked) >= capacity) {
      return res.status(409).json({ success: false, message: 'Target time slot is fully booked. Choose another slot.' });
    }

    const newStylist = await findAvailableStylist(date, time);
    if (!newStylist) {
      return res.status(409).json({ success: false, message: 'No stylists available for the target slot.' });
    }

    await pool.query(
      `UPDATE appointments
       SET appointment_date = ?, time_slot = ?, stylist_id = ?,
           visit_status = 'scheduled', check_in_time = NULL, completed_time = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [date, time, newStylist.id, apt.id]
    );

    // Notify client with UPDATED date/time
    try {
      await dispatchNotification({ ...apt, appointment_date: date, time_slot: time }, 'rescheduled');
    } catch (e) {}

    // Smart Waiting List: the vacated original slot is now free — offer it.
    await releaseSlotToWaitingList(apt.appointment_date, apt.time_slot, apt.stylist_id);

    res.json({ success: true, message: `Appointment #${id} rescheduled to ${date} ${time}.`, stylistName: newStylist.name });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Reschedule failed.', error: err.message });
  }
});

// Drag-and-drop reassignment between stylists (same slot)
app.patch('/api/appointments/:id/reassign', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { id } = req.params;
    const stylistId = Number(req.body.stylistId);
    if (!Number.isInteger(stylistId) || stylistId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid stylistId is required.' });
    }

    const [aptRows] = await pool.query('SELECT * FROM appointments WHERE booking_code = ? OR id = ?', [id, id]);
    if (aptRows.length === 0) return res.status(404).json({ success: false, message: `Appointment #${id} not found.` });
    const apt = aptRows[0];

    const [stylistRows] = await pool.query('SELECT id, name FROM stylists WHERE id = ? AND is_active = 1', [stylistId]);
    if (stylistRows.length === 0) return res.status(400).json({ success: false, message: 'Target stylist not found or inactive.' });

    // Target must be working: not on day-off, not blocked for this slot, no clash
    const [conflict] = await pool.query(
      `SELECT a.id FROM appointments a
       WHERE a.stylist_id = ? AND a.appointment_date = ? AND a.time_slot = ? AND a.status != 'cancelled' AND a.id != ?
       LIMIT 1`,
      [stylistId, apt.appointment_date, apt.time_slot, apt.id]
    );
    if (conflict.length > 0) {
      return res.status(409).json({ success: false, message: `${stylistRows[0].name} already has a booking in this slot.` });
    }
    const [offRows] = await pool.query(
      'SELECT id FROM stylist_time_offs WHERE stylist_id = ? AND off_date = ? LIMIT 1',
      [stylistId, apt.appointment_date]
    );
    if (offRows.length > 0) {
      return res.status(409).json({ success: false, message: `${stylistRows[0].name} is off on ${apt.appointment_date}.` });
    }
    const [blockRows] = await pool.query(
      'SELECT id FROM stylist_blocks WHERE stylist_id = ? AND block_date = ? AND time_slot = ? LIMIT 1',
      [stylistId, apt.appointment_date, apt.time_slot]
    );
    if (blockRows.length > 0) {
      return res.status(409).json({ success: false, message: `${stylistRows[0].name} is blocked for this time slot.` });
    }

    await pool.query('UPDATE appointments SET stylist_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [stylistId, apt.id]);
    res.json({ success: true, message: `Appointment #${id} reassigned to ${stylistRows[0].name}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Reassignment failed.', error: err.message });
  }
});

// =========================================================================
// 9. STYLIST BLOCK-OUT TIMES (ADMIN ONLY) — breaks / training / unavailable
// =========================================================================
app.get('/api/stylists/blocks', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { date, stylistId } = req.query;
    let query = `SELECT b.id, b.stylist_id AS stylistId, s.name AS stylistName, b.block_date AS blockDate,
                        b.time_slot AS timeSlot, b.reason, b.created_at AS createdAt
                 FROM stylist_blocks b JOIN stylists s ON s.id = b.stylist_id`;
    const params = [];
    const conds = [];
    if (date) { conds.push('b.block_date = ?'); params.push(date); }
    if (stylistId) { conds.push('b.stylist_id = ?'); params.push(Number(stylistId)); }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY b.block_date ASC, b.stylist_id ASC';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, blocks: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load block-outs.', error: err.message });
  }
});

app.post('/api/stylists/blocks', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { stylistId, date, timeSlot, reason } = req.body;
    if (!Number.isInteger(Number(stylistId)) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !timeSlot) {
      return res.status(400).json({ success: false, message: 'stylistId, date (YYYY-MM-DD) and timeSlot are required.' });
    }
    const [stylistRows] = await pool.query('SELECT id, name FROM stylists WHERE id = ? AND is_active = 1', [Number(stylistId)]);
    if (stylistRows.length === 0) return res.status(400).json({ success: false, message: 'Stylist not found or inactive.' });

    // INSERT IGNORE — unique key (stylist_id, block_date, time_slot) makes re-adding idempotent
    const [result] = await pool.query(
      'INSERT IGNORE INTO stylist_blocks (stylist_id, block_date, time_slot, reason) VALUES (?, ?, ?, ?)',
      [Number(stylistId), date, String(timeSlot), (reason || '').trim() || null]
    );
    if (result.affectedRows === 0) {
      return res.json({ success: true, message: 'Block-out already exists for this stylist/slot.', duplicate: true });
    }
    res.status(201).json({ success: true, message: `Block-out added for ${stylistRows[0].name} on ${date} ${timeSlot}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add block-out.', error: err.message });
  }
});

app.delete('/api/stylists/blocks/:id', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [result] = await pool.query('DELETE FROM stylist_blocks WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Block-out not found.' });
    res.json({ success: true, message: 'Block-out removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove block-out.', error: err.message });
  }
});

// =========================================================================
// 10. CLIENT CRM (ADMIN ONLY) — profiles, notes, photos, visit history
// =========================================================================
app.get('/api/clients', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    // 1. Auto-sync registered users (role='client') into clients table
    try {
      const [userClients] = await pool.query(
        "SELECT name, phone, email FROM users WHERE role = 'client'"
      );
      for (const u of userClients) {
        if (!u.phone && !u.email) continue;
        await pool.query(
          `INSERT INTO clients (name, phone, email)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE name = COALESCE(name, VALUES(name))`,
          [u.name || 'Registered Customer', u.phone || null, (u.email || '').toLowerCase().trim() || null]
        );
      }
    } catch (_) {}

    // 2. Auto-sync customers who booked appointments into clients table
    try {
      const [aptClients] = await pool.query(`
        SELECT client_name AS name, client_phone AS phone, client_email AS email,
               COUNT(*) AS visits, MAX(appointment_date) AS last_date
        FROM appointments
        WHERE (client_phone IS NOT NULL AND client_phone != '') OR (client_email IS NOT NULL AND client_email != '')
        GROUP BY client_phone, client_email
      `);
      for (const a of aptClients) {
        if (!a.phone && !a.email) continue;
        await pool.query(
          `INSERT INTO clients (name, phone, email, total_visits, last_visit_date)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = COALESCE(clients.name, VALUES(name)),
             total_visits = GREATEST(clients.total_visits, VALUES(total_visits)),
             last_visit_date = COALESCE(VALUES(last_visit_date), clients.last_visit_date)`,
          [a.name || 'Valued Client', a.phone || null, (a.email || '').toLowerCase().trim() || null, a.visits || 0, a.last_date || null]
        );
      }
    } catch (_) {}

    const search = (req.query.search || '').trim();
    let query = `
      SELECT c.id, c.name, c.phone, c.email, c.allergies,
             c.color_formula_notes AS colorFormulaNotes,
             c.general_notes AS generalNotes,
             GREATEST(COALESCE(c.total_visits, 0), COALESCE((
               SELECT COUNT(*) FROM appointments a
               WHERE (c.phone IS NOT NULL AND c.phone != '' AND a.client_phone = c.phone)
                  OR (c.email IS NOT NULL AND c.email != '' AND LOWER(a.client_email) = LOWER(c.email))
             ), 0)) AS totalVisits,
             c.total_spent AS totalSpent,
             c.last_visit_date AS lastVisitDate,
             c.created_at AS createdAt
      FROM clients c
    `;
    const params = [];
    if (search) {
      query += ' WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?';
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    query += ' ORDER BY totalVisits DESC, c.name ASC LIMIT 250';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, clients: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load clients.', error: err.message });
  }
});

app.get('/api/clients/:id', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [clientRows] = await pool.query(
      `SELECT c.id, c.name, c.phone, c.email, c.allergies,
              c.color_formula_notes AS colorFormulaNotes,
              c.general_notes AS generalNotes,
              GREATEST(COALESCE(c.total_visits, 0), COALESCE((
                SELECT COUNT(*) FROM appointments a
                WHERE (c.phone IS NOT NULL AND c.phone != '' AND a.client_phone = c.phone)
                   OR (c.email IS NOT NULL AND c.email != '' AND LOWER(a.client_email) = LOWER(c.email))
              ), 0)) AS totalVisits,
              c.total_spent AS totalSpent,
              c.last_visit_date AS lastVisitDate,
              c.created_at AS createdAt
       FROM clients c WHERE c.id = ?`,
      [req.params.id]
    );
    if (clientRows.length === 0) return res.status(404).json({ success: false, message: 'Client not found.' });
    const client = clientRows[0];

    // Related appointment and service records for this specific client
    const [historyRows] = await pool.query(
      `SELECT a.id,
              a.booking_code AS bookingCode,
              a.service_name AS serviceName,
              COALESCE(svc.service_name, a.service_name) AS service,
              COALESCE(svc.category, 'Salon Service') AS serviceCategory,
              svc.price AS servicePrice,
              svc.duration_minutes AS durationMinutes,
              DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS date,
              a.appointment_date AS appointmentDate,
              a.time_slot AS timeSlot,
              a.status,
              a.visit_status AS visitStatus,
              st.name AS stylistName,
              st.id AS stylistId,
              a.customer_notes AS customerNotes,
              a.admin_note AS adminNote,
              a.created_at AS createdAt
       FROM appointments a
       LEFT JOIN stylists st ON st.id = a.stylist_id
       LEFT JOIN services svc ON LOWER(svc.service_name) = LOWER(a.service_name)
       WHERE (a.client_id IS NOT NULL AND a.client_id = ?)
          OR (a.client_phone IS NOT NULL AND a.client_phone != '' AND a.client_phone = ?)
          OR (a.client_email IS NOT NULL AND a.client_email != '' AND LOWER(a.client_email) = LOWER(?))
       ORDER BY a.appointment_date DESC, a.id DESC`,
      [client.id, client.phone || '', client.email || '']
    );

    // Photos if any
    const [photos] = await pool.query(
      `SELECT p.id, p.photo_type AS photoType, p.photo_url AS photoUrl, p.caption,
              p.appointment_id AS appointmentId, p.uploaded_at AS uploadedAt
       FROM client_photos p WHERE p.client_id = ? ORDER BY p.uploaded_at DESC`,
      [client.id]
    );

    res.json({
      success: true,
      client,
      history: historyRows,
      visits: historyRows,
      photos,
      totalVisits: historyRows.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load client profile.', error: err.message });
  }
});

// Update client notes / allergies
app.patch('/api/clients/:id/notes', optionalToken, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { allergies, generalNotes, colorFormulaNotes } = req.body || {};
    await pool.query(
      `UPDATE clients SET
         allergies = COALESCE(?, allergies),
         general_notes = COALESCE(?, general_notes),
         color_formula_notes = COALESCE(?, color_formula_notes),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [allergies !== undefined ? allergies : null,
       generalNotes !== undefined ? generalNotes : null,
       colorFormulaNotes !== undefined ? colorFormulaNotes : null,
       req.params.id]
    );
    res.json({ success: true, message: 'Client notes updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update notes.', error: err.message });
  }
});

app.post('/api/clients', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { name, phone, email } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Client name is required.' });
    const [result] = await pool.query(
      'INSERT INTO clients (name, phone, email) VALUES (?, ?, ?)',
      [name.trim(), (phone || '').trim() || null, (email || '').toLowerCase().trim() || null]
    );
    res.status(201).json({ success: true, message: 'Client profile created.', clientId: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'A client with this phone or email already exists.' });
    }
    res.status(500).json({ success: false, message: 'Failed to create client.', error: err.message });
  }
});

app.patch('/api/clients/:id', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { name, phone, email, allergies, colorFormulaNotes, generalNotes } = req.body;
    await pool.query(
      `UPDATE clients SET
         name = COALESCE(?, name),
         phone = COALESCE(?, phone),
         email = COALESCE(?, email),
         allergies = COALESCE(?, allergies),
         color_formula_notes = COALESCE(?, color_formula_notes),
         general_notes = COALESCE(?, general_notes)
       WHERE id = ?`,
      [
        name ? String(name).trim() : null,
        phone !== undefined ? String(phone).trim() : null,
        email !== undefined ? String(email).toLowerCase().trim() : null,
        allergies !== undefined ? String(allergies) : null,
        colorFormulaNotes !== undefined ? String(colorFormulaNotes) : null,
        generalNotes !== undefined ? String(generalNotes) : null,
        req.params.id
      ]
    );
    res.json({ success: true, message: 'Client profile updated.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Phone or email already used by another client.' });
    }
    res.status(500).json({ success: false, message: 'Failed to update client.', error: err.message });
  }
});

app.post('/api/clients/:id/photos', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { photoUrl, photoType, appointmentId, caption } = req.body;
    if (!photoUrl || typeof photoUrl !== 'string' || photoUrl.length > 500) {
      return res.status(400).json({ success: false, message: 'photoUrl (max 500 chars) is required.' });
    }
    if (photoType && !['before', 'after'].includes(photoType)) {
      return res.status(400).json({ success: false, message: 'photoType must be before or after.' });
    }
    const [clientRows] = await pool.query('SELECT id FROM clients WHERE id = ?', [req.params.id]);
    if (clientRows.length === 0) return res.status(404).json({ success: false, message: 'Client not found.' });

    const [result] = await pool.query(
      'INSERT INTO client_photos (client_id, appointment_id, photo_type, photo_url, caption) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, appointmentId ? Number(appointmentId) : null, photoType || 'before', photoUrl, (caption || '').trim() || null]
    );
    res.status(201).json({ success: true, message: 'Photo reference added.', photoId: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add photo.', error: err.message });
  }
});

app.delete('/api/clients/:id/photos/:photoId', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [result] = await pool.query('DELETE FROM client_photos WHERE id = ? AND client_id = ?', [req.params.photoId, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Photo not found.' });
    res.json({ success: true, message: 'Photo reference removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove photo.', error: err.message });
  }
});

// Notification audit log (ADMIN ONLY)
app.get('/api/notifications/log', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const bookingCode = (req.query.bookingCode || '').trim();
    let query = `SELECT id, appointment_id AS appointmentId, booking_code AS bookingCode, type, channel,
                        recipient, status, detail, sent_at AS sentAt
                 FROM notification_log`;
    const params = [];
    if (bookingCode) { query += ' WHERE booking_code = ?'; params.push(bookingCode); }
    query += ' ORDER BY sent_at DESC LIMIT 200';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, log: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load notification log.', error: err.message });
  }
});

// =========================================================================
// 11. NOTIFICATION HELPERS — Email (Gmail SMTP) + WhatsApp (UltraMsg)
//         + typed Notification Matrix templates, audit log & dispatcher
// =========================================================================

/**
 * Normalize any appointment-shaped record (MySQL row, API object, alias mix)
 * into the context the notification templates read from.
 */
function buildNotificationContext(apt) {
  return {
    clientName : apt.clientName || apt.client_name || apt.name || 'Valued Client',
    bookingCode: apt.bookingCode || apt.booking_code || apt.id || 'N/A',
    serviceName: apt.serviceName || apt.service_name || apt.service || 'Salon Service',
    aptDate    : apt.appointmentDate || apt.appointment_date || apt.date || 'N/A',
    aptTime    : apt.timeSlot || apt.time_slot || apt.appointmentTime || apt.appointment_time || apt.time || 'N/A',
    stylistName: apt.stylistName || apt.stylist_name || 'Our Salon Team',
    adminNote  : apt.adminNote || apt.admin_note || ''
  };
}

/**
 * Resolve the assigned stylist's name for an appointment row (if any) and
 * attach it as `stylist_name` so reminder/confirmation payloads can include
 * the "Stylist" detail. Never throws — degrades to the generic salon team label.
 */
async function attachStylistName(apt) {
  try {
    if (!pool || !apt) return apt;
    const stylistId = apt.stylist_id || apt.stylistId;
    if (!stylistId) return apt;
    const [rows] = await pool.query('SELECT name FROM stylists WHERE id = ? LIMIT 1', [stylistId]);
    if (rows.length > 0) apt.stylist_name = rows[0].name;
  } catch (err) {
    console.error('[Notify ⚠] Could not resolve stylist name:', err.message);
  }
  return apt;
}

/**
 * NOTIFICATION MATRIX — one template per lifecycle event. Each template renders
 * both the email (subject/banner/intro) and WhatsApp (header) variants.
 */
const NOTIFICATION_TEMPLATES = {
  booking_received: {
    banner      : 'Your Booking Has Been Received!',
    emailSubject: c => `📋 Booking Received — ${SALON.name} (${c.bookingCode})`,
    waHeader    : () => `Your booking request has been *📋 Received*!`,
    statusLabel : 'Received — Awaiting Review',
    statusColor : '#8B6F47',
    intro       : c => `Thank you, <strong>${c.clientName}</strong>! Your appointment request at <strong>${SALON.name}</strong> has been received and is now <span style="color:#8B6F47;font-weight:bold;">awaiting salon review</span>. Here are your booking details:`,
    note        : c => c.adminNote || 'Our team will review your request and send a confirmation message shortly.'
  },
  confirmed: {
    banner      : 'Your Appointment is Confirmed!',
    emailSubject: c => `✅ Appointment Confirmed — ${SALON.name} (${c.bookingCode})`,
    waHeader    : () => `Your appointment has been *✅ Confirmed*!`,
    statusLabel : 'Confirmed',
    statusColor : '#27ae60',
    intro       : c => `Great news, <strong>${c.clientName}</strong>! Your appointment at <strong>${SALON.name}</strong> has been <span style="color:#27ae60;font-weight:bold;">✅ Confirmed</span>. Here are your booking details:`,
    note        : c => c.adminNote || 'We look forward to seeing you!'
  },
  reminder_24h: {
    banner      : 'Your Appointment is Tomorrow!',
    emailSubject: c => `⏰ Appointment Reminder — Tomorrow at ${SALON.name} (${c.bookingCode})`,
    waHeader    : () => `*⏰ Friendly Reminder* — your appointment is *tomorrow*!`,
    statusLabel : 'Reminder — Coming Up',
    statusColor : '#e67e22',
    intro       : c => `Hello <strong>${c.clientName}</strong>, this is a friendly reminder from <strong>${SALON.name}</strong> — your appointment is coming up in about 24 hours.`,
    note        : () => 'Please arrive 5–10 minutes early. If you need to reschedule or cancel, contact us as soon as possible.'
  },
  rescheduled: {
    banner      : 'Your Appointment Time Has Changed',
    emailSubject: c => `📅 Appointment Rescheduled — ${SALON.name} (${c.bookingCode})`,
    waHeader    : () => `Your appointment has been *📅 Rescheduled* to a new time.`,
    statusLabel : 'Rescheduled',
    statusColor : '#e67e22',
    intro       : c => `Hello <strong>${c.clientName}</strong>, your appointment at <strong>${SALON.name}</strong> has been moved. Here are your <span style="color:#e67e22;font-weight:bold;">updated</span> booking details:`,
    note        : c => c.adminNote || 'Sorry for any inconvenience — we look forward to seeing you at the new time!'
  },
  cancelled: {
    banner      : 'Your Appointment Has Been Cancelled',
    emailSubject: c => `❌ Appointment Cancelled — ${SALON.name} (${c.bookingCode})`,
    waHeader    : () => `Your appointment has been *❌ Cancelled*.`,
    statusLabel : 'Cancelled',
    statusColor : '#c0392b',
    intro       : c => `Hello <strong>${c.clientName}</strong>, your appointment at <strong>${SALON.name}</strong> has been <span style="color:#c0392b;font-weight:bold;">❌ Cancelled</span>.`,
    note        : c => c.adminNote || 'If this was unexpected, please contact us and we will be happy to help you rebook.'
  },
  no_show_followup: {
    banner      : 'We Missed You Today',
    emailSubject: c => `🕐 We Missed You — ${SALON.name} (${c.bookingCode})`,
    waHeader    : () => `*🕐 We missed you today!*`,
    statusLabel : 'No-Show Follow-up',
    statusColor : '#c0392b',
    intro       : c => `Hello <strong>${c.clientName}</strong>, we noticed you were unable to make your scheduled appointment today at <strong>${SALON.name}</strong>.`,
    note        : () => 'We would love to welcome you another time — simply reply to this message or contact us to rebook a new slot.'
  },
  review_request: {
    banner      : 'Thank You For Visiting Us!',
    emailSubject: c => `💬 How Was Your Visit? — ${SALON.name}`,
    waHeader    : () => `*💬 How was your visit today?*`,
    statusLabel : 'Thank You 💚',
    statusColor : '#27ae60',
    intro       : c => `Hello <strong>${c.clientName}</strong>, thank you for visiting <strong>${SALON.name}</strong> today! We hope you loved your <strong>${c.serviceName}</strong>.`,
    note        : () => 'We would be truly grateful for your feedback — it helps us serve you better. Open the <strong>"Rate Your Visit"</strong> form on our website (footer link) with your booking code, or simply reply to this message with your thoughts!'
  },
  slot_available: {
    banner      : 'A Slot Just Opened Up For You!',
    emailSubject: c => `⏳ Good News — Your Waiting Slot is Now Available at ${SALON.name} (${c.bookingCode})`,
    waHeader    : () => `*⏳ Good news!* A slot you were waiting for just became *available*.`,
    statusLabel : 'Slot Released — Action Needed',
    statusColor : '#2563EB',
    intro       : c => `Hello <strong>${c.clientName}</strong>, great news! A spot matching your waiting-list request at <strong>${SALON.name}</strong> has just opened up for <span style="color:#2563EB;font-weight:bold;">${c.aptDate}</span> at <strong>${c.aptTime}</strong>${c.serviceName && c.serviceName !== 'Salon Service' ? ` (<strong>${c.serviceName}</strong>)` : ''}.`,
    note        : () => 'This slot is being held for you for a limited time. Please contact us or complete your booking as soon as possible to secure it — once taken, it will be offered to the next guest on the list.'
  },
  waiting_list_joined: {
    banner      : 'Placed on Priority Waiting List',
    emailSubject: c => `⏳ Priority Waiting List Update — ${SALON.name} (${c.bookingCode})`,
    waHeader    : () => `*⏳ Priority Waiting List Confirmation*`,
    statusLabel : 'Priority Waiting List',
    statusColor : '#D97706',
    intro       : c => `Dear <strong>${c.clientName}</strong>, your requested appointment for <strong>${c.serviceName}</strong> on <strong>${c.aptDate}</strong> (${c.aptTime}) is currently placed on our Priority Waiting List as the slot is fully booked. We will notify you immediately as soon as a slot opens up!`,
    note        : c => c.adminNote || 'You are placed on our Priority Waiting List. We will notify you immediately as soon as a slot opens up!'
  }
};

/**
 * Write one row to the notification_log audit table. Never throws.
 */
async function logNotification(apt, type, channel, recipient, status, detail) {
  try {
    if (!pool) return;
    await pool.query(
      'INSERT INTO notification_log (appointment_id, booking_code, type, channel, recipient, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        apt.id || null,
        apt.booking_code || apt.bookingCode || null,
        type,
        channel,
        (recipient || '').substring(0, 180),
        status,
        (detail || '').substring(0, 500)
      ]
    );
  } catch (err) {
    console.error('[NotifyLog ✗] Failed to write notification_log:', err.message);
  }
}

/**
 * Dispatch a typed notification (email + WhatsApp) and audit both channels.
 * Never throws — per-channel failures are logged and swallowed.
 */
async function dispatchNotification(apt, type) {
  const template = NOTIFICATION_TEMPLATES[type];
  if (!template) {
    console.warn(`[Notify ⚠] Unknown notification type: ${type}`);
    return;
  }
  const label = `[Notify:${type} ${apt.booking_code || apt.id || 'N/A'}]`;
  console.log(`${label} ▶ Dispatching ${type} notification…`);

  // Ensure the appointment summary includes the assigned stylist's name
  await attachStylistName(apt);

  try {
    const r = await sendEmailNotification(apt, type);
    await logNotification(apt, type, 'email', apt.client_email || apt.clientEmail || apt.email, r.success ? 'sent' : 'failed', r.success ? (r.info || '') : (r.error || ''));
    if (r.success) console.log(`${label} ✓ Email sent | MsgID: ${r.info}`);
    else console.warn(`${label} ⚠ Email failed: ${r.error}`);
  } catch (e) {
    console.error(`${label} ✗ Email threw an error: ${e.message}`);
  }

  try {
    const r = await sendWhatsAppNotification(apt, type);
    await logNotification(apt, type, 'whatsapp', r.phone || '', r.success ? 'sent' : 'failed', r.success ? String(r.info || '') : (r.error || ''));
    if (r.success) console.log(`${label} ✓ WhatsApp sent to ${r.phone} | ID: ${r.info || 'N/A'}`);
    else console.warn(`${label} ⚠ WhatsApp failed: ${r.error}`);
  } catch (e) {
    console.error(`${label} ✗ WhatsApp threw an error: ${e.message}`);
  }
}

/**
 * Send an HTML email confirmation to the client using Gmail SMTP + Nodemailer.
 * @param {Object} apt - Appointment record from MySQL
 * @returns {Promise<{success: boolean, info?: string, error?: string}>}
 */
async function sendEmailNotification(apt, type = 'confirmed') {
  const template = NOTIFICATION_TEMPLATES[type] || NOTIFICATION_TEMPLATES.confirmed;
  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!appPassword || appPassword === 'your_16_char_app_password' || appPassword.trim() === '') {
    console.warn('[Email ⚠] Gmail App Password is not set in .env — skipping email notification.');
    console.warn('[Email ⚠] To enable: open .env and set GMAIL_APP_PASSWORD=<your 16-char Google App Password>');
    return { success: false, error: 'Email app password not configured' };
  }

  const recipientEmail = apt.clientEmail || apt.client_email || apt.email;
  if (!recipientEmail) {
    console.warn('[Email] No recipient email address on appointment — skipping email.');
    return { success: false, error: 'No recipient email' };
  }

  const c = buildNotificationContext(apt);
  const { clientName, bookingCode, serviceName, aptDate, aptTime } = c;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Appointment Confirmed — ${SALON.name}</title>
</head>
<body style="margin:0;padding:0;background:#f8f4f0;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#8B6F47 0%,#C9A96E 100%);padding:40px 30px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:26px;letter-spacing:1px;">✨ ${SALON.name}</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">${template.banner}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 30px;">
              <p style="margin:0 0 28px;color:#555;font-size:14px;line-height:1.6;">
                ${template.intro(c)}
              </p>

              <!-- Details Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf8f3;border:1px solid #e8ddd0;border-radius:8px;margin-bottom:28px;">
                <tr><td style="padding:20px 24px;">
                  <table width="100%" cellpadding="6" cellspacing="0">
                    <tr>
                      <td style="color:#888;font-size:13px;width:40%;">📋 Booking Code</td>
                      <td style="color:#333;font-weight:bold;font-size:13px;">${bookingCode}</td>
                    </tr>
                    <tr>
                      <td style="color:#888;font-size:13px;">💇 Service</td>
                      <td style="color:#333;font-size:13px;">${serviceName}</td>
                    </tr>
                    <tr>
                      <td style="color:#888;font-size:13px;">📅 Date</td>
                      <td style="color:#333;font-size:13px;">${aptDate}</td>
                    </tr>
                    <tr>
                      <td style="color:#888;font-size:13px;">⏰ Time</td>
                      <td style="color:#333;font-size:13px;">${aptTime}</td>
                    </tr>
                    <tr>
                      <td style="color:#888;font-size:13px;">💇‍♀️ Your Stylist</td>
                      <td style="color:#333;font-size:13px;">${c.stylistName}</td>
                    </tr>
                    <tr>
                      <td style="color:#888;font-size:13px;">✅ Status</td>
                      <td style="color:${template.statusColor};font-weight:bold;font-size:13px;">${template.statusLabel}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>

              <!-- Salon Note -->
              <div style="background:#f8f4f0;border-left:4px solid ${template.statusColor};border-radius:4px;padding:14px 18px;margin-bottom:28px;">
                <p style="margin:0;font-size:13px;color:#555;"><strong>📝 Message:</strong> ${template.note(c)}</p>
              </div>

              ${type === 'review_request' ? `
              <!-- Review Request Call to Action -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf8f3;border:1px dashed #d4af37;border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td align="center" style="padding:26px 20px;">
                    <p style="margin:0 0 14px;color:#8B6F47;font-size:16px;font-weight:600;letter-spacing:0.3px;">✨ How would you rate your experience with us? ✨</p>
                    <a href="${SALON.website}/index.html#review-section?code=${encodeURIComponent(bookingCode)}"
                       style="display:inline-block;background:linear-gradient(135deg,#8B6F47 0%,#C9A96E 100%);color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 34px;border-radius:30px;box-shadow:0 4px 14px rgba(139,111,71,0.25);letter-spacing:0.5px;">
                      Rate Your Experience
                    </a>
                    <p style="margin:16px 0 0;font-size:13px;color:#777;line-height:1.5;">
                      Or open directly: <a href="${SALON.website}/index.html#review-section?code=${encodeURIComponent(bookingCode)}" style="color:#8B6F47;font-weight:bold;word-break:break-all;">${SALON.website}/index.html#review-section?code=${bookingCode}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Post-visit message -->
              <p style="color:#555;font-size:13px;line-height:1.7;">
                💖 <strong>Thank You:</strong> We truly appreciate you choosing ${SALON.name} and look forward to pampering you again soon!<br/>
                📞 Questions or follow-up? Contact us at <a href="tel:${SALON.phone}" style="color:#8B6F47;">${SALON.phone || SALON.email}</a>
              </p>
              ` : `
              <!-- Reminder -->
              <p style="color:#555;font-size:13px;line-height:1.7;">
                🕐 <strong>Reminder:</strong> Please arrive 5–10 minutes before your scheduled time.<br/>
                📞 Questions? Contact us at <a href="tel:${SALON.phone}" style="color:#8B6F47;">${SALON.phone || SALON.email}</a>
              </p>
              `}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f4f0;padding:20px 30px;text-align:center;border-top:1px solid #e8ddd0;">
              <p style="margin:0;font-size:12px;color:#aaa;">
                ${SALON.name}${SALON.address ? ' • ' + SALON.address : ''}<br/>
                <a href="mailto:${SALON.email}" style="color:#8B6F47;text-decoration:none;">${SALON.email}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'salonhairbride@gmail.com',
        pass: appPassword
      }
    });

    const info = await transporter.sendMail({
      from    : '"Salon Hair Bride" <salonhairbride@gmail.com>',
      to      : recipientEmail,
      subject : template.emailSubject(c),
      html    : htmlBody
    });
    console.log(`[Email ✓] Confirmation sent to ${recipientEmail} | MsgID: ${info.messageId}`);
    return { success: true, info: info.messageId };
  } catch (err) {
    console.error('[Email ✗] Failed to send confirmation email:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a WhatsApp confirmation message using UltraMsg HTTP API.
 * @param {Object} apt - Appointment record from MySQL
 * @returns {Promise<{success: boolean, info?: string, error?: string}>}
 */
async function sendWhatsAppNotification(apt, type = 'confirmed') {
  const template = NOTIFICATION_TEMPLATES[type] || NOTIFICATION_TEMPLATES.confirmed;
  if (!ULTRAMSG_CONFIG.instanceId || !ULTRAMSG_CONFIG.token) {
    console.warn('[WhatsApp ⚠] UltraMsg credentials missing — skipping WhatsApp notification.');
    return { success: false, error: 'WhatsApp credentials not configured', phone: null };
  }

  const phone = apt.clientPhone || apt.client_phone || apt.phone;
  if (!phone) {
    console.warn('[WhatsApp] No phone number on appointment — skipping WhatsApp.');
    return { success: false, error: 'No phone number' };
  }

  // Automate Sri Lanka Country Code (94)
  let normalizedPhone = phone.replace(/[^\d+]/g, '');
  if (normalizedPhone.startsWith('+')) {
    normalizedPhone = normalizedPhone.substring(1);
  }
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '94' + normalizedPhone.substring(1);
  } else if (!normalizedPhone.startsWith('94')) {
    normalizedPhone = '94' + normalizedPhone;
  }
  console.log(`[WhatsApp ▶] Phone formatting: "${phone}" → "${normalizedPhone}" (SL country code applied)`);

  const c = buildNotificationContext(apt);
  const { clientName, bookingCode, serviceName, aptDate, aptTime } = c;

  const message = (type === 'waiting_list_joined') ? [
    `✨ *${SALON.name}*`,
    ``,
    `Dear *${c.clientName}*, your requested appointment for *${c.serviceName}* on *${c.aptDate}* (${c.aptTime}) is currently placed on our Priority Waiting List as the slot is fully booked. We will notify you immediately as soon as a slot opens up!`,
    ``,
    `📋 *Waiting List Request*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📌 Request Code : *${c.bookingCode}*`,
    `💇 Service      : ${c.serviceName}`,
    `📅 Date         : ${c.aptDate}`,
    `⏰ Slot         : ${c.aptTime}`,
    `📊 Status       : *Priority Waiting List (Pending)*`,
    ``,
    SALON.phone ? `📞 Contact us: ${SALON.phone}` : '',
    `Thank you for choosing ${SALON.name}! 💄`
  ].filter(line => line !== null).join('\n') : (type === 'review_request') ? [
    `✨ *${SALON.name}*`,
    ``,
    `Hello *${c.clientName}*! 💚`,
    `Thank you for visiting *${SALON.name}* today!`,
    `We hope you loved your *${c.serviceName}*.`,
    ``,
    `⭐ *How Was Your Visit?*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `We would love your quick feedback. Rate your experience here:`,
    `👉 ${SALON.website}/index.html#review-section?code=${encodeURIComponent(c.bookingCode)}`,
    ``,
    `📌 Booking Code : *${c.bookingCode}*`,
    SALON.phone ? `📞 Questions / Contact: ${SALON.phone}` : '',
    ``,
    `Thank you for choosing ${SALON.name}! See you soon! 💄✨`
  ].filter(line => line !== null).join('\n') : [
    `✨ *${SALON.name}*`,
    ``,
    `Hello *${c.clientName}*! 👋`,
    template.waHeader(c),
    ``,
    `📋 *Booking Details*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📌 Booking Code : *${c.bookingCode}*`,
    `💇 Service       : ${c.serviceName}`,
    `📅 Date          : ${c.aptDate}`,
    `⏰ Time          : ${c.aptTime}`,
    `💇‍♀️ Stylist       : ${c.stylistName}`,
    `📊 Status        : *${template.statusLabel}*`,
    ``,
    `📝 *Message*:`,
    `${template.note(c)}`,
    ``,
    `🕐 Please arrive 5–10 minutes early.`,
    SALON.phone ? `📞 Contact us: ${SALON.phone}` : '',
    ``,
    `Thank you for choosing ${SALON.name}! 💄`
  ].filter(line => line !== null).join('\n');

  try {
    const response = await fetch(ULTRAMSG_CONFIG.apiBase, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({
        token  : ULTRAMSG_CONFIG.token,
        to     : normalizedPhone,
        body   : message
      })
    });

    const data = await response.json();

    if (data.sent === 'true' || data.sent === true || data.status === 'queued') {
      console.log(`[WhatsApp ✓] Message sent to ${normalizedPhone} | ID: ${data.id || 'N/A'}`);
      return { success: true, info: data.id, phone: normalizedPhone };
    } else {
      console.error('[WhatsApp ✗] UltraMsg API returned error:', data);
      return { success: false, error: JSON.stringify(data), phone: normalizedPhone };
    }
  } catch (err) {
    console.error('[WhatsApp ✗] Failed to send WhatsApp message:', err.message);
    return { success: false, error: err.message, phone: normalizedPhone };
  }
}

// =========================================================================
// 12. REVENUE & BUSINESS ANALYTICS (ADMIN ONLY)
// =========================================================================
app.get('/api/analytics/summary', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    // Revenue basis: completed visits valued at the current service-menu price.
    const REVENUE_JOIN = `
      FROM appointments a
      LEFT JOIN services svc ON svc.service_name = a.service_name
      WHERE a.visit_status = 'completed'`;

    const [[revToday]] = await pool.query(
      `SELECT IFNULL(SUM(svc.price), 0) AS total, COUNT(*) AS visits
       ${REVENUE_JOIN} AND a.appointment_date = DATE_FORMAT(CURDATE(), '%Y-%m-%d')`
    );
    const [[revWeek]] = await pool.query(
      `SELECT IFNULL(SUM(svc.price), 0) AS total, COUNT(*) AS visits
       ${REVENUE_JOIN} AND a.appointment_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), '%Y-%m-%d')`
    );
    const [[revMonth]] = await pool.query(
      `SELECT IFNULL(SUM(svc.price), 0) AS total, COUNT(*) AS visits
       ${REVENUE_JOIN} AND a.appointment_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`
    );

    // Daily revenue trend — last 14 days (for the bar chart)
    const [trend] = await pool.query(
      `SELECT a.appointment_date AS day, IFNULL(SUM(svc.price), 0) AS revenue, COUNT(*) AS visits
       ${REVENUE_JOIN} AND a.appointment_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 13 DAY), '%Y-%m-%d')
       GROUP BY a.appointment_date ORDER BY a.appointment_date ASC`
    );

    // Top-performing services (all completed history)
    const [topServices] = await pool.query(
      `SELECT a.service_name AS service, COUNT(*) AS completedCount, IFNULL(SUM(svc.price), 0) AS revenue
       ${REVENUE_JOIN}
       GROUP BY a.service_name ORDER BY revenue DESC, completedCount DESC LIMIT 5`
    );

    // Total appointment counters
    const [[counts]] = await pool.query(
      `SELECT
         SUM(CASE WHEN visit_status = 'completed' THEN 1 ELSE 0 END) AS completedTotal,
         SUM(CASE WHEN status != 'cancelled' AND appointment_date >= DATE_FORMAT(CURDATE(), '%Y-%m-%d') THEN 1 ELSE 0 END) AS upcomingTotal,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledTotal,
         COUNT(*) AS allTotal
       FROM appointments`
    );

    // Stylist workload metrics: upcoming load, completed visits, revenue
    // generated and average client rating.
    const [stylistWorkload] = await pool.query(
      `SELECT s.id, s.name, s.is_active AS isActive,
         (SELECT COUNT(*) FROM appointments a
           WHERE a.stylist_id = s.id AND a.status != 'cancelled'
             AND a.appointment_date >= DATE_FORMAT(CURDATE(), '%Y-%m-%d')) AS upcoming,
         (SELECT COUNT(*) FROM appointments a
           WHERE a.stylist_id = s.id AND a.visit_status = 'completed') AS completed,
         (SELECT IFNULL(SUM(svc.price), 0) FROM appointments a
           LEFT JOIN services svc ON svc.service_name = a.service_name
           WHERE a.stylist_id = s.id AND a.visit_status = 'completed') AS revenue,
         (SELECT ROUND(IFNULL(AVG(f.rating), 0), 2) FROM appointment_feedback f
           WHERE f.stylist_id = s.id) AS avgRating
       FROM stylists s ORDER BY completed DESC, upcoming DESC, s.id ASC`
    );

    // Overall rating snapshot
    const [[rating]] = await pool.query(
      'SELECT COUNT(*) AS totalReviews, ROUND(IFNULL(AVG(rating), 0), 2) AS avgRating FROM appointment_feedback'
    );

    res.json({
      success: true,
      analytics: {
        revenue: {
          today: Number(revToday.total), todayVisits: Number(revToday.visits),
          week: Number(revWeek.total), weekVisits: Number(revWeek.visits),
          month: Number(revMonth.total), monthVisits: Number(revMonth.visits)
        },
        trend: trend.map(t => ({ day: t.day, revenue: Number(t.revenue), visits: Number(t.visits) })),
        topServices: topServices.map(t => ({ service: t.service, completedCount: Number(t.completedCount), revenue: Number(t.revenue) })),
        appointments: {
          completedTotal: Number(counts.completedTotal || 0),
          upcomingTotal: Number(counts.upcomingTotal || 0),
          cancelledTotal: Number(counts.cancelledTotal || 0),
          allTotal: Number(counts.allTotal || 0)
        },
        stylistWorkload: stylistWorkload.map(s => ({
          id: s.id, name: s.name, isActive: Number(s.isActive) === 1,
          upcoming: Number(s.upcoming), completed: Number(s.completed),
          revenue: Number(s.revenue), avgRating: Number(s.avgRating)
        })),
        rating: { totalReviews: Number(rating.totalReviews), avgRating: Number(rating.avgRating) }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to build analytics summary.', error: err.message });
  }
});

// =========================================================================
// 13. CLIENT FEEDBACK & RATINGS (PUBLIC SUBMIT + ADMIN DIRECTORY)
// =========================================================================

// Public: submit a star rating + notes for a completed visit (booking code required)
app.post('/api/feedback', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { bookingCode, rating, notes } = req.body;
    const ratingNum = parseInt(rating, 10);
    if (!bookingCode || !String(bookingCode).trim()) {
      return res.status(400).json({ success: false, message: 'Booking code is required (e.g. APT-98241).' });
    }
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be a whole number of stars between 1 and 5.' });
    }

    const [aptRows] = await pool.query(
      'SELECT * FROM appointments WHERE booking_code = ? LIMIT 1', [String(bookingCode).trim()]
    );
    if (aptRows.length === 0) {
      return res.status(404).json({ success: false, message: `No appointment found for booking code "${bookingCode}".` });
    }
    const apt = aptRows[0];

    // Link to the CRM client profile when one matches (phone or email)
    let clientId = null;
    const [crm] = await pool.query(
      'SELECT id FROM clients WHERE phone = ? OR (email IS NOT NULL AND email != "" AND LOWER(email) = LOWER(?)) LIMIT 1',
      [apt.client_phone, apt.client_email]
    );
    if (crm.length > 0) clientId = crm[0].id;

    await pool.query(
      `INSERT INTO appointment_feedback
         (appointment_id, booking_code, client_id, stylist_id, client_name, client_phone, client_email, service_name, rating, notes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'client')
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), notes = VALUES(notes), source = 'client', created_at = CURRENT_TIMESTAMP`,
      [apt.id, apt.booking_code, clientId, apt.stylist_id, apt.client_name, apt.client_phone, apt.client_email, apt.service_name, ratingNum, (notes || '').trim() || null]
    );

    res.status(201).json({ success: true, message: `Thank you! Your ${ratingNum}-star review for booking ${apt.booking_code} has been recorded.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to record feedback.', error: err.message });
  }
});

// Admin: feedback directory (CRM-linked) with filters
app.get('/api/feedback', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { clientId, stylistId, rating } = req.query;
    const conds = [];
    const params = [];
    if (clientId) { conds.push('f.client_id = ?'); params.push(Number(clientId)); }
    if (stylistId) { conds.push('f.stylist_id = ?'); params.push(Number(stylistId)); }
    if (rating) { conds.push('f.rating = ?'); params.push(Number(rating)); }

    const [rows] = await pool.query(
      `SELECT f.id, f.appointment_id AS appointmentId, f.booking_code AS bookingCode,
              f.client_id AS clientId, f.client_name AS clientName, f.client_phone AS clientPhone,
              f.client_email AS clientEmail, f.service_name AS serviceName,
              f.stylist_id AS stylistId, s.name AS stylistName,
              f.rating, f.notes, f.source, f.created_at AS createdAt
       FROM appointment_feedback f
       LEFT JOIN stylists s ON s.id = f.stylist_id
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
       ORDER BY f.created_at DESC, f.id DESC LIMIT 500`,
      params
    );

    const [[summary]] = await pool.query(
      `SELECT COUNT(*) AS totalReviews, ROUND(IFNULL(AVG(rating), 0), 2) AS avgRating,
              SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS fiveStar,
              SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS fourStar,
              SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS threeStar,
              SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS twoStar,
              SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS oneStar
       FROM appointment_feedback`
    );

    res.json({ success: true, feedback: rows, summary: {
      totalReviews: Number(summary.totalReviews), avgRating: Number(summary.avgRating),
      distribution: [5, 4, 3, 2, 1].map(star => ({
        star, count: Number(summary[`${['one', 'two', 'three', 'four', 'five'][star - 1]}Star`] || 0)
      }))
    } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load feedback.', error: err.message });
  }
});

// Admin: record feedback on behalf of a client (phone call / in-person review)
app.post('/api/feedback/admin', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { bookingCode, rating, notes } = req.body;
    const ratingNum = parseInt(rating, 10);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5 stars.' });
    }
    const [aptRows] = await pool.query(
      'SELECT * FROM appointments WHERE booking_code = ? OR id = ? LIMIT 1', [bookingCode, bookingCode]
    );
    if (aptRows.length === 0) {
      return res.status(404).json({ success: false, message: `No appointment found for "${bookingCode}".` });
    }
    const apt = aptRows[0];

    let clientId = null;
    const [crm] = await pool.query(
      'SELECT id FROM clients WHERE phone = ? OR (email IS NOT NULL AND email != "" AND LOWER(email) = LOWER(?)) LIMIT 1',
      [apt.client_phone, apt.client_email]
    );
    if (crm.length > 0) clientId = crm[0].id;

    await pool.query(
      `INSERT INTO appointment_feedback
         (appointment_id, booking_code, client_id, stylist_id, client_name, client_phone, client_email, service_name, rating, notes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), notes = VALUES(notes), source = 'admin', created_at = CURRENT_TIMESTAMP`,
      [apt.id, apt.booking_code, clientId, apt.stylist_id, apt.client_name, apt.client_phone, apt.client_email, apt.service_name, ratingNum, (notes || '').trim() || null]
    );

    res.status(201).json({ success: true, message: `Feedback recorded for ${apt.booking_code} (${ratingNum}★).` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to record feedback.', error: err.message });
  }
});

// Admin: delete a feedback entry
app.delete('/api/feedback/:id', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [result] = await pool.query('DELETE FROM appointment_feedback WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Feedback entry not found.' });
    res.json({ success: true, message: 'Feedback entry removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove feedback.', error: err.message });
  }
});

// =========================================================================
// 5. START SERVER & INITIALIZE DATABASE
// =========================================================================

// 24-HOUR REMINDER SCHEDULER — every 15 minutes, find confirmed appointments
// ~24h ahead that have NOT yet received a reminder_24h notification, and send one.
// Idempotent via the notification_log unique-per-appointment check below.
const REMINDER_CHECK_INTERVAL_MS = 15 * 60 * 1000;
async function sendDueReminders() {
  try {
    if (!pool) return;
    const [apts] = await pool.query(
      `SELECT a.* FROM appointments a
       WHERE a.status = 'confirmed'
         AND a.visit_status = 'scheduled'
         AND TIMESTAMPDIFF(HOUR, NOW(),
               STR_TO_DATE(CONCAT(a.appointment_date, ' ', SUBSTRING_INDEX(a.time_slot, ' - ', 1)),
                           '%Y-%m-%d %h:%i %p')) BETWEEN 23 AND 25
         AND NOT EXISTS (
           SELECT 1 FROM notification_log n
           WHERE n.appointment_id = a.id AND n.type = 'reminder_24h'
         )`
    );
    for (const apt of apts) {
      console.log(`[Reminder ⏰] 24h reminder due for ${apt.booking_code} (${apt.appointment_date} ${apt.time_slot})`);
      await dispatchNotification(apt, 'reminder_24h');
    }
  } catch (err) {
    console.error('[Reminder ✗] Scheduler tick failed:', err.message);
  }
}

// AUTOMATED REVIEW & RATING REQUEST SCHEDULER — every 15 minutes, find appointments
// marked completed that have NOT yet received a review_request notification, and dispatch.
// Idempotent via the notification_log check.
const REVIEW_CHECK_INTERVAL_MS = 15 * 60 * 1000;
async function sendDueReviewRequests() {
  try {
    if (!pool) return;
    const [apts] = await pool.query(
      `SELECT a.* FROM appointments a
       WHERE (a.status = 'completed' OR a.visit_status = 'completed')
         AND (a.completed_time IS NOT NULL OR a.updated_at IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1 FROM notification_log n
           WHERE n.appointment_id = a.id AND n.type = 'review_request'
         )
       LIMIT 20`
    );
    for (const apt of apts) {
      console.log(`[ReviewRequest ⏰] Background job: sending review request for ${apt.booking_code}`);
      await dispatchNotification(apt, 'review_request');
    }
  } catch (err) {
    console.error('[ReviewRequest ✗] Scheduler tick failed:', err.message);
  }
}

// Initialize schema/migrations BEFORE accepting traffic, so no request can hit
// a half-migrated database (root cause of intermittent 'Failed to record
// appointment in database' 500s right after server start).
(async () => {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`✨ Salon Hair Bride Backend Server Running on Port: ${PORT}`);
    console.log(`🌐 API Base URL: http://localhost:${PORT}/api`);
    console.log(`🗄️ Database Target: MySQL [${DB_CONFIG.database}]`);
    console.log(`=======================================================`);
    setInterval(sendDueReminders, REMINDER_CHECK_INTERVAL_MS);
    setTimeout(sendDueReminders, 10 * 1000); // first sweep shortly after boot
    setInterval(sendDueReviewRequests, REVIEW_CHECK_INTERVAL_MS);
    setTimeout(sendDueReviewRequests, 15 * 1000); // first sweep shortly after boot
  });
})();
