-- =========================================================================
-- SALON HAIR BRIDE — DATABASE SCHEMA DEFINITION (SQL)
-- Engine: MySQL 8.0+ / MariaDB / PostgreSQL / SQLite Compatible
-- NOTE: server.js auto-migrates existing databases on boot. This file mirrors
--       the canonical schema for fresh installs and documentation.
-- =========================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(180) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('client', 'admin') DEFAULT 'client' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. SERVICES TABLE
CREATE TABLE IF NOT EXISTS services (
    id INT AUTO_INCREMENT PRIMARY KEY,
    service_name VARCHAR(150) NOT NULL UNIQUE,
    category VARCHAR(100) DEFAULT 'Hair Care',
    price DECIMAL(10, 2) NOT NULL,
    duration_minutes INT DEFAULT 45,
    description TEXT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. APPOINTMENTS TABLE
CREATE TABLE IF NOT EXISTS appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    booking_code VARCHAR(30) NOT NULL UNIQUE,          -- e.g. 'APT-98241'
    user_id INT NULL,                                  -- Nullable for guest bookings
    client_name VARCHAR(120) NOT NULL,
    client_phone VARCHAR(20) NOT NULL,
    client_email VARCHAR(180) NOT NULL,
    service_name VARCHAR(150) NOT NULL,
    service_id INT NULL,
    appointment_date DATE NOT NULL,
    time_slot VARCHAR(60) NOT NULL,                    -- e.g. '09:00 AM - 09:45 AM'
    status ENUM('pending', 'review', 'confirmed', 'cancelled', 'waiting_list') DEFAULT 'pending' NOT NULL,
    customer_notes TEXT NULL,
    admin_note TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
    INDEX idx_date_slot (appointment_date, time_slot),
    INDEX idx_status (status),
    INDEX idx_user_bookings (user_id, client_email, client_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================================
-- INITIAL SEED DATA
-- =========================================================================

-- Seed Initial Services
INSERT INTO services (service_name, category, price, duration_minutes, status) VALUES
('Hair Cut', 'Styling & Cut', 2500.00, 45, 'active'),
('Hair Coloring', 'Color & Highlights', 6500.00, 90, 'active'),
('Hair Styling', 'Styling & Cut', 3500.00, 45, 'active'),
('Hair Treatment', 'Therapy & Spa', 4800.00, 60, 'active'),
('Bridal Styling', 'Bridal & Occasions', 15000.00, 120, 'active'),
('Facial & Beauty Care', 'Skin & Aesthetics', 4200.00, 60, 'active')
ON DUPLICATE KEY UPDATE price=VALUES(price);

-- Seed Default Admin User (Password: admin123 -> bcrypt hash)
INSERT INTO users (name, email, phone, password_hash, role) VALUES
('Salon Master Administrator', 'admin@salonhairbride.lk', '0770000000', '$2a$10$sua6oR/bG9F6N5tf5tdwMeFrXlBaRTzF0DjHAfqYBZRoudvC96J7e', 'admin')
ON DUPLICATE KEY UPDATE role='admin';

-- Seed Initial Sample Client
INSERT INTO users (name, email, phone, password_hash, role) VALUES
('Sarah Jenkins', 'sarah@example.com', '0771234567', '$2b$10$wE9K2jIqK487m.RjR5/r0Oa0qX9rU4rV7gU6A3I.xT8D1pE3rN3q6', 'client')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Seed Initial Demonstration Appointments
INSERT INTO appointments (booking_code, user_id, client_name, client_phone, client_email, service_name, appointment_date, time_slot, status, customer_notes, admin_note) VALUES
('APT-98241', NULL, 'Amara Perera', '0771234567', 'amara.perera@example.com', 'Bridal Styling', CURDATE() + INTERVAL 3 DAY, '09:00 AM - 09:45 AM', 'pending', 'Bridal hair trial and veil setting discussion.', ''),
('APT-84192', NULL, 'David Fernando', '0719876543', 'david.fernando@example.com', 'Hair Cut', CURDATE() + INTERVAL 1 DAY, '01:30 PM - 02:15 PM', 'confirmed', 'Faded sides and light scissor cut on top.', 'Confirmed! Master stylist Ryan assigned. Please arrive 5 minutes before your slot.'),
('APT-72314', 2, 'Sarah Jenkins', '0771234567', 'sarah@example.com', 'Hair Coloring', CURDATE() + INTERVAL 2 DAY, '11:15 AM - 12:00 PM', 'review', 'Balayage touch up and toner consultation.', 'Seen by Salon Manager. Stylist Priya is currently reviewing schedule availability.')
ON DUPLICATE KEY UPDATE status=VALUES(status);

-- =========================================================================
-- EXTENDED MODULES (auto-created & auto-migrated by server.js on boot)
-- =========================================================================

-- 4. STYLISTS TABLE (staff directory: profile, contact, specializations, shifts)
CREATE TABLE IF NOT EXISTS stylists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    photo_url VARCHAR(500) NULL,
    phone VARCHAR(20) NULL,
    email VARCHAR(180) NULL,
    specialization VARCHAR(150) DEFAULT 'General Styling',
    specializations VARCHAR(255) NULL,                 -- comma-separated e.g. 'Hair, Makeup, Nails'
    shift_days VARCHAR(60) NULL,                       -- e.g. 'Mon,Tue,Wed,Thu,Fri'
    shift_start VARCHAR(10) NULL,                      -- e.g. '09:00'
    shift_end VARCHAR(10) NULL,                        -- e.g. '18:00'
    is_active TINYINT(1) DEFAULT 1 NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stylists_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. STYLIST TIME-OFFS (full off days — leave)
CREATE TABLE IF NOT EXISTS stylist_time_offs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stylist_id INT NOT NULL,
    off_date VARCHAR(20) NOT NULL,
    reason VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_stylist_off_date (stylist_id, off_date),
    FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE CASCADE,
    INDEX idx_time_offs_date (off_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. STYLIST BLOCK-OUTS (breaks / training / unavailable slots)
CREATE TABLE IF NOT EXISTS stylist_blocks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stylist_id INT NOT NULL,
    block_date VARCHAR(20) NOT NULL,
    time_slot VARCHAR(60) NOT NULL,
    reason VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_stylist_block_slot (stylist_id, block_date, time_slot),
    FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE CASCADE,
    INDEX idx_blocks_date_slot (block_date, time_slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. CLIENTS TABLE (CRM profiles)
CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NULL,
    email VARCHAR(180) NULL,
    allergies TEXT NULL,
    color_formula_notes TEXT NULL,
    general_notes TEXT NULL,
    total_visits INT DEFAULT 0 NOT NULL,
    total_spent DECIMAL(10, 2) DEFAULT 0.00 NOT NULL,
    last_visit_date VARCHAR(20) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_clients_phone (phone),
    UNIQUE KEY uq_clients_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. CLIENT PHOTOS (before/after references)
CREATE TABLE IF NOT EXISTS client_photos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_id INT NOT NULL,
    appointment_id INT NULL,
    photo_type ENUM('before', 'after') DEFAULT 'before' NOT NULL,
    photo_url VARCHAR(500) NOT NULL,
    caption VARCHAR(255) NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    INDEX idx_client_photos_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. NOTIFICATION LOG (SMS/WhatsApp/Email audit trail incl. 24h reminders)
CREATE TABLE IF NOT EXISTS notification_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NULL,
    booking_code VARCHAR(30) NULL,
    type VARCHAR(40) NOT NULL,
    channel VARCHAR(10) NOT NULL,
    recipient VARCHAR(180) NULL,
    status VARCHAR(20) DEFAULT 'sent' NOT NULL,
    detail VARCHAR(500) NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notification_type (type, sent_at),
    INDEX idx_notification_apt (appointment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. APPOINTMENT FEEDBACK (client star ratings & review notes — CRM linked)
CREATE TABLE IF NOT EXISTS appointment_feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NULL,
    booking_code VARCHAR(30) NULL,
    client_id INT NULL,
    stylist_id INT NULL,
    client_name VARCHAR(120) NULL,
    client_phone VARCHAR(20) NULL,
    client_email VARCHAR(180) NULL,
    service_name VARCHAR(150) NULL,
    rating TINYINT NOT NULL,                           -- 1 to 5 stars
    notes TEXT NULL,
    source ENUM('client', 'admin') DEFAULT 'client' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_feedback_appointment (appointment_id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE SET NULL,
    INDEX idx_feedback_client (client_id),
    INDEX idx_feedback_stylist (stylist_id),
    INDEX idx_feedback_rating (rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Appointments column extensions applied by server.js auto-migration:
--   ALTER TABLE appointments ADD COLUMN stylist_id INT NULL;
--   ALTER TABLE appointments ADD COLUMN visit_status ENUM('scheduled','checked_in','completed','no_show') DEFAULT 'scheduled' NOT NULL;
--   ALTER TABLE appointments ADD COLUMN check_in_time DATETIME NULL;
--   ALTER TABLE appointments ADD COLUMN completed_time DATETIME NULL;
--   ALTER TABLE appointments ADD KEY idx_stylist_id (stylist_id);
--   ALTER TABLE appointments ADD UNIQUE KEY uq_slot_stylist (appointment_date, time_slot, stylist_id);

-- 11. SMART WAITING LIST (queue for fully-booked slots + auto slot release)
CREATE TABLE IF NOT EXISTS waiting_list (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_name VARCHAR(120) NOT NULL,
    client_phone VARCHAR(20) NOT NULL,
    client_email VARCHAR(180) NULL,
    preferred_date VARCHAR(20) NOT NULL,
    preferred_time_slot VARCHAR(60) NOT NULL,
    stylist_id INT NULL,
    service_id INT NULL,
    service_name VARCHAR(150) NULL,
    status ENUM('pending', 'waiting_list', 'notified', 'booked', 'cancelled') DEFAULT 'pending' NOT NULL,
    notes TEXT NULL,
    notified_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stylist_id) REFERENCES stylists(id) ON DELETE SET NULL,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
    INDEX idx_wl_date_slot (preferred_date, preferred_time_slot),
    INDEX idx_wl_status (status),
    INDEX idx_wl_stylist (stylist_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

