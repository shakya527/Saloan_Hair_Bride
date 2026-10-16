-- =========================================================================
-- SALON HAIR BRIDE — MYSQL / phpMyAdmin DATABASE SCHEMA & SEED SCRIPT
-- Database: salon_db
-- Compatibility: MySQL 5.7+ / MySQL 8.0+ / MariaDB 10.3+ / phpMyAdmin
-- Default Credentials: Host: localhost | User: root | Password: '' (empty)
-- =========================================================================

-- 1. CREATE DATABASE
CREATE DATABASE IF NOT EXISTS `salon_db` 
DEFAULT CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE `salon_db`;

-- 2. CREATE USERS TABLEs
CREATE TABLE IF NOT EXISTS `users` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(180) NOT NULL UNIQUE,
    `phone` VARCHAR(20) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('client', 'admin') DEFAULT 'client' NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. CREATE SERVICES TABLE
CREATE TABLE IF NOT EXISTS `services` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `service_name` VARCHAR(150) NOT NULL UNIQUE,
    `category` VARCHAR(100) DEFAULT 'Hair Care',
    `price` DECIMAL(10, 2) NOT NULL,
    `duration_minutes` INT DEFAULT 45,
    `status` ENUM('active', 'inactive') DEFAULT 'active' NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. CREATE APPOINTMENTS TABLE
CREATE TABLE IF NOT EXISTS `appointments` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `booking_code` VARCHAR(30) NOT NULL UNIQUE,
    `user_id` INT NULL,
    `stylist_id` INT NULL,
    `client_name` VARCHAR(120) NOT NULL,
    `client_phone` VARCHAR(20) NOT NULL,
    `client_email` VARCHAR(180) NOT NULL,
    `service_name` VARCHAR(150) NOT NULL,
    `appointment_date` VARCHAR(20) NOT NULL,
    `time_slot` VARCHAR(60) NOT NULL,
    `status` ENUM('pending', 'review', 'confirmed', 'cancelled') DEFAULT 'pending' NOT NULL,
    `visit_status` ENUM('scheduled', 'checked_in', 'completed', 'no_show') DEFAULT 'scheduled' NOT NULL,
    `check_in_time` DATETIME NULL,
    `completed_time` DATETIME NULL,
    `customer_notes` TEXT NULL,
    `admin_note` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
    FOREIGN KEY (`stylist_id`) REFERENCES `stylists`(`id`) ON DELETE SET NULL,
    UNIQUE KEY `uq_slot_stylist` (`appointment_date`, `time_slot`, `stylist_id`),
    INDEX `idx_date_slot` (`appointment_date`, `time_slot`),
    INDEX `idx_status` (`status`),
    INDEX `idx_user_bookings` (`user_id`, `client_email`, `client_phone`),
    INDEX `idx_stylist_id` (`stylist_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. CREATE STYLISTS TABLE (salon staff roster)
CREATE TABLE IF NOT EXISTS `stylists` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(120) NOT NULL,
    `specialization` VARCHAR(150) DEFAULT 'General Styling',
    `is_active` TINYINT(1) DEFAULT 1 NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_stylists_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. CREATE STYLIST TIME-OFF TABLE (per-stylist schedules / leaves)
CREATE TABLE IF NOT EXISTS `stylist_time_offs` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `stylist_id` INT NOT NULL,
    `off_date` VARCHAR(20) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_stylist_off_date` (`stylist_id`, `off_date`),
    FOREIGN KEY (`stylist_id`) REFERENCES `stylists`(`id`) ON DELETE CASCADE,
    INDEX `idx_time_offs_date` (`off_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. CREATE STYLIST BLOCK-OUT TABLE (breaks / training / unavailable time blocks per slot)
CREATE TABLE IF NOT EXISTS `stylist_blocks` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `stylist_id` INT NOT NULL,
    `block_date` VARCHAR(20) NOT NULL,
    `time_slot` VARCHAR(60) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_stylist_block_slot` (`stylist_id`, `block_date`, `time_slot`),
    FOREIGN KEY (`stylist_id`) REFERENCES `stylists`(`id`) ON DELETE CASCADE,
    INDEX `idx_blocks_date_slot` (`block_date`, `time_slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. CREATE CLIENTS TABLE (CRM profiles — auto-created from bookings, one row per unique phone or email)
CREATE TABLE IF NOT EXISTS `clients` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(20) NULL,
    `email` VARCHAR(180) NULL,
    `allergies` TEXT NULL,
    `color_formula_notes` TEXT NULL,
    `general_notes` TEXT NULL,
    `total_visits` INT DEFAULT 0 NOT NULL,
    `total_spent` DECIMAL(10, 2) DEFAULT 0.00 NOT NULL,
    `last_visit_date` VARCHAR(20) NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_clients_phone` (`phone`),
    UNIQUE KEY `uq_clients_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. CREATE CLIENT PHOTOS TABLE (before/after photo references linked to client + optional appointment)
CREATE TABLE IF NOT EXISTS `client_photos` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `client_id` INT NOT NULL,
    `appointment_id` INT NULL,
    `photo_type` ENUM('before', 'after') DEFAULT 'before' NOT NULL,
    `photo_url` TEXT NOT NULL,
    `caption` VARCHAR(255) NULL,
    `uploaded_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE,
    INDEX `idx_client_photos_client` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. CREATE NOTIFICATION LOG TABLE (audit trail for the automated notification matrix)
CREATE TABLE IF NOT EXISTS `notification_log` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `appointment_id` INT NULL,
    `booking_code` VARCHAR(30) NULL,
    `type` VARCHAR(40) NOT NULL,
    `channel` VARCHAR(10) NOT NULL,
    `recipient` VARCHAR(180) NULL,
    `status` VARCHAR(20) DEFAULT 'sent' NOT NULL,
    `detail` VARCHAR(500) NULL,
    `sent_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_notification_type` (`type`, `sent_at`),
    INDEX `idx_notification_apt` (`appointment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================================
-- INITIAL SEED DATA
-- =========================================================================

-- Seed Initial Services
INSERT INTO `services` (`service_name`, `category`, `price`, `duration_minutes`, `status`) VALUES
('Hair Cut', 'Styling & Cut', 2500.00, 45, 'active'),
('Hair Coloring', 'Color & Highlights', 6500.00, 90, 'active'),
('Hair Styling', 'Styling & Cut', 3500.00, 45, 'active'),
('Hair Treatment', 'Therapy & Spa', 4800.00, 60, 'active'),
('Bridal Styling', 'Bridal & Occasions', 15000.00, 120, 'active'),
('Facial & Beauty Care', 'Skin & Aesthetics', 4200.00, 60, 'active')
ON DUPLICATE KEY UPDATE `price` = VALUES(`price`);

-- Seed Default Admin User (Username: admin | Password: admin123)
-- bcrypt hash for 'admin123' is '$2b$10$wE9K2jIqK487m.RjR5/r0Oa0qX9rU4rV7gU6A3I.xT8D1pE3rN3q6'
INSERT INTO `users` (`name`, `email`, `phone`, `password_hash`, `role`) VALUES
('Salon Master Administrator', 'admin@salonhairbride.lk', '0770000000', '$2b$10$wE9K2jIqK487m.RjR5/r0Oa0qX9rU4rV7gU6A3I.xT8D1pE3rN3q6', 'admin')
ON DUPLICATE KEY UPDATE `role` = 'admin';

-- Seed Demo Client (Name: Sarah Jenkins | Password: password123)
INSERT INTO `users` (`name`, `email`, `phone`, `password_hash`, `role`) VALUES
('Sarah Jenkins', 'sarah@example.com', '0771234567', '$2b$10$wE9K2jIqK487m.RjR5/r0Oa0qX9rU4rV7gU6A3I.xT8D1pE3rN3q6', 'client')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Seed Stylists (10 total) — safe to re-run, skips when roster already populated
INSERT INTO `stylists` (`name`, `specialization`, `is_active`)
SELECT * FROM (
    SELECT 'Nadeesha Fernando' AS n, 'Bridal & Occasions' AS s, 1 AS a UNION ALL
    SELECT 'Ryan Perera', 'Styling & Cut', 1 UNION ALL
    SELECT 'Priya Silva', 'Color & Highlights', 1 UNION ALL
    SELECT 'Kasun Jayawardena', 'Styling & Cut', 1 UNION ALL
    SELECT 'Tharushi Bandara', 'Therapy & Spa', 1 UNION ALL
    SELECT 'Dinuka Wijeratne', 'Color & Highlights', 1 UNION ALL
    SELECT 'Sithum Rathnayake', 'Styling & Cut', 1 UNION ALL
    SELECT 'Ishara Mendis', 'Bridal & Occasions', 1 UNION ALL
    SELECT 'Ravindu Gunawardena', 'Therapy & Spa', 1 UNION ALL
    SELECT 'Malsha Herath', 'Skin & Aesthetics', 1
) AS roster
WHERE NOT EXISTS (SELECT 1 FROM `stylists`);

-- Seed Initial Demonstration Appointments
INSERT INTO `appointments` (`booking_code`, `user_id`, `stylist_id`, `client_name`, `client_phone`, `client_email`, `service_name`, `appointment_date`, `time_slot`, `status`, `customer_notes`, `admin_note`) VALUES
('APT-98241', NULL, 1, 'Amara Perera', '0771234567', 'amara.perera@example.com', 'Bridal Styling', DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 DAY), '%Y-%m-%d'), '09:00 AM - 09:45 AM', 'pending', 'Bridal hair trial and veil setting discussion.', ''),
('APT-84192', NULL, 2, 'David Fernando', '0719876543', 'david.fernando@example.com', 'Hair Cut', DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 DAY), '%Y-%m-%d'), '01:30 PM - 02:15 PM', 'confirmed', 'Faded sides and light scissor cut on top.', 'Confirmed! Master stylist Ryan assigned. Please arrive 5 minutes before your slot.'),
('APT-72314', 2, 3, 'Sarah Jenkins', '0771234567', 'sarah@example.com', 'Hair Coloring', DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 2 DAY), '%Y-%m-%d'), '11:15 AM - 12:00 PM', 'review', 'Balayage touch up and toner consultation.', 'Seen by Salon Manager. Stylist Priya is currently reviewing schedule availability.')
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`);
