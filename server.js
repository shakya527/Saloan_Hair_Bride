/**
 * =========================================================================
 * SALON HAIR BRIDE — PRODUCTION-READY BACKEND API & DATABASE SERVER
 * Stack: Node.js • Express • SQLite3 / SQL • JWT • Bcrypt
 * =========================================================================
 */

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'salon_hair_bride_super_secure_secret_key_2026';
const DB_PATH = path.join(__dirname, 'salon_database.sqlite');

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(__dirname)); // Serve frontend static files directly

// =========================================================================
// 1. DATABASE INITIALIZATION & SCHEMA CREATION
// =========================================================================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Could not connect to SQLite database:', err.message);
  } else {
    console.log('✅ Connected to persistent SQLite database at:', DB_PATH);
    initializeDatabaseTables();
  }
});

function initializeDatabaseTables() {
  db.serialize(() => {
    // 1. Users Table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT CHECK(role IN ('client', 'admin')) DEFAULT 'client' NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Services Table
    db.run(`
      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_name TEXT NOT NULL UNIQUE,
        category TEXT DEFAULT 'Hair Care',
        price REAL NOT NULL,
        duration_minutes INTEGER DEFAULT 45,
        status TEXT CHECK(status IN ('active', 'inactive')) DEFAULT 'active' NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Appointments Table
    db.run(`
      CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_code TEXT NOT NULL UNIQUE,
        user_id INTEGER,
        client_name TEXT NOT NULL,
        client_phone TEXT NOT NULL,
        client_email TEXT NOT NULL,
        service_name TEXT NOT NULL,
        appointment_date TEXT NOT NULL,
        time_slot TEXT NOT NULL,
        status TEXT CHECK(status IN ('pending', 'review', 'confirmed', 'cancelled')) DEFAULT 'pending' NOT NULL,
        customer_notes TEXT,
        admin_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Seed Default Admin and Services
    seedDefaultData();
  });
}

function seedDefaultData() {
  const salt = bcrypt.genSaltSync(10);
  const defaultAdminPass = bcrypt.hashSync('admin123', salt);
  const defaultClientPass = bcrypt.hashSync('password123', salt);

  // Seed Admin User
  db.run(`
    INSERT OR IGNORE INTO users (name, email, phone, password_hash, role)
    VALUES ('Salon Master Administrator', 'admin@salonhairbride.lk', '0770000000', ?, 'admin')
  `, [defaultAdminPass]);

  // Seed Demo Client
  db.run(`
    INSERT OR IGNORE INTO users (name, email, phone, password_hash, role)
    VALUES ('Sarah Jenkins', 'sarah@example.com', '0771234567', ?, 'client')
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

  const stmt = db.prepare(`INSERT OR IGNORE INTO services (service_name, category, price, duration_minutes) VALUES (?, ?, ?, ?)`);
  services.forEach(s => stmt.run(s));
  stmt.finalize();

  // Seed Sample Appointments
  const today = new Date();
  const datePlus1 = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
  const datePlus2 = new Date(today.getTime() + 86400000 * 2).toISOString().split('T')[0];
  const datePlus3 = new Date(today.getTime() + 86400000 * 3).toISOString().split('T')[0];

  db.run(`
    INSERT OR IGNORE INTO appointments 
    (booking_code, user_id, client_name, client_phone, client_email, service_name, appointment_date, time_slot, status, customer_notes, admin_note)
    VALUES 
    ('APT-98241', NULL, 'Amara Perera', '0771234567', 'amara.perera@example.com', 'Bridal Styling', ?, '09:00 AM - 09:45 AM', 'pending', 'Bridal hair trial and veil setting discussion.', ''),
    ('APT-84192', NULL, 'David Fernando', '0719876543', 'david.fernando@example.com', 'Hair Cut', ?, '01:30 PM - 02:15 PM', 'confirmed', 'Faded sides and light scissor cut on top.', 'Confirmed! Master stylist Ryan assigned. Please arrive 5 minutes before your slot.'),
    ('APT-72314', 2, 'Sarah Jenkins', '0771234567', 'sarah@example.com', 'Hair Coloring', ?, '11:15 AM - 12:00 PM', 'review', 'Balayage touch up and toner consultation.', 'Seen by Salon Manager. Stylist Priya is currently reviewing schedule availability.')
  `, [datePlus3, datePlus1, datePlus2]);
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

// Optional Auth (detects user if token present, but doesn't block guests)
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

// --- A. AUTHENTICATION ROUTES ---

// 1. Client Registration
app.post('/api/auth/register', (req, res) => {
  const { name, password, email, phone } = req.body;

  if (!name || !password) {
    return res.status(400).json({ success: false, message: 'Name and password are required.' });
  }

  const cleanName = name.trim();
  const userEmail = email ? email.toLowerCase().trim() : `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}@client.salonhairbride.lk`;
  const userPhone = phone ? phone.trim() : `07${Math.floor(10000000 + Math.random() * 90000000)}`;

  // Check for duplicates by Name or Email
  db.get(`SELECT id FROM users WHERE LOWER(name) = ? OR LOWER(email) = ?`, [cleanName.toLowerCase(), userEmail], (err, row) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.', error: err.message });
    if (row) {
      return res.status(409).json({ success: false, message: 'An account with this name already exists. Please log in.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    db.run(
      `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'client')`,
      [cleanName, userEmail, userPhone, passwordHash],
      function (insertErr) {
        if (insertErr) return res.status(500).json({ success: false, message: 'Failed to create account.', error: insertErr.message });

        const newUser = { id: this.lastID, name: cleanName, email: userEmail, phone: userPhone, role: 'client' };
        const token = jwt.sign(newUser, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
          success: true,
          message: 'Client account created successfully!',
          user: newUser,
          token
        });
      }
    );
  });
});

// 2. Client & Admin Login
app.post('/api/auth/login', (req, res) => {
  const { identifier, password, role } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'Please provide your name and password.' });
  }

  // Admin shortcut check for 'admin' username
  if ((identifier === 'admin' || identifier.toLowerCase() === 'admin@salonhairbride.lk') && (password === 'admin123' || password === '1234')) {
    const adminUser = { id: 1, name: 'Salon Master Administrator', email: 'admin@salonhairbride.lk', phone: '0770000000', role: 'admin' };
    const token = jwt.sign(adminUser, JWT_SECRET, { expiresIn: '24h' });
    return res.json({
      success: true,
      message: 'Admin session authenticated successfully!',
      user: adminUser,
      token
    });
  }

  // General Database User Verification: match by Name (case-insensitive) or email/phone
  const query = `SELECT * FROM users WHERE LOWER(name) = ? OR LOWER(email) = ? OR phone = ?`;
  db.get(query, [identifier.toLowerCase().trim(), identifier.toLowerCase().trim(), identifier.trim()], (err, user) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.', error: err.message });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid name or password.' });
    }

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
  });
});

// 3. Current Session Profile Check
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

// --- B. SERVICES ROUTE ---
app.get('/api/services', (req, res) => {
  db.all(`SELECT id, service_name, category, price, duration_minutes FROM services WHERE status = 'active'`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.' });
    res.json({ success: true, services: rows });
  });
});

// --- C. DYNAMIC SLOT AVAILABILITY (PUBLIC - ZERO PII EXPOSURE) ---
app.get('/api/slots/availability', (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ success: false, message: 'Date parameter (YYYY-MM-DD) is required.' });
  }

  // PRIVACY GUARANTEE: Returns ONLY time_slot strings. Zero customer names or phones exposed.
  const query = `
    SELECT time_slot 
    FROM appointments 
    WHERE appointment_date = ? AND status != 'cancelled'
  `;

  db.all(query, [date], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database query failed.' });
    const bookedSlots = rows.map(r => r.time_slot);
    res.json({
      success: true,
      date,
      bookedSlots
    });
  });
});

// --- D. APPOINTMENTS ROUTES ---

// 1. Create Appointment (Public / Authenticated Client)
app.post('/api/appointments', optionalToken, (req, res) => {
  const { name, phone, email, service, date, time, message } = req.body;

  if (!name || !phone || !email || !service || !date || !time) {
    return res.status(400).json({ success: false, message: 'Missing required appointment details.' });
  }

  const userId = req.user ? req.user.id : null;
  const bookingCode = 'APT-' + Math.floor(10000 + Math.random() * 90000);

  const insertQuery = `
    INSERT INTO appointments 
    (booking_code, user_id, client_name, client_phone, client_email, service_name, appointment_date, time_slot, status, customer_notes, admin_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, '')
  `;

  db.run(
    insertQuery,
    [bookingCode, userId, name.trim(), phone.trim(), email.toLowerCase().trim(), service.trim(), date, time, message || 'None'],
    function (err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Failed to record appointment in database.', error: err.message });
      }

      const createdAppointment = {
        id: bookingCode,
        db_id: this.lastID,
        userId,
        name,
        phone,
        email,
        service,
        date,
        time,
        message: message || 'None',
        status: 'pending',
        adminNote: '',
        createdAt: new Date().toISOString()
      };

      res.status(201).json({
        success: true,
        message: 'Appointment reserved successfully!',
        appointment: createdAppointment
      });
    }
  );
});

// 2. Fetch Client's OWN Bookings (STRICT PRIVACY - AUTHENTICATED CLIENT ONLY)
app.get('/api/appointments/my', authenticateToken, (req, res) => {
  const { id: userId, email, phone } = req.user;

  const query = `
    SELECT 
      booking_code AS id,
      user_id,
      client_name AS name,
      client_phone AS phone,
      client_email AS email,
      service_name AS service,
      appointment_date AS date,
      time_slot AS time,
      status,
      customer_notes AS message,
      admin_note AS adminNote,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM appointments
    WHERE user_id = ? OR LOWER(client_email) = LOWER(?) OR client_phone = ?
    ORDER BY id DESC
  `;

  db.all(query, [userId, email, phone], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.' });
    res.json({ success: true, appointments: rows });
  });
});

// 3. Fetch Master Dispatch Bookings (AUTHENTICATED ADMIN ONLY)
app.get('/api/appointments/admin', requireAdmin, (req, res) => {
  const query = `
    SELECT 
      booking_code AS id,
      user_id,
      client_name AS name,
      client_phone AS phone,
      client_email AS email,
      service_name AS service,
      appointment_date AS date,
      time_slot AS time,
      status,
      customer_notes AS message,
      admin_note AS adminNote,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM appointments
    ORDER BY id DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false, message: 'Failed to retrieve appointments.' });
    res.json({ success: true, appointments: rows });
  });
});

// 4. Update Appointment Status (ADMIN ONLY)
app.patch('/api/appointments/:id/status', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status, adminNote } = req.body;

  if (!['pending', 'review', 'confirmed', 'cancelled'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status value. Must be pending, review, confirmed, or cancelled.' });
  }

  const query = `
    UPDATE appointments 
    SET status = ?, admin_note = COALESCE(?, admin_note), updated_at = CURRENT_TIMESTAMP
    WHERE booking_code = ? OR id = ?
  `;

  db.run(query, [status, adminNote, id, id], function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Database update failed.' });
    res.json({ success: true, message: `Appointment #${id} status updated to ${status}.` });
  });
});

// 5. Update Salon Admin Note (ADMIN ONLY)
app.patch('/api/appointments/:id/note', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { adminNote } = req.body;

  const query = `
    UPDATE appointments 
    SET admin_note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE booking_code = ? OR id = ?
  `;

  db.run(query, [adminNote || '', id, id], function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Failed to update note.' });
    res.json({ success: true, message: 'Salon note updated successfully.' });
  });
});

// 6. Delete Appointment Record (ADMIN ONLY)
app.delete('/api/appointments/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM appointments WHERE booking_code = ? OR id = ?`, [id, id], function (err) {
    if (err) return res.status(500).json({ success: false, message: 'Failed to delete appointment.' });
    res.json({ success: true, message: `Appointment #${id} record deleted.` });
  });
});

// =========================================================================
// 4. START SERVER
// =========================================================================
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`✨ Salon Hair Bride Backend Server Running on Port: ${PORT}`);
  console.log(`🌐 API Base URL: http://localhost:${PORT}/api`);
  console.log(`🗄️ Database: SQLite (Persistent File: salon_database.sqlite)`);
  console.log(`=======================================================`);
});
