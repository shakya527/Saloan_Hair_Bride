-- =========================================================================
-- SALON HAIR BRIDE — DATABASE SCHEMA DEFINITION (SQL)
-- Engine: MySQL 8.0+ / MariaDB / PostgreSQL / SQLite Compatible
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
    status ENUM('pending', 'review', 'confirmed', 'cancelled') DEFAULT 'pending' NOT NULL,
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
('Salon Master Administrator', 'admin@salonhairbride.lk', '0770000000', '$2b$10$wE9K2jIqK487m.RjR5/r0Oa0qX9rU4rV7gU6A3I.xT8D1pE3rN3q6', 'admin')
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
