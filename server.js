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
  phone   : process.env.SALON_PHONE   || '',
  address : process.env.SALON_ADDRESS || '',
  email   : process.env.SALON_EMAIL   || 'salonhairbride@gmail.com'
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
        \`status\` ENUM('pending', 'review', 'confirmed', 'cancelled') DEFAULT 'pending' NOT NULL,
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

    // 4. Stylists Table (salon staff roster — 10 stylists)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`stylists\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(120) NOT NULL,
        \`specialization\` VARCHAR(150) DEFAULT 'General Styling',
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

async function seedDefaultData() {
  try {
    const salt = bcrypt.genSaltSync(10);
    const defaultAdminPass = bcrypt.hashSync('admin123', salt);
    const defaultClientPass = bcrypt.hashSync('password123', salt);

    // Seed Master Admin User (Password: admin123)
    await pool.query(`
      INSERT INTO \`users\` (\`name\`, \`email\`, \`phone\`, \`password_hash\`, \`role\`)
      VALUES ('Salon Master Administrator', 'admin@salonhairbride.lk', '0770000000', ?, 'admin')
      ON DUPLICATE KEY UPDATE \`role\` = 'admin'
    `, [defaultAdminPass]);

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
app.post('/api/auth/login', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });

    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Please provide your email/phone and password.' });
    }

    const cleanIdentifier = identifier.trim();

    // Admin shortcut verification
    if ((cleanIdentifier === 'admin' || cleanIdentifier.toLowerCase() === 'admin@salonhairbride.lk') && (password === 'admin123' || password === '1234')) {
      const adminUser = { id: 1, name: 'Salon Master Administrator', email: 'admin@salonhairbride.lk', phone: '0770000000', role: 'admin' };
      const token = jwt.sign(adminUser, JWT_SECRET, { expiresIn: '24h' });
      return res.json({
        success: true,
        message: 'Admin session authenticated successfully!',
        user: adminUser,
        token
      });
    }

    // Database lookup strictly by unique Email or Phone
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE LOWER(email) = ? OR phone = ?',
      [cleanIdentifier.toLowerCase(), cleanIdentifier]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email/phone or password.' });
    }

    const user = rows[0];
    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. Password does not match.' });
    }

    const safeUser = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
    const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: user.role === 'admin' ? '24h' : '7d' });

    res.json({
      success: true,
      message: 'Login successful!',
      user: safeUser,
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Database login error.', error: err.message });
  }
});

// 3. Current Session Profile Check
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// --- B. SERVICES ROUTE ---
app.get('/api/services', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [rows] = await pool.query("SELECT id, service_name, category, price, duration_minutes FROM services WHERE status = 'active'");
    res.json({ success: true, services: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed.', error: err.message });
  }
});

// --- B2. STYLIST ROSTER & SCHEDULE ROUTES ---

// Public: active stylists only (no internal scheduling detail exposed)
app.get('/api/stylists', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [rows] = await pool.query(
      "SELECT id, name, specialization FROM stylists WHERE is_active = 1 ORDER BY id ASC"
    );
    res.json({ success: true, stylists: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed.', error: err.message });
  }
});

// Admin: full roster including inactive
app.get('/api/stylists/admin', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [rows] = await pool.query("SELECT id, name, specialization, is_active FROM stylists ORDER BY id ASC");
    res.json({ success: true, stylists: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database query failed.', error: err.message });
  }
});

// Admin: add a stylist
app.post('/api/stylists', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { name, specialization } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Stylist name is required.' });
    }
    const [result] = await pool.query(
      "INSERT INTO stylists (name, specialization, is_active) VALUES (?, ?, 1)",
      [name.trim(), (specialization || 'General Styling').trim()]
    );
    res.status(201).json({ success: true, message: 'Stylist added.', stylist: { id: result.insertId, name: name.trim(), specialization: (specialization || 'General Styling').trim() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add stylist.', error: err.message });
  }
});

// Admin: update stylist (rename / specialization / active flag)
app.patch('/api/stylists/:id', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const { id } = req.params;
    const { name, specialization, is_active } = req.body;

    const sets = [];
    const params = [];
    if (name !== undefined) { sets.push('name = ?'); params.push(String(name).trim()); }
    if (specialization !== undefined) { sets.push('specialization = ?'); params.push(String(specialization).trim()); }
    if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0); }
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
    res.json({ success: true, appointments: rows });
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

    res.json({ success: true, message: `Appointment #${id} has been cancelled.`, status: 'cancelled' });
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
    const { status, adminNote } = req.body;

    if (!['pending', 'review', 'confirmed', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value. Must be pending, review, confirmed, or cancelled.' });
    }

    const query = `
      UPDATE appointments
      SET status = ?, admin_note = COALESCE(?, admin_note),
          stylist_id = CASE WHEN ? = 'cancelled' THEN NULL ELSE stylist_id END,
          updated_at = CURRENT_TIMESTAMP
      WHERE booking_code = ? OR id = ?
    `;

    const [updateResult] = await pool.query(query, [status, adminNote, status, id, id]);

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Appointment #${id} not found.` });
    }

    // Notification matrix: fire typed notifications on terminal status changes
    if (status === 'confirmed' || status === 'cancelled') {
      const [aptRows] = await pool.query('SELECT * FROM appointments WHERE booking_code = ? OR id = ?', [id, id]);
      if (aptRows.length > 0) {
        await dispatchNotification(aptRows[0], status === 'confirmed' ? 'confirmed' : 'cancelled');
      }
    }

    res.json({ success: true, message: `Appointment #${id} status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database update failed.', error: err.message });
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

    // Check if user is admin
    if (req.user && req.user.role === 'admin') {
      const [result] = await pool.query('DELETE FROM appointments WHERE booking_code = ? OR id = ?', [id, id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `Appointment #${id} not found in database.` });
      }
      return res.json({ success: true, message: `Appointment #${id} record deleted from MySQL database.` });
    }

    // If client is logged in, verify ownership or booking code
    if (req.user && req.user.role === 'client') {
      const [result] = await pool.query(
        'DELETE FROM appointments WHERE (booking_code = ? OR id = ?) AND (user_id = ? OR (client_email IS NOT NULL AND client_email != "" AND LOWER(client_email) = LOWER(?)))',
        [id, id, req.user.id || 0, req.user.email || '']
      );
      if (result.affectedRows > 0) {
        return res.json({ success: true, message: `Appointment #${id} deleted successfully.` });
      }
    }

    // Direct booking code deletion fallback
    const [result] = await pool.query('DELETE FROM appointments WHERE booking_code = ? OR id = ?', [id, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Appointment #${id} not found in database.` });
    }

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
    if (visitStatus === 'completed')  { sets.push('completed_time = NOW()'); }
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
app.get('/api/clients', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const search = (req.query.search || '').trim();
    let query = `SELECT id, name, phone, email, allergies, color_formula_notes AS colorFormulaNotes,
                        general_notes AS generalNotes, total_visits AS totalVisits,
                        total_spent AS totalSpent, last_visit_date AS lastVisitDate, created_at AS createdAt
                 FROM clients`;
    const params = [];
    if (search) {
      query += ' WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?';
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    query += ' ORDER BY name ASC LIMIT 200';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, clients: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load clients.', error: err.message });
  }
});

app.get('/api/clients/:id', requireAdmin, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ success: false, message: 'Database connection not ready.' });
    const [clientRows] = await pool.query(
      `SELECT id, name, phone, email, allergies, color_formula_notes AS colorFormulaNotes,
              general_notes AS generalNotes, total_visits AS totalVisits,
              total_spent AS totalSpent, last_visit_date AS lastVisitDate, created_at AS createdAt
       FROM clients WHERE id = ?`,
      [req.params.id]
    );
    if (clientRows.length === 0) return res.status(404).json({ success: false, message: 'Client not found.' });
    const client = clientRows[0];

    const [photos] = await pool.query(
      `SELECT p.id, p.photo_type AS photoType, p.photo_url AS photoUrl, p.caption,
              p.appointment_id AS appointmentId, p.uploaded_at AS uploadedAt
       FROM client_photos p WHERE p.client_id = ? ORDER BY p.uploaded_at DESC`,
      [client.id]
    );

    // Visit history: match by unique phone OR email
    const [visits] = await pool.query(
      `SELECT a.booking_code AS bookingCode, a.service_name AS service, a.appointment_date AS date,
              a.time_slot AS timeSlot, a.status, a.visit_status AS visitStatus,
              st.name AS stylistName, a.admin_note AS adminNote
       FROM appointments a LEFT JOIN stylists st ON st.id = a.stylist_id
       WHERE (a.client_phone = ? AND ? != '')
          OR (a.client_email IS NOT NULL AND a.client_email != '' AND LOWER(a.client_email) = LOWER(?))
       ORDER BY a.appointment_date DESC, a.id DESC
       LIMIT 100`,
      [client.phone || '', client.phone || '', client.email || '']
    );

    res.json({ success: true, client, photos, visits });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load client profile.', error: err.message });
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
    aptTime    : apt.appointmentTime || apt.appointment_time || apt.time || 'N/A',
    adminNote  : apt.adminNote || apt.admin_note || ''
  };
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
    note        : () => 'We would be truly grateful for your feedback — it helps us serve you better. Simply reply to this message with your thoughts!'
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

              <!-- Reminder -->
              <p style="color:#555;font-size:13px;line-height:1.7;">
                🕐 <strong>Reminder:</strong> Please arrive 5–10 minutes before your scheduled time.<br/>
                📞 Questions? Contact us at <a href="tel:${SALON.phone}" style="color:#8B6F47;">${SALON.phone || SALON.email}</a>
              </p>
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

  const message = [
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
  });
})();
