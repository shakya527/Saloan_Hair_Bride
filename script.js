/**
 * ==========================================================================
 * SALON HAIR BIRD — MASTER JAVASCRIPT
 * Features:
 *   1. Mobile Navigation Toggle & Accessible Drawer
 *   2. Appointment Form Real-Time Validation & Dynamic Feedback
 *   3. Smooth Scrolling & Header Elevation (ScrollSpy)
 *   4. Interactive Gallery Lightbox Modal
 *   5. Service Category Filtering
 *   6. Quick Service Booking Linkage
 *   7. Dynamic Date Restriction (Min Today)
 *   8. Scroll-to-Top Indicator
 * ==========================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. MOBILE NAVIGATION DRAWER
  // --------------------------------------------------------------------------
  const mobileToggle = document.getElementById('mobileToggle');
  const navMenu = document.getElementById('navMenu');
  const navOverlay = document.getElementById('navOverlay');
  const navLinks = document.querySelectorAll('.nav-link');

  function openMobileNav() {
    if (!mobileToggle || !navMenu) return;
    mobileToggle.classList.add('active');
    mobileToggle.setAttribute('aria-expanded', 'true');
    navMenu.classList.add('active');
    navMenu.classList.add('open');
    if (navOverlay) navOverlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
  }

  function closeMobileNav() {
    if (!mobileToggle || !navMenu) return;
    mobileToggle.classList.remove('active');
    mobileToggle.setAttribute('aria-expanded', 'false');
    navMenu.classList.remove('active');
    navMenu.classList.remove('open');
    if (navOverlay) navOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (mobileToggle) {
    mobileToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = navMenu.classList.contains('active') || navMenu.classList.contains('open');
      if (isOpen) {
        closeMobileNav();
      } else {
        openMobileNav();
      }
    });
  }

  if (navOverlay) {
    navOverlay.addEventListener('click', closeMobileNav);
  }

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      closeMobileNav();
    });
  });

  // --------------------------------------------------------------------------
  // 2. HEADER ELEVATION & SCROLLSPY
  // --------------------------------------------------------------------------
  const navbar = document.getElementById('navbar');
  const sections = document.querySelectorAll('section[id], header[id]');
  const scrollTopBtn = document.getElementById('scrollTopBtn');

  function handleScrollEffects() {
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    // Header shadow elevation
    if (navbar) {
      if (scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    }

    // Scroll to top button visibility
    if (scrollTopBtn) {
      if (scrollY > 400) {
        scrollTopBtn.classList.add('visible');
      } else {
        scrollTopBtn.classList.remove('visible');
      }
    }

    // Scrollspy: Highlight current section in navigation
    let currentSectionId = '';
    sections.forEach(section => {
      const sectionTop = section.offsetTop - 120;
      const sectionHeight = section.offsetHeight;
      if (scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
        currentSectionId = section.getAttribute('id');
      }
    });

    if (currentSectionId) {
      navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${currentSectionId}`) {
          link.classList.add('active');
        }
      });
    }
  }

  window.addEventListener('scroll', handleScrollEffects, { passive: true });
  handleScrollEffects(); // Initial check on load

  if (scrollTopBtn) {
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
  }

  // --------------------------------------------------------------------------
  // 3. APPOINTMENT FORM VALIDATION & INTERACTIVE STATE
  // --------------------------------------------------------------------------
  const appointmentForm = document.getElementById('appointmentForm');
  const formSuccessMessage = document.getElementById('formSuccessMessage');
  const feedbackClientName = document.getElementById('feedbackClientName');
  const btnResetForm = document.getElementById('btnResetForm');

  const inputName = document.getElementById('fullName');
  const inputPhone = document.getElementById('phoneNumber');
  const inputEmail = document.getElementById('email');
  const selectService = document.getElementById('serviceSelect');
  const inputDate = document.getElementById('preferredDate');
  const selectTime = document.getElementById('preferredTime');
  const inputMessage = document.getElementById('bookingMessage');

  const errorName = document.getElementById('nameError');
  const errorPhone = document.getElementById('phoneError');
  const errorEmail = document.getElementById('emailError');
  const errorService = document.getElementById('serviceError');
  const errorDate = document.getElementById('dateError');

  // Set minimum booking date to today
  if (inputDate) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    inputDate.min = `${yyyy}-${mm}-${dd}`;
  }

  // Backend REST API Base URL
  const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000/api'
    : '/api';

  // Real-time slot availability check: queries database API for booked slots on selected date
  async function updateAvailableSlots() {
    if (!inputDate || !selectTime) return;
    const selectedDate = inputDate.value;
    if (!selectedDate) return;

    let bookedTimes = [];

    try {
      const response = await fetch(`${API_BASE_URL}/slots/availability?date=${encodeURIComponent(selectedDate)}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.success && Array.isArray(data.bookedSlots)) {
          bookedTimes = data.bookedSlots;
        }
      } else {
        throw new Error('API slot query failed');
      }
    } catch (err) {
      // Local fallback if backend is offline
      const appointments = getStoredAppointments();
      bookedTimes = appointments
        .filter(apt => apt.date === selectedDate && apt.status !== 'cancelled')
        .map(apt => apt.time);
    }

    const options = selectTime.querySelectorAll('option');
    options.forEach(opt => {
      if (!opt.value) return; // Skip placeholder
      const baseTime = opt.getAttribute('data-base-time') || opt.value;
      if (!opt.getAttribute('data-base-time')) {
        opt.setAttribute('data-base-time', baseTime);
      }

      if (bookedTimes.includes(baseTime)) {
        opt.disabled = true;
        opt.textContent = `${baseTime} (Booked / Unavailable)`;
        opt.style.color = '#999999';
        opt.style.backgroundColor = '#F5F5F5';
        if (selectTime.value === baseTime) {
          selectTime.value = '';
        }
      } else {
        opt.disabled = false;
        opt.textContent = baseTime;
        opt.style.color = '';
        opt.style.backgroundColor = '';
      }
    });
  }

  if (inputDate) {
    inputDate.addEventListener('change', updateAvailableSlots);
  }

  // Real-time error clearing on user input
  function setupInputValidation(inputElement, errorElement, validationFn) {
    if (!inputElement || !errorElement) return;

    inputElement.addEventListener('input', () => {
      if (validationFn(inputElement.value.trim())) {
        inputElement.classList.remove('is-invalid');
        errorElement.classList.remove('visible');
      }
    });

    inputElement.addEventListener('change', () => {
      if (validationFn(inputElement.value.trim())) {
        inputElement.classList.remove('is-invalid');
        errorElement.classList.remove('visible');
      }
    });
  }

  const isValidName = val => val.length >= 2;
  // Strict 10-digit validation: exactly 10 numeric digits (0-9)
  const isValidPhone = val => /^[0-9]{10}$/.test(val);
  const isValidEmail = val => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  const isValidService = val => val !== '';
  const isValidDate = val => {
    if (!val) return false;
    const selectedDate = new Date(val);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selectedDate >= today;
  };

  // Real-time phone number sanitization: only allow digits (0-9) and cap at 10 digits
  if (inputPhone) {
    inputPhone.addEventListener('input', () => {
      inputPhone.value = inputPhone.value.replace(/\D/g, '').slice(0, 10);
    });
  }

  setupInputValidation(inputName, errorName, isValidName);
  setupInputValidation(inputPhone, errorPhone, isValidPhone);
  setupInputValidation(inputEmail, errorEmail, isValidEmail);
  setupInputValidation(selectService, errorService, isValidService);
  setupInputValidation(inputDate, errorDate, isValidDate);

  if (appointmentForm) {
    appointmentForm.addEventListener('submit', (e) => {
      e.preventDefault();

      let isValid = true;

      // Validate Full Name
      const nameVal = inputName.value.trim();
      if (!isValidName(nameVal)) {
        inputName.classList.add('is-invalid');
        errorName.textContent = nameVal.length === 0 ? 'Name cannot be empty.' : 'Please enter at least 2 characters.';
        errorName.classList.add('visible');
        isValid = false;
      } else {
        inputName.classList.remove('is-invalid');
        errorName.classList.remove('visible');
      }

      // Validate Phone Number
      const phoneVal = inputPhone.value.trim();
      if (!isValidPhone(phoneVal)) {
        inputPhone.classList.add('is-invalid');
        errorPhone.textContent = phoneVal.length === 0 
          ? 'Phone number cannot be empty.' 
          : 'Please enter a valid 10-digit phone number (e.g. 0771234567).';
        errorPhone.classList.add('visible');
        isValid = false;
      } else {
        inputPhone.classList.remove('is-invalid');
        errorPhone.classList.remove('visible');
      }

      // Validate Email (Required for automated EmailJS confirmation notifications)
      const emailVal = inputEmail ? inputEmail.value.trim() : '';
      if (!isValidEmail(emailVal)) {
        if (inputEmail) inputEmail.classList.add('is-invalid');
        if (errorEmail) {
          errorEmail.textContent = emailVal.length === 0 ? 'Email address is required for confirmation.' : 'Please enter a valid email address.';
          errorEmail.classList.add('visible');
        }
        isValid = false;
      } else {
        if (inputEmail) inputEmail.classList.remove('is-invalid');
        if (errorEmail) errorEmail.classList.remove('visible');
      }

      // Validate Service
      const serviceVal = selectService.value;
      if (!isValidService(serviceVal)) {
        selectService.classList.add('is-invalid');
        errorService.textContent = 'Service must be selected.';
        errorService.classList.add('visible');
        isValid = false;
      } else {
        selectService.classList.remove('is-invalid');
        errorService.classList.remove('visible');
      }

      // Validate Date
      const dateVal = inputDate.value;
      if (!isValidDate(dateVal)) {
        inputDate.classList.add('is-invalid');
        errorDate.textContent = dateVal ? 'Please select a date from today onwards.' : 'Date must be selected.';
        errorDate.classList.add('visible');
        isValid = false;
      } else {
        inputDate.classList.remove('is-invalid');
        errorDate.classList.remove('visible');
      }

      // If valid, submit appointment request
      if (isValid) {
        const loggedInUser = getCurrentUser();
        const appointmentData = {
          userId: loggedInUser ? loggedInUser.id : null,
          name: nameVal,
          phone: phoneVal,
          email: emailVal,
          service: serviceVal,
          date: dateVal,
          time: (selectTime && selectTime.value) ? selectTime.value : '09:00 AM - 09:45 AM',
          message: inputMessage ? (inputMessage.value.trim() || 'None') : 'None'
        };

        const newApt = createNewAppointment(appointmentData);

        // Show customer live tracking feedback
        renderCustomerConfirmation(newApt);
        appointmentForm.style.display = 'none';
        if (formSuccessMessage) {
          formSuccessMessage.classList.add('show');
          formSuccessMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        updateAvailableSlots();
      } else {
        // Focus first invalid element
        const firstInvalid = appointmentForm.querySelector('.is-invalid');
        if (firstInvalid) {
          firstInvalid.focus();
        }
      }
    });
  }

  // Reset form handler
  if (btnResetForm) {
    btnResetForm.addEventListener('click', () => {
      appointmentForm.reset();
      formSuccessMessage.classList.remove('show');
      appointmentForm.style.display = 'block';
      autofillClientBookingForm();
      try {
        sessionStorage.removeItem(ACTIVE_BOOKING_KEY);
      } catch (e) {}
    });
  }

  // --------------------------------------------------------------------------
  // 4. QUICK SERVICE LINKAGE: BOOK FROM SERVICE CARD
  // --------------------------------------------------------------------------
  const serviceBookButtons = document.querySelectorAll('.service-book-btn');

  serviceBookButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedServiceName = btn.getAttribute('data-service-select');
      
      // If success message was open, reset form back to input
      if (formSuccessMessage && formSuccessMessage.classList.contains('show')) {
        formSuccessMessage.classList.remove('show');
        appointmentForm.style.display = 'block';
      }

      if (selectService && selectedServiceName) {
        selectService.value = selectedServiceName;
        selectService.classList.remove('is-invalid');
        if (errorService) errorService.classList.remove('visible');
      }

      // Smoothly navigate to appointment section
      const appointmentSection = document.getElementById('appointment');
      if (appointmentSection) {
        appointmentSection.scrollIntoView({ behavior: 'smooth' });
        setTimeout(() => {
          if (inputName) inputName.focus();
        }, 500);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. SERVICE CATEGORY FILTER TABS
  // --------------------------------------------------------------------------
  const filterButtons = document.querySelectorAll('.filter-btn');
  const serviceCards = document.querySelectorAll('.service-card');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      const filterValue = btn.getAttribute('data-filter');

      serviceCards.forEach(card => {
        const category = card.getAttribute('data-category');
        if (filterValue === 'all' || category === filterValue) {
          card.style.display = 'flex';
          setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
          }, 50);
        } else {
          card.style.opacity = '0';
          card.style.transform = 'translateY(15px)';
          setTimeout(() => {
            card.style.display = 'none';
          }, 250);
        }
      });
    });
  });

  // --------------------------------------------------------------------------
  // 6. INTERACTIVE GALLERY LIGHTBOX MODAL
  // --------------------------------------------------------------------------
  const galleryItems = document.querySelectorAll('.gallery-item');
  const lightboxModal = document.getElementById('lightboxModal');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxTitle = document.getElementById('lightboxTitle');
  const lightboxCategory = document.getElementById('lightboxCategory');
  const lightboxClose = document.getElementById('lightboxClose');

  function openLightbox(src, title, category) {
    if (!lightboxModal || !lightboxImg) return;
    lightboxImg.src = src;
    lightboxImg.alt = title;
    if (lightboxTitle) lightboxTitle.textContent = title;
    if (lightboxCategory) lightboxCategory.textContent = category;

    lightboxModal.classList.add('active');
    lightboxModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    if (!lightboxModal) return;
    lightboxModal.classList.remove('active');
    lightboxModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  galleryItems.forEach(item => {
    const triggerItem = () => {
      const src = item.getAttribute('data-src');
      const title = item.getAttribute('data-title');
      const category = item.getAttribute('data-category');
      openLightbox(src, title, category);
    };

    item.addEventListener('click', triggerItem);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerItem();
      }
    });
  });

  if (lightboxClose) {
    lightboxClose.addEventListener('click', closeLightbox);
  }

  if (lightboxModal) {
    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) {
        closeLightbox();
      }
    });
  }

  // Keyboard accessibility: Escape key closes lightbox and mobile drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (lightboxModal && lightboxModal.classList.contains('active')) {
        closeLightbox();
      }
      if (navMenu && (navMenu.classList.contains('active') || navMenu.classList.contains('open'))) {
        closeMobileNav();
      }
    }
  });

  // ==========================================================================
  // REAL-TIME AUTHENTICATION, PRIVACY SANCTUARY & ADMIN DISPATCH SYSTEM
  // ==========================================================================
  const APPOINTMENTS_STORAGE_KEY = 'salon_hair_bird_appointments';
  const ACTIVE_BOOKING_KEY = 'salon_active_booking_id';
  const SOUND_STORAGE_KEY = 'salon_admin_sound_muted';
  const USERS_STORAGE_KEY = 'salon_registered_users';
  const CURRENT_USER_STORAGE_KEY = 'salon_logged_in_client';
  const ADMIN_AUTH_STORAGE_KEY = 'salon_admin_authenticated';

  // Customer Feedback DOM references
  const feedbackIcon = document.getElementById('feedbackIcon');
  const feedbackStatusBadge = document.getElementById('feedbackStatusBadge');
  const feedbackStatusText = document.getElementById('feedbackStatusText');
  const feedbackTitle = document.getElementById('feedbackTitle');
  const feedbackDetails = document.getElementById('feedbackDetails');
  const summaryBookingId = document.getElementById('summaryBookingId');
  const summaryCreatedAt = document.getElementById('summaryCreatedAt');
  const summaryService = document.getElementById('summaryService');
  const summaryDateTime = document.getElementById('summaryDateTime');
  const summaryPhone = document.getElementById('summaryPhone');
  const summaryRequests = document.getElementById('summaryRequests');
  const salonNoteContainer = document.getElementById('salonNoteContainer');
  const salonNoteBody = document.getElementById('salonNoteBody');

  // Navigation Auth DOM references
  const navGuestGroup = document.getElementById('navGuestGroup');
  const navUserGroup = document.getElementById('navUserGroup');
  const navAdminGroup = document.getElementById('navAdminGroup');
  const btnNavLogin = document.getElementById('btnNavLogin');
  const btnNavSignup = document.getElementById('btnNavSignup');
  const btnNavMyBookings = document.getElementById('btnNavMyBookings');
  const navUserLabel = document.getElementById('navUserLabel');
  const btnNavLogout = document.getElementById('btnNavLogout');
  const btnNavAdminOpen = document.getElementById('btnNavAdminOpen');
  const navAdminBadge = document.getElementById('navAdminBadge');
  const btnNavAdminLogout = document.getElementById('btnNavAdminLogout');

  // Auth Modal DOM references
  const authModalOverlay = document.getElementById('authModalOverlay');
  const authModalClose = document.getElementById('authModalClose');
  const authModalTitle = document.getElementById('authModalTitle');
  const authModalSubtitle = document.getElementById('authModalSubtitle');
  const tabBtnLogin = document.getElementById('tabBtnLogin');
  const tabBtnSignup = document.getElementById('tabBtnSignup');
  const tabBtnAdmin = document.getElementById('tabBtnAdmin');
  const authAlert = document.getElementById('authAlert');
  const clientLoginForm = document.getElementById('clientLoginForm');
  const clientSignupForm = document.getElementById('clientSignupForm');
  const adminLoginForm = document.getElementById('adminLoginForm');
  const switchToSignupBtn = document.getElementById('switchToSignupBtn');
  const switchToLoginBtn = document.getElementById('switchToLoginBtn');

  // Client Bookings Portal DOM references
  const clientBookingsModalOverlay = document.getElementById('clientBookingsModalOverlay');
  const clientBookingsModalClose = document.getElementById('clientBookingsModalClose');
  const clientPortalUserName = document.getElementById('clientPortalUserName');
  const clientBookingsList = document.getElementById('clientBookingsList');
  const btnClientBookNewApt = document.getElementById('btnClientBookNewApt');

  // Admin Dashboard DOM references
  const adminLauncherBtn = document.getElementById('adminLauncherBtn');
  const adminLauncherBadge = document.getElementById('adminLauncherBadge');
  const adminModalOverlay = document.getElementById('adminModalOverlay');
  const adminModalClose = document.getElementById('adminModalClose');
  const btnAdminModalLogout = document.getElementById('btnAdminModalLogout');
  const btnAdminSoundToggle = document.getElementById('btnAdminSoundToggle');
  const adminToastContainer = document.getElementById('adminToastContainer');

  const kpiTotalRequests = document.getElementById('kpiTotalRequests');
  const kpiPendingRequests = document.getElementById('kpiPendingRequests');
  const kpiReviewRequests = document.getElementById('kpiReviewRequests');
  const kpiConfirmedRequests = document.getElementById('kpiConfirmedRequests');

  const adminTabs = document.querySelectorAll('.admin-tab');
  const countTabAll = document.getElementById('countTabAll');
  const countTabPending = document.getElementById('countTabPending');
  const countTabReview = document.getElementById('countTabReview');
  const countTabConfirmed = document.getElementById('countTabConfirmed');
  const countTabCancelled = document.getElementById('countTabCancelled');

  const adminSearchInput = document.getElementById('adminSearchInput');
  const btnAdminSeedSample = document.getElementById('btnAdminSeedSample');
  const btnAdminClearAll = document.getElementById('btnAdminClearAll');
  const adminAppointmentsList = document.getElementById('adminAppointmentsList');

  let currentAdminFilter = 'all';
  let isSoundMuted = localStorage.getItem(SOUND_STORAGE_KEY) === 'true';
  updateSoundIcon();

  // --------------------------------------------------------------------------
  // USER & AUTH STATE MANAGEMENT
  // --------------------------------------------------------------------------
  function getRegisteredUsers() {
    try {
      const data = localStorage.getItem(USERS_STORAGE_KEY);
      if (!data) {
        const initialUsers = [
          {
            id: 'USR-101',
            name: 'Sarah Jenkins',
            email: 'sarah@example.com',
            phone: '0771234567',
            password: 'password123',
            createdAt: new Date().toISOString()
          }
        ];
        localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(initialUsers));
        return initialUsers;
      }
      return JSON.parse(data) || [];
    } catch (e) {
      return [];
    }
  }

  function saveRegisteredUsers(users) {
    try {
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
    } catch (e) {}
  }

  function getCurrentUser() {
    try {
      const data = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  function setCurrentUser(user) {
    try {
      if (user) {
        localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
      }
      updateNavAuthState();
      autofillClientBookingForm();
    } catch (e) {}
  }

  function isAdminAuthenticated() {
    try {
      return sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  function setAdminAuthenticated(val) {
    try {
      if (val) {
        sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, 'true');
      } else {
        sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
      }
      updateNavAuthState();
    } catch (e) {}
  }

  function autofillClientBookingForm() {
    const user = getCurrentUser();
    if (user) {
      if (inputName && !inputName.value) inputName.value = user.name || '';
      if (inputPhone && !inputPhone.value) inputPhone.value = user.phone || '';
      if (inputEmail && !inputEmail.value) inputEmail.value = user.email || '';
    }
  }

  function updateNavAuthState() {
    const user = getCurrentUser();
    const isAdmin = isAdminAuthenticated();

    if (isAdmin) {
      if (navGuestGroup) navGuestGroup.style.display = 'none';
      if (navUserGroup) navUserGroup.style.display = 'none';
      if (navAdminGroup) navAdminGroup.style.display = 'flex';
      updateAdminBadges();
    } else if (user) {
      if (navGuestGroup) navGuestGroup.style.display = 'none';
      if (navAdminGroup) navAdminGroup.style.display = 'none';
      if (navUserGroup) navUserGroup.style.display = 'flex';
      if (navUserLabel) {
        const firstName = user.name ? user.name.split(' ')[0] : 'My';
        navUserLabel.textContent = `${firstName}'s Bookings`;
      }
    } else {
      if (navUserGroup) navUserGroup.style.display = 'none';
      if (navAdminGroup) navAdminGroup.style.display = 'none';
      if (navGuestGroup) navGuestGroup.style.display = 'flex';
    }
  }

  // --------------------------------------------------------------------------
  // AUTH MODAL LOGIC & TAB SWITCHING (WITH STRICT CREDENTIAL AUTO-CLEARING)
  // --------------------------------------------------------------------------
  function clearAuthForms() {
    if (adminLoginForm) adminLoginForm.reset();
    if (clientLoginForm) clientLoginForm.reset();
    if (clientSignupForm) clientSignupForm.reset();

    // Explicitly wipe input values to defeat browser field memory & caching
    const adminUserInp = document.getElementById('adminUsername');
    const adminPassInp = document.getElementById('adminPassword');
    if (adminUserInp) adminUserInp.value = '';
    if (adminPassInp) adminPassInp.value = '';

    const loginIdInp = document.getElementById('loginIdentifier');
    const loginPassInp = document.getElementById('loginPassword');
    if (loginIdInp) loginIdInp.value = '';
    if (loginPassInp) loginPassInp.value = '';

    const signNameInp = document.getElementById('signupName');
    const signPhoneInp = document.getElementById('signupPhone');
    const signEmailInp = document.getElementById('signupEmail');
    const signPassInp = document.getElementById('signupPassword');
    if (signNameInp) signNameInp.value = '';
    if (signPhoneInp) signPhoneInp.value = '';
    if (signEmailInp) signEmailInp.value = '';
    if (signPassInp) signPassInp.value = '';
  }

  function showAuthAlert(msg, type = 'error') {
    if (!authAlert) return;
    authAlert.textContent = msg;
    authAlert.className = `auth-alert alert-${type}`;
    authAlert.style.display = 'block';
  }

  function clearAuthAlert() {
    if (!authAlert) return;
    authAlert.textContent = '';
    authAlert.style.display = 'none';
  }

  function switchAuthTab(tabName) {
    clearAuthAlert();
    clearAuthForms(); // Auto-clear inputs whenever switching between user/admin tabs

    const tabs = [tabBtnLogin, tabBtnSignup, tabBtnAdmin];
    tabs.forEach(t => {
      if (t) t.classList.remove('active');
    });

    if (clientLoginForm) clientLoginForm.style.display = 'none';
    if (clientSignupForm) clientSignupForm.style.display = 'none';
    if (adminLoginForm) adminLoginForm.style.display = 'none';

    if (tabName === 'signup') {
      if (tabBtnSignup) tabBtnSignup.classList.add('active');
      if (clientSignupForm) clientSignupForm.style.display = 'block';
      if (authModalTitle) authModalTitle.textContent = 'Create Client Account';
      if (authModalSubtitle) authModalSubtitle.textContent = 'Register to enjoy instant reservations & exclusive styling perks';
    } else if (tabName === 'admin') {
      if (tabBtnAdmin) tabBtnAdmin.classList.add('active');
      if (adminLoginForm) adminLoginForm.style.display = 'block';
      if (authModalTitle) authModalTitle.textContent = 'Salon Staff Authentication';
      if (authModalSubtitle) authModalSubtitle.textContent = 'Restricted dispatch portal for authorized salon team members only';
    } else {
      // Default: login
      if (tabBtnLogin) tabBtnLogin.classList.add('active');
      if (clientLoginForm) clientLoginForm.style.display = 'block';
      if (authModalTitle) authModalTitle.textContent = 'Welcome Back';
      if (authModalSubtitle) authModalSubtitle.textContent = 'Sign in to access your personal booking history & schedule appointments';
    }
  }

  function openAuthModal(tab = 'login') {
    if (!authModalOverlay) return;
    clearAuthForms(); // Guarantee fresh, blank inputs upon opening
    switchAuthTab(tab);
    authModalOverlay.classList.add('show');
    authModalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeAuthModal() {
    if (!authModalOverlay) return;
    clearAuthForms(); // Wipe all input fields immediately when modal is closed
    clearAuthAlert();
    authModalOverlay.classList.remove('show');
    authModalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (btnNavLogin) btnNavLogin.addEventListener('click', () => openAuthModal('login'));
  if (btnNavSignup) btnNavSignup.addEventListener('click', () => openAuthModal('signup'));
  if (switchToSignupBtn) switchToSignupBtn.addEventListener('click', () => switchAuthTab('signup'));
  if (switchToLoginBtn) switchToLoginBtn.addEventListener('click', () => switchAuthTab('login'));
  if (tabBtnLogin) tabBtnLogin.addEventListener('click', () => switchAuthTab('login'));
  if (tabBtnSignup) tabBtnSignup.addEventListener('click', () => switchAuthTab('signup'));
  if (tabBtnAdmin) tabBtnAdmin.addEventListener('click', () => switchAuthTab('admin'));
  if (authModalClose) authModalClose.addEventListener('click', closeAuthModal);

  if (authModalOverlay) {
    authModalOverlay.addEventListener('click', (e) => {
      if (e.target === authModalOverlay) closeAuthModal();
    });
  }

  // Client Login Form Submit
  if (clientLoginForm) {
    clientLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('loginIdentifier');
      const passInput = document.getElementById('loginPassword');
      const name = nameInput ? nameInput.value.trim() : '';
      const password = passInput ? passInput.value.trim() : '';

      if (!name || !password) {
        showAuthAlert('Please enter your name and password.');
        return;
      }

      const users = getRegisteredUsers();
      // Case-insensitive name match and exact password verification (with fallback to email/phone for older accounts)
      const user = users.find(u => 
        (((u.name && u.name.toLowerCase() === name.toLowerCase()) ||
          (u.email && u.email.toLowerCase() === name.toLowerCase()) ||
          (u.phone && u.phone === name))) && 
        u.password === password
      );

      if (user) {
        setCurrentUser(user);
        clearAuthForms();
        closeAuthModal();
        showAdminToast('Signed In ✓', `Welcome back, <strong>${escapeHtml(user.name)}</strong>!`);
        openClientBookingsModal();
      } else {
        if (passInput) passInput.value = '';
        showAuthAlert('Invalid name or password. If you are new, click "Create Account".');
      }
    });
  }

  // Client Sign Up Form Submit (Strictly Name & Password)
  if (clientSignupForm) {
    clientSignupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('signupName');
      const passInput = document.getElementById('signupPassword');
      const name = nameInput ? nameInput.value.trim() : '';
      const password = passInput ? passInput.value.trim() : '';

      if (!name || !password) {
        showAuthAlert('Please enter both your name and password.');
        return;
      }

      if (name.length < 2) {
        showAuthAlert('Please enter a valid name (at least 2 characters).');
        return;
      }

      if (password.length < 4) {
        showAuthAlert('Password must be at least 4 characters long.');
        return;
      }

      const users = getRegisteredUsers();
      if (users.some(u => u.name && u.name.toLowerCase() === name.toLowerCase())) {
        showAuthAlert('An account with this name already exists. Please log in.');
        return;
      }

      const newUser = {
        id: 'USR-' + Math.floor(1000 + Math.random() * 9000),
        name,
        password,
        createdAt: new Date().toISOString()
      };

      users.push(newUser);
      saveRegisteredUsers(users);
      setCurrentUser(newUser);
      clearAuthForms();
      closeAuthModal();
      showAdminToast('Account Created ✓', `Welcome to Salon Hair Bride, <strong>${escapeHtml(newUser.name)}</strong>!`);
      openClientBookingsModal();
    });
  }

  // Admin Login Form Submit
  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const userInp = document.getElementById('adminUsername');
      const passInp = document.getElementById('adminPassword');
      const username = userInp ? userInp.value.trim() : '';
      const password = passInp ? passInp.value.trim() : '';

      if (username === 'admin' && (password === 'admin123' || password === '1234')) {
        setAdminAuthenticated(true);
        clearAuthForms(); // Auto-clear inputs immediately upon successful verification
        closeAuthModal();
        showAdminToast('Admin Authenticated ✓', 'Salon Live Dispatch Dashboard unlocked.');
        openAdminModal();
      } else {
        // Clear password on failed attempt for security
        if (passInp) {
          passInp.value = '';
          passInp.focus();
        }
        showAuthAlert('Access Denied: Invalid Admin Credentials.');
      }
    });
  }

  // Logout Handlers
  if (btnNavLogout) {
    btnNavLogout.addEventListener('click', () => {
      setCurrentUser(null);
      clearAuthForms();
      showAdminToast('Signed Out', 'You have been logged out.');
    });
  }

  function handleAdminLogout() {
    setAdminAuthenticated(false);
    clearAuthForms(); // Auto-clear admin credentials upon locking/logging out
    closeAdminModal();
    showAdminToast('Admin Locked', 'Admin session has been locked and signed out.');
  }

  if (btnNavAdminLogout) btnNavAdminLogout.addEventListener('click', handleAdminLogout);
  if (btnAdminModalLogout) btnAdminModalLogout.addEventListener('click', handleAdminLogout);

  // --------------------------------------------------------------------------
  // CLIENT PORTAL: MY BOOKINGS HISTORY (PRIVACY RESTRICTED)
  // --------------------------------------------------------------------------
  function openClientBookingsModal() {
    const user = getCurrentUser();
    if (!user) {
      openAuthModal('login');
      return;
    }

    if (!clientBookingsModalOverlay) return;
    if (clientPortalUserName) clientPortalUserName.textContent = user.name;

    renderClientBookings(user);
    clientBookingsModalOverlay.classList.add('show');
    clientBookingsModalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeClientBookingsModal() {
    if (!clientBookingsModalOverlay) return;
    clientBookingsModalOverlay.classList.remove('show');
    clientBookingsModalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function renderClientBookings(user) {
    if (!clientBookingsList) return;
    const allAppointments = getStoredAppointments();

    // STRICT PRIVACY: Filter ONLY appointments belonging to the logged-in client
    const userAppointments = allAppointments.filter(apt => 
      (apt.userId && apt.userId === user.id) ||
      (user.name && apt.name && apt.name.toLowerCase() === user.name.toLowerCase()) ||
      (user.email && apt.email && apt.email.toLowerCase() === user.email.toLowerCase()) ||
      (user.phone && apt.phone && apt.phone === user.phone)
    );

    if (userAppointments.length === 0) {
      clientBookingsList.innerHTML = `
        <div class="admin-empty-state" style="padding: 2.5rem 1rem;">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <h4 class="empty-state-title">No Reservations Found</h4>
          <p>You haven't booked any salon appointments yet. Click below to schedule your personalized session!</p>
          <button type="button" class="btn btn-primary btn-sm" id="btnEmptyBookApt" style="margin-top: 1rem;">Book an Appointment</button>
        </div>
      `;

      const btnEmptyBook = document.getElementById('btnEmptyBookApt');
      if (btnEmptyBook) {
        btnEmptyBook.addEventListener('click', () => {
          closeClientBookingsModal();
          const aptSection = document.getElementById('appointment');
          if (aptSection) aptSection.scrollIntoView({ behavior: 'smooth' });
        });
      }
      return;
    }

    clientBookingsList.innerHTML = userAppointments.map(apt => {
      const isPending = apt.status === 'pending';
      const isReview = apt.status === 'review';
      const isConfirmed = apt.status === 'confirmed';
      const isCancelled = apt.status === 'cancelled';

      let statusBadge = '';
      let statusTimelineHtml = '';
      let cardStatusClass = 'status-pending';

      if (isPending) {
        cardStatusClass = 'status-pending';
        statusBadge = '<span class="badge-status badge-pending"><span class="pulse-dot"></span> Pending</span>';
        statusTimelineHtml = `
          <div class="client-status-timeline timeline-pending">
            <span class="timeline-dot"></span>
            <span><strong>Pending:</strong> Awaiting salon review. Our team will review your requested slot shortly.</span>
          </div>
        `;
      } else if (isReview) {
        cardStatusClass = 'status-review';
        statusBadge = '<span class="badge-status badge-review"><span class="pulse-dot"></span> Seen / Under Review</span>';
        statusTimelineHtml = `
          <div class="client-status-timeline timeline-review">
            <span class="timeline-dot"></span>
            <span><strong>Seen / Under Review:</strong> Stylist has viewed your booking request and is reviewing schedule availability.</span>
          </div>
        `;
      } else if (isConfirmed) {
        cardStatusClass = 'status-confirmed';
        statusBadge = '<span class="badge-status badge-confirmed">✓ Approved / Confirmed</span>';
        statusTimelineHtml = `
          <div class="client-status-timeline timeline-confirmed">
            <span class="timeline-dot"></span>
            <span><strong>Approved / Confirmed:</strong> Your appointment is officially confirmed! Please arrive 5 minutes prior to your slot.</span>
          </div>
        `;
      } else {
        cardStatusClass = 'status-cancelled';
        statusBadge = '<span class="badge-status badge-cancelled">✕ Rejected / Cancelled</span>';
        statusTimelineHtml = `
          <div class="client-status-timeline timeline-cancelled">
            <span class="timeline-dot"></span>
            <span><strong>Rejected / Cancelled:</strong> This appointment slot is unavailable. Please review the salon update or book another slot.</span>
          </div>
        `;
      }

      const createdFormatted = new Date(apt.createdAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <div class="client-booking-card ${cardStatusClass}">
          <div class="client-booking-header">
            <span class="client-booking-id">#${apt.id} • Booked on ${createdFormatted}</span>
            <div>${statusBadge}</div>
          </div>
          <div class="client-booking-grid">
            <div class="client-booking-field">
              <span class="client-field-label">Service</span>
              <span class="client-field-val">${escapeHtml(apt.service)}</span>
            </div>
            <div class="client-booking-field">
              <span class="client-field-label">Date &amp; Time</span>
              <span class="client-field-val">${escapeHtml(apt.date)} • ${escapeHtml(apt.time)}</span>
            </div>
            <div class="client-booking-field">
              <span class="client-field-label">Contact Phone</span>
              <span class="client-field-val">${escapeHtml(apt.phone)}</span>
            </div>
          </div>
          ${apt.message && apt.message !== 'None' ? `
            <div style="font-size:0.8125rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">
              <strong>Special Request:</strong> "${escapeHtml(apt.message)}"
            </div>
          ` : ''}
          ${apt.adminNote ? `
            <div class="client-booking-note">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <div><strong>Salon Update:</strong> ${escapeHtml(apt.adminNote)}</div>
            </div>
          ` : ''}
          ${statusTimelineHtml}
        </div>
      `;
    }).join('');
  }

  if (btnNavMyBookings) btnNavMyBookings.addEventListener('click', openClientBookingsModal);
  if (clientBookingsModalClose) clientBookingsModalClose.addEventListener('click', closeClientBookingsModal);

  if (clientBookingsModalOverlay) {
    clientBookingsModalOverlay.addEventListener('click', (e) => {
      if (e.target === clientBookingsModalOverlay) closeClientBookingsModal();
    });
  }

  if (btnClientBookNewApt) {
    btnClientBookNewApt.addEventListener('click', () => {
      closeClientBookingsModal();
      const aptSection = document.getElementById('appointment');
      if (aptSection) aptSection.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // --------------------------------------------------------------------------
  // MASTER APPOINTMENTS STORAGE & DISPATCH
  // --------------------------------------------------------------------------
  function getStoredAppointments() {
    try {
      const data = localStorage.getItem(APPOINTMENTS_STORAGE_KEY);
      if (!data) {
        const initialSeed = [
          {
            id: 'APT-98241',
            name: 'Amara Perera',
            phone: '0771234567',
            email: 'amara.perera@example.com',
            service: 'Bridal Styling',
            date: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
            time: '09:00 AM - 09:45 AM',
            message: 'Bridal hair trial and veil setting discussion.',
            status: 'pending',
            adminNote: '',
            createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
            updatedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString()
          },
          {
            id: 'APT-84192',
            name: 'David Fernando',
            phone: '0719876543',
            email: 'david.fernando@example.com',
            service: 'Hair Cut',
            date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            time: '01:30 PM - 02:15 PM',
            message: 'Faded sides and light scissor cut on top.',
            status: 'confirmed',
            adminNote: 'Confirmed! Master stylist Ryan assigned. Please arrive 5 minutes before your slot.',
            createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
            updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString()
          },
          {
            id: 'APT-72314',
            userId: 'USR-101',
            name: 'Sarah Jenkins',
            phone: '0771234567',
            email: 'sarah@example.com',
            service: 'Hair Coloring',
            date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
            time: '11:15 AM - 12:00 PM',
            message: 'Balayage touch up and toner consultation.',
            status: 'review',
            adminNote: 'Seen by Salon Manager. Stylist Priya is currently reviewing schedule availability.',
            createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
            updatedAt: new Date(Date.now() - 1000 * 60 * 10).toISOString()
          }
        ];
        localStorage.setItem(APPOINTMENTS_STORAGE_KEY, JSON.stringify(initialSeed));
        return initialSeed;
      }
      return JSON.parse(data) || [];
    } catch (err) {
      console.warn('Error reading localStorage:', err);
      return [];
    }
  }

  function saveAppointments(list, notifyChange = true) {
    try {
      localStorage.setItem(APPOINTMENTS_STORAGE_KEY, JSON.stringify(list));
      if (notifyChange) {
        window.dispatchEvent(new CustomEvent('salon:appointments_changed'));
      }
    } catch (err) {
      console.warn('Error saving to localStorage:', err);
    }
  }

  // Play luxury chime alert
  function playAdminChime() {
    if (isSoundMuted) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const playTone = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.2, startTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      const now = ctx.currentTime;
      playTone(587.33, now, 0.45);        // D5
      playTone(880.00, now + 0.12, 0.65); // A5
    } catch (e) {}
  }

  function updateSoundIcon() {
    if (!btnAdminSoundToggle) return;
    const onIcon = btnAdminSoundToggle.querySelector('.icon-sound-on');
    const offIcon = btnAdminSoundToggle.querySelector('.icon-sound-off');
    if (isSoundMuted) {
      if (onIcon) onIcon.style.display = 'none';
      if (offIcon) offIcon.style.display = 'block';
      btnAdminSoundToggle.setAttribute('title', 'Sound Muted (Click to Unmute)');
    } else {
      if (onIcon) onIcon.style.display = 'block';
      if (offIcon) offIcon.style.display = 'none';
      btnAdminSoundToggle.setAttribute('title', 'Sound Active (Click to Mute)');
    }
  }

  if (btnAdminSoundToggle) {
    btnAdminSoundToggle.addEventListener('click', () => {
      isSoundMuted = !isSoundMuted;
      localStorage.setItem(SOUND_STORAGE_KEY, isSoundMuted ? 'true' : 'false');
      updateSoundIcon();
      if (!isSoundMuted) playAdminChime();
    });
  }

  // Floating toast message
  function showAdminToast(title, message) {
    if (!adminToastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'admin-toast';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <div class="toast-icon-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      </div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <p class="toast-msg">${message}</p>
        <div class="toast-time">Just now</div>
      </div>
      <button class="toast-close-btn" aria-label="Close Notification">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close-btn');
    const removeToast = () => {
      toast.classList.add('hiding');
      setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 300);
    };

    closeBtn.addEventListener('click', removeToast);
    adminToastContainer.appendChild(toast);
    setTimeout(removeToast, 6500);
  }

  // Create appointment on Customer Form submit
  function createNewAppointment(data) {
    const list = getStoredAppointments();
    const newApt = {
      id: 'APT-' + Math.floor(10000 + Math.random() * 90000),
      userId: data.userId || null,
      name: data.name,
      phone: data.phone,
      email: data.email || 'customer@example.com',
      service: data.service,
      date: data.date,
      time: data.time,
      message: data.message,
      status: 'pending',
      adminNote: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    list.unshift(newApt);
    saveAppointments(list, true);

    try {
      sessionStorage.setItem(ACTIVE_BOOKING_KEY, newApt.id);
    } catch (e) {}

    // Audio & Toast Notification for Admin
    playAdminChime();
    showAdminToast(
      'New Appointment Request!',
      `<strong>${newApt.name}</strong> requested <em>${newApt.service}</em> (${newApt.time}).`
    );

    // Wiggle bell animation on launcher
    const bellIcon = document.querySelector('.admin-bell-icon');
    if (bellIcon) {
      bellIcon.classList.remove('wiggle');
      void bellIcon.offsetWidth;
      bellIcon.classList.add('wiggle');
    }

    updateAdminBadges();
    if (isAdminAuthenticated()) {
      renderAdminDashboard();
    }
    return newApt;
  }

  // Update customer confirmation card on screen
  function renderCustomerConfirmation(apt) {
    if (!apt) return;
    if (summaryBookingId) summaryBookingId.textContent = '#' + apt.id;
    if (summaryCreatedAt) {
      const d = new Date(apt.createdAt);
      summaryCreatedAt.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (feedbackClientName) feedbackClientName.textContent = apt.name;
    if (summaryService) summaryService.textContent = apt.service;
    if (summaryDateTime) summaryDateTime.textContent = `${apt.date} • ${apt.time}`;
    if (summaryPhone) summaryPhone.textContent = apt.phone;
    const summaryEmail = document.getElementById('summaryEmail');
    if (summaryEmail) summaryEmail.textContent = apt.email || 'customer@example.com';
    if (summaryRequests) summaryRequests.textContent = apt.message || 'None';

    if (apt.status === 'confirmed') {
      if (formSuccessMessage) formSuccessMessage.classList.add('is-confirmed');
      if (feedbackStatusBadge) {
        feedbackStatusBadge.className = 'feedback-status-pill status-confirmed';
      }
      if (feedbackStatusText) feedbackStatusText.textContent = 'Confirmed by Salon';
      if (feedbackTitle) feedbackTitle.textContent = 'Your appointment has been Confirmed!';
      if (feedbackDetails) {
        feedbackDetails.innerHTML = `Great news, <span>${apt.name}</span>! Your booking has been confirmed by our salon team.`;
      }
      if (salonNoteContainer) salonNoteContainer.classList.add('has-note');
      if (salonNoteBody) {
        salonNoteBody.textContent = apt.adminNote || 'Confirmed! We look forward to welcoming you at Salon Hair Bride.';
      }
    } else if (apt.status === 'review') {
      if (formSuccessMessage) formSuccessMessage.classList.remove('is-confirmed');
      if (feedbackStatusBadge) {
        feedbackStatusBadge.className = 'feedback-status-pill status-review';
        feedbackStatusBadge.removeAttribute('style');
      }
      if (feedbackStatusText) feedbackStatusText.textContent = 'Seen / Under Review';
      if (feedbackTitle) feedbackTitle.textContent = 'Your appointment is Under Review!';
      if (feedbackDetails) {
        feedbackDetails.innerHTML = `Great news, <span>${apt.name}</span>! Our salon team has seen your request and is currently assigning stylist & schedule.`;
      }
      if (salonNoteContainer) salonNoteContainer.classList.add('has-note');
      if (salonNoteBody) {
        salonNoteBody.textContent = apt.adminNote || 'Stylist is reviewing your requested slot. You will receive final confirmation shortly.';
      }
    } else if (apt.status === 'cancelled') {
      if (formSuccessMessage) formSuccessMessage.classList.remove('is-confirmed');
      if (feedbackStatusBadge) {
        feedbackStatusBadge.className = 'feedback-status-pill status-cancelled';
        feedbackStatusBadge.removeAttribute('style');
      }
      if (feedbackStatusText) feedbackStatusText.textContent = 'Slot Unavailable / Cancelled';
      if (feedbackTitle) feedbackTitle.textContent = 'Appointment Slot Unavailable';
      if (feedbackDetails) {
        feedbackDetails.innerHTML = `Dear <span>${apt.name}</span>, this slot could not be accommodated. Please see the salon note below.`;
      }
      if (salonNoteContainer) salonNoteContainer.classList.add('has-note');
      if (salonNoteBody) {
        salonNoteBody.textContent = apt.adminNote || 'Slot unavailable. Please contact us or book another convenient slot.';
      }
    } else {
      // Pending
      if (formSuccessMessage) formSuccessMessage.classList.remove('is-confirmed');
      if (feedbackStatusBadge) {
        feedbackStatusBadge.className = 'feedback-status-pill status-pending';
        feedbackStatusBadge.removeAttribute('style');
      }
      if (feedbackStatusText) feedbackStatusText.textContent = 'Awaiting Salon Confirmation';
      if (feedbackTitle) feedbackTitle.textContent = 'Your booking request has been sent!';
      if (feedbackDetails) {
        feedbackDetails.innerHTML = `Thank you, <span>${apt.name}</span>. We have captured your request and our salon team is reviewing it in real time.`;
      }
      if (apt.adminNote) {
        if (salonNoteContainer) salonNoteContainer.classList.add('has-note');
        if (salonNoteBody) salonNoteBody.textContent = apt.adminNote;
      } else {
        if (salonNoteContainer) salonNoteContainer.classList.remove('has-note');
        if (salonNoteBody) salonNoteBody.textContent = 'Awaiting salon staff confirmation...';
      }
    }
  }

  // Check and sync active customer appointment
  function syncActiveCustomerBooking() {
    try {
      const activeId = sessionStorage.getItem(ACTIVE_BOOKING_KEY);
      if (!activeId) return;
      const list = getStoredAppointments();
      const match = list.find(item => item.id === activeId);
      if (match && formSuccessMessage && formSuccessMessage.classList.contains('show')) {
        renderCustomerConfirmation(match);
      }
    } catch (e) {}
  }

  // Update notification counters in badges
  function updateAdminBadges() {
    const list = getStoredAppointments();
    const pendingCount = list.filter(item => item.status === 'pending').length;

    if (adminLauncherBadge) {
      if (pendingCount > 0) {
        adminLauncherBadge.textContent = pendingCount;
        adminLauncherBadge.classList.add('show');
      } else {
        adminLauncherBadge.textContent = '0';
        adminLauncherBadge.classList.remove('show');
      }
    }

    if (navAdminBadge) {
      if (pendingCount > 0) {
        navAdminBadge.textContent = pendingCount;
        navAdminBadge.style.display = 'inline-block';
      } else {
        navAdminBadge.textContent = '0';
        navAdminBadge.style.display = 'none';
      }
    }
  }

  // Render Admin Dashboard modal contents (STRICTLY FOR AUTHENTICATED ADMIN)
  function renderAdminDashboard() {
    if (!isAdminAuthenticated()) return;

    const list = getStoredAppointments();

    const totalCount = list.length;
    const pendingCount = list.filter(i => i.status === 'pending').length;
    const reviewCount = list.filter(i => i.status === 'review').length;
    const confirmedCount = list.filter(i => i.status === 'confirmed').length;
    const cancelledCount = list.filter(i => i.status === 'cancelled').length;

    if (kpiTotalRequests) kpiTotalRequests.textContent = totalCount;
    if (kpiPendingRequests) kpiPendingRequests.textContent = pendingCount;
    if (kpiReviewRequests) kpiReviewRequests.textContent = reviewCount;
    if (kpiConfirmedRequests) kpiConfirmedRequests.textContent = confirmedCount;

    if (countTabAll) countTabAll.textContent = totalCount;
    if (countTabPending) countTabPending.textContent = pendingCount;
    if (countTabReview) countTabReview.textContent = reviewCount;
    if (countTabConfirmed) countTabConfirmed.textContent = confirmedCount;
    if (countTabCancelled) countTabCancelled.textContent = cancelledCount;

    const searchTerm = adminSearchInput ? adminSearchInput.value.trim().toLowerCase() : '';

    let filtered = list;
    if (currentAdminFilter !== 'all') {
      filtered = filtered.filter(item => item.status === currentAdminFilter);
    }
    if (searchTerm) {
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(searchTerm) ||
        item.phone.includes(searchTerm) ||
        item.service.toLowerCase().includes(searchTerm) ||
        item.id.toLowerCase().includes(searchTerm)
      );
    }

    if (!adminAppointmentsList) return;

    if (filtered.length === 0) {
      adminAppointmentsList.innerHTML = `
        <div class="admin-empty-state">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <h4 class="empty-state-title">No appointments found</h4>
          <p>No appointment requests match the selected criteria.</p>
        </div>
      `;
      return;
    }

    adminAppointmentsList.innerHTML = filtered.map(apt => {
      const isPending = apt.status === 'pending';
      const isReview = apt.status === 'review';
      const isConfirmed = apt.status === 'confirmed';
      const isCancelled = apt.status === 'cancelled';

      const statusBadge = isPending
        ? '<span class="badge-status badge-pending"><span class="pulse-dot"></span> Pending</span>'
        : isReview
        ? '<span class="badge-status badge-review"><span class="pulse-dot"></span> Seen / Review</span>'
        : isConfirmed
        ? '<span class="badge-status badge-confirmed">✓ Confirmed</span>'
        : '<span class="badge-status badge-cancelled">Cancelled</span>';

      const createdFormatted = new Date(apt.createdAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <div class="admin-booking-card card-${apt.status}" data-id="${apt.id}">
          <div class="booking-card-top">
            <div class="booking-card-meta">
              <span class="booking-card-id">#${apt.id}</span>
              <span class="booking-card-timestamp">${createdFormatted}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <div class="admin-status-select-wrap">
                <span class="admin-status-select-label">Status:</span>
                <select class="admin-status-select" data-id="${apt.id}" aria-label="Change status for booking #${apt.id}">
                  <option value="pending" ${isPending ? 'selected' : ''}>⏳ Pending</option>
                  <option value="review" ${isReview ? 'selected' : ''}>👀 Seen / Review</option>
                  <option value="confirmed" ${isConfirmed ? 'selected' : ''}>✓ Approved</option>
                  <option value="cancelled" ${isCancelled ? 'selected' : ''}>✕ Rejected</option>
                </select>
              </div>
              <div>${statusBadge}</div>
            </div>
          </div>

          <div class="booking-card-body">
            <div class="booking-field-group">
              <span class="booking-field-label">Customer Contact</span>
              <span class="booking-client-name">${escapeHtml(apt.name)}</span>
              <a href="tel:${escapeHtml(apt.phone)}" class="booking-phone-link">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span>${escapeHtml(apt.phone)}</span>
              </a>
              ${apt.email ? `<a href="mailto:${escapeHtml(apt.email)}" class="booking-phone-link" style="margin-top:4px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span>${escapeHtml(apt.email)}</span>
              </a>` : ''}
            </div>

            <div class="booking-field-group">
              <span class="booking-field-label">Scheduled Service</span>
              <span class="booking-service-badge">${escapeHtml(apt.service)}</span>
              <span class="booking-datetime">${escapeHtml(apt.date)} • ${escapeHtml(apt.time)}</span>
            </div>

            <div class="booking-field-group">
              <span class="booking-field-label">Customer Special Request</span>
              <span class="booking-requests-text">${escapeHtml(apt.message || 'None')}</span>
            </div>
          </div>

          <!-- Admin Custom Message/Note Input Section -->
          <div class="booking-admin-note-section">
            <div class="admin-note-label-row">
              <span>Salon Confirmation Note &amp; Special Instructions:</span>
            </div>
            ${apt.adminNote ? `<p class="admin-current-note-display">"${escapeHtml(apt.adminNote)}"</p>` : ''}
            
            <div class="quick-presets-row">
              <button type="button" class="preset-chip" data-note="Seen by Salon Manager. Stylist is reviewing schedule.">"Under Review"</button>
              <button type="button" class="preset-chip" data-note="Confirmed! Please arrive 10 minutes early.">"10 mins early"</button>
              <button type="button" class="preset-chip" data-note="Confirmed! Looking forward to seeing you.">"Looking forward"</button>
              <button type="button" class="preset-chip" data-note="Slot unavailable, please pick another date/time.">"Slot unavailable"</button>
            </div>

            <div class="note-input-action-row">
              <input type="text" class="admin-note-input" placeholder="Type custom message or instructions for customer..." value="${escapeHtml(apt.adminNote || '')}">
              <button type="button" class="btn-admin-note-save" data-action="save-note" title="Send custom note to customer">
                Send Note
              </button>
            </div>
          </div>

          <!-- Card Actions Row -->
          <div class="booking-card-actions">
            <div class="card-actions-left">
              ${isPending ? `
                <button type="button" class="btn-admin-review" data-action="review" title="Mark as Seen and Under Review">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <span>Mark as Seen</span>
                </button>
              ` : ''}

              ${!isConfirmed ? `
                <button type="button" class="btn-admin-confirm" data-action="confirm" title="Approve &amp; Confirm Appointment">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>Approve</span>
                </button>
              ` : `
                <button type="button" class="btn-admin-action" data-action="re-pending" title="Mark back to pending">
                  <span>Revert to Pending</span>
                </button>
              `}

              ${!isCancelled ? `
                <button type="button" class="btn-admin-decline" data-action="cancel" title="Decline / Reject this slot">
                  ✕ Reject / Cancel
                </button>
              ` : `
                <button type="button" class="btn-admin-action" data-action="re-pending" title="Reopen booking request">
                  <span>Reopen Request</span>
                </button>
              `}
            </div>
            <div class="card-actions-right">
              <button type="button" class="btn-admin-action btn-danger-ghost" data-action="delete" title="Delete record">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach card event listeners
    adminAppointmentsList.querySelectorAll('.admin-booking-card').forEach(card => {
      const aptId = card.getAttribute('data-id');
      const noteInput = card.querySelector('.admin-note-input');

      // Status dropdown direct change
      const statusSelect = card.querySelector('.admin-status-select');
      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          const newSt = e.target.value;
          let note = (noteInput && noteInput.value.trim()) ? noteInput.value.trim() : undefined;
          if (!note) {
            if (newSt === 'review') note = 'Seen by Salon Manager. Stylist is reviewing schedule.';
            else if (newSt === 'confirmed') note = 'Confirmed! Looking forward to seeing you at Salon Hair Bride.';
            else if (newSt === 'cancelled') note = 'Slot unavailable. Please pick another date or time slot.';
          }
          updateAppointmentStatus(aptId, newSt, note);
          showAdminToast('Status Updated', `Booking #${aptId} status changed to ${newSt.toUpperCase()}.`);
        });
      }

      // Preset chips click
      card.querySelectorAll('.preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          if (noteInput) {
            noteInput.value = chip.getAttribute('data-note');
            noteInput.focus();
          }
        });
      });

      // Mark as Seen / Review button
      const reviewBtn = card.querySelector('[data-action="review"]');
      if (reviewBtn) {
        reviewBtn.addEventListener('click', () => {
          const customNote = (noteInput && noteInput.value.trim())
            ? noteInput.value.trim()
            : 'Seen by Salon Manager. Stylist is reviewing schedule.';
          updateAppointmentStatus(aptId, 'review', customNote);
          showAdminToast('Marked as Seen ✓', `Booking #${aptId} is now Under Review.`);
        });
      }

      // Confirm button
      const confirmBtn = card.querySelector('[data-action="confirm"]');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
          const customNote = (noteInput && noteInput.value.trim()) 
            ? noteInput.value.trim() 
            : 'Confirmed! Looking forward to seeing you at Salon Hair Bride.';
          updateAppointmentStatus(aptId, 'confirmed', customNote);
          showAdminToast('Appointment Confirmed!', `Booking #${aptId} status is now Confirmed.`);
        });
      }

      // Revert button
      const revertBtn = card.querySelector('[data-action="re-pending"]');
      if (revertBtn) {
        revertBtn.addEventListener('click', () => {
          updateAppointmentStatus(aptId, 'pending', '');
          showAdminToast('Status Updated', `Booking #${aptId} reverted to Pending.`);
        });
      }

      // Save note button
      const saveNoteBtn = card.querySelector('[data-action="save-note"]');
      if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', () => {
          const noteVal = noteInput ? noteInput.value.trim() : '';
          updateAppointmentNote(aptId, noteVal);
          showAdminToast('Custom Note Sent!', `Customer will see this note in real time.`);
        });
      }

      // Cancel button
      const cancelBtn = card.querySelector('[data-action="cancel"]');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          const customNote = (noteInput && noteInput.value.trim())
            ? noteInput.value.trim()
            : 'Slot unavailable. Please pick another date or time slot.';
          updateAppointmentStatus(aptId, 'cancelled', customNote);
          showAdminToast('Appointment Cancelled', `Booking #${aptId} marked as unavailable.`);
        });
      }

      // Delete button
      const deleteBtn = card.querySelector('[data-action="delete"]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          if (confirm('Are you sure you want to delete appointment #' + aptId + '?')) {
            deleteAppointment(aptId);
            showAdminToast('Appointment Deleted', `Record #${aptId} removed.`);
          }
        });
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // -----------------------------------------------------------------------
  // EmailJS – Send Confirmation / Status Update Email to Customer
  // -----------------------------------------------------------------------
  function sendConfirmationEmail(apt) {
    if (typeof emailjs === 'undefined') {
      console.warn('EmailJS is not loaded. Skipping email send.');
      return;
    }
    if (!apt || !apt.email) {
      console.warn('No recipient email on appointment. Skipping email send.');
      return;
    }

    let readableStatus = 'Updated';
    if (apt.status === 'review') readableStatus = 'Seen / Under Review';
    else if (apt.status === 'confirmed') readableStatus = 'Approved / Confirmed';
    else if (apt.status === 'cancelled') readableStatus = 'Rejected / Cancelled';
    else if (apt.status === 'pending') readableStatus = 'Pending Salon Review';
    else readableStatus = apt.status ? (apt.status.charAt(0).toUpperCase() + apt.status.slice(1)) : 'Updated';

    const templateParams = {
      customer_name : apt.name    || 'Valued Customer',
      booking_date  : apt.date    || 'N/A',
      time_slot     : apt.time    || 'N/A',
      status        : readableStatus,
      admin_note    : apt.adminNote || 'No additional notes.',
      email         : apt.email
    };

    emailjs.send('service_835kk9j', 'template_zm5jy8q', templateParams)
      .then(() => {
        console.log(`[EmailJS] Confirmation email sent to ${apt.email} (Booking #${apt.id}, Status: ${apt.status})`);
        showAdminToast('Email Sent ✓', `Confirmation email delivered to <strong>${apt.email}</strong>.`);
      })
      .catch((err) => {
        console.error('[EmailJS] Failed to send email:', err);
        showAdminToast('Email Error', 'Could not send confirmation email. Check console for details.');
      });
  }

  async function updateAppointmentStatus(id, newStatus, note) {
    const list = getStoredAppointments();
    const apt = list.find(item => item.id === id);
    if (apt) {
      apt.status = newStatus;
      if (note !== undefined && note !== null) {
        apt.adminNote = note;
      }
      apt.updatedAt = new Date().toISOString();
      saveAppointments(list, true);
      updateAdminBadges();
      if (isAdminAuthenticated()) {
        renderAdminDashboard();
      }
      syncActiveCustomerBooking();
      updateAvailableSlots();

      // Async backend sync if available
      try {
        const token = sessionStorage.getItem('salon_admin_token') || localStorage.getItem('salon_auth_token');
        await fetch(`${API_BASE_URL}/appointments/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ status: newStatus, adminNote: apt.adminNote })
        });
      } catch (e) {
        // Fallback gracefully to client state
      }

      // Trigger EmailJS confirmation / status-update email to customer
      sendConfirmationEmail(apt);
    }
  }

  async function updateAppointmentNote(id, note) {
    const list = getStoredAppointments();
    const apt = list.find(item => item.id === id);
    if (apt) {
      apt.adminNote = note;
      apt.updatedAt = new Date().toISOString();
      saveAppointments(list, true);
      if (isAdminAuthenticated()) {
        renderAdminDashboard();
      }
      syncActiveCustomerBooking();

      try {
        const token = sessionStorage.getItem('salon_admin_token') || localStorage.getItem('salon_auth_token');
        await fetch(`${API_BASE_URL}/appointments/${encodeURIComponent(id)}/note`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ adminNote: note })
        });
      } catch (e) {}
    }
  }

  async function deleteAppointment(id) {
    const list = getStoredAppointments().filter(item => item.id !== id);
    saveAppointments(list, true);
    updateAdminBadges();
    if (isAdminAuthenticated()) {
      renderAdminDashboard();
    }
    syncActiveCustomerBooking();
    updateAvailableSlots();

    try {
      const token = sessionStorage.getItem('salon_admin_token') || localStorage.getItem('salon_auth_token');
      await fetch(`${API_BASE_URL}/appointments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
    } catch (e) {}
  }

  // Open & Close Admin Modal (REQUIRES ADMIN AUTHENTICATION)
  function openAdminModal() {
    if (!isAdminAuthenticated()) {
      openAuthModal('admin');
      return;
    }

    if (!adminModalOverlay) return;
    adminModalOverlay.classList.add('show');
    adminModalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    renderAdminDashboard();
  }

  function closeAdminModal() {
    if (!adminModalOverlay) return;
    adminModalOverlay.classList.remove('show');
    adminModalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (adminLauncherBtn) adminLauncherBtn.addEventListener('click', openAdminModal);
  if (btnNavAdminOpen) btnNavAdminOpen.addEventListener('click', openAdminModal);
  if (adminModalClose) adminModalClose.addEventListener('click', closeAdminModal);

  if (adminModalOverlay) {
    adminModalOverlay.addEventListener('click', (e) => {
      if (e.target === adminModalOverlay) closeAdminModal();
    });
  }

  // Admin filter tabs
  adminTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      adminTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentAdminFilter = tab.getAttribute('data-filter') || 'all';
      renderAdminDashboard();
    });
  });

  // Admin search input
  if (adminSearchInput) {
    adminSearchInput.addEventListener('input', () => {
      renderAdminDashboard();
    });
  }

  // Add sample demo request
  if (btnAdminSeedSample) {
    btnAdminSeedSample.addEventListener('click', () => {
      const demoNames = ['Kavindi Dias', 'Shanaya Silva', 'Nirosha Perera', 'Heshani Wickramasinghe'];
      const demoServices = ['Bridal Styling', 'Hair Coloring', 'Hair Treatment', 'Hair Cut'];
      const demoSlots = ['09:45 AM - 10:30 AM', '11:15 AM - 12:00 PM', '02:15 PM - 03:00 PM', '04:30 PM - 05:15 PM'];

      const randomName = demoNames[Math.floor(Math.random() * demoNames.length)];
      const randomService = demoServices[Math.floor(Math.random() * demoServices.length)];
      const randomSlot = demoSlots[Math.floor(Math.random() * demoSlots.length)];
      const randomPhone = '077' + Math.floor(1000000 + Math.random() * 9000000);

      createNewAppointment({
        name: randomName,
        phone: randomPhone,
        email: randomName.toLowerCase().replace(/\s+/g, '.') + '@demo.lk',
        service: randomService,
        date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
        time: randomSlot,
        message: 'Demo customer booking request for testing real-time workflow.'
      });
    });
  }

  // Clear all bookings
  if (btnAdminClearAll) {
    btnAdminClearAll.addEventListener('click', () => {
      if (confirm('Clear all appointment records and reset to empty state?')) {
        saveAppointments([], true);
        updateAdminBadges();
        renderAdminDashboard();
        syncActiveCustomerBooking();
        updateAvailableSlots();
        showAdminToast('Dashboard Cleared', 'All appointments cleared.');
      }
    });
  }

  // Real-time synchronization events (Local & Cross-tab)
  window.addEventListener('salon:appointments_changed', () => {
    updateAdminBadges();
    if (adminModalOverlay && adminModalOverlay.classList.contains('show')) {
      renderAdminDashboard();
    }
    syncActiveCustomerBooking();
    updateAvailableSlots();
    const user = getCurrentUser();
    if (user && clientBookingsModalOverlay && clientBookingsModalOverlay.classList.contains('show')) {
      renderClientBookings(user);
    }
  });

  window.addEventListener('storage', (e) => {
    if (e.key === APPOINTMENTS_STORAGE_KEY) {
      updateAdminBadges();
      if (adminModalOverlay && adminModalOverlay.classList.contains('show')) {
        renderAdminDashboard();
      }
      syncActiveCustomerBooking();
      updateAvailableSlots();
    }
  });

  // Check on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (authModalOverlay && authModalOverlay.classList.contains('show')) {
        closeAuthModal();
      }
      if (clientBookingsModalOverlay && clientBookingsModalOverlay.classList.contains('show')) {
        closeClientBookingsModal();
      }
      if (adminModalOverlay && adminModalOverlay.classList.contains('show')) {
        closeAdminModal();
      }
    }
  });

  // Hash-based direct route handling (e.g. #admin or #my-bookings)
  function handleUrlHash() {
    const hash = window.location.hash;
    if (hash === '#admin' || hash === '#/admin') {
      if (isAdminAuthenticated()) {
        openAdminModal();
      } else {
        openAuthModal('admin');
      }
    } else if (hash === '#my-bookings') {
      if (getCurrentUser()) {
        openClientBookingsModal();
      } else {
        openAuthModal('login');
      }
    } else if (hash === '#login') {
      openAuthModal('login');
    } else if (hash === '#signup') {
      openAuthModal('signup');
    }
  }

  window.addEventListener('hashchange', handleUrlHash);

  // Initial setup on load
  updateNavAuthState();
  autofillClientBookingForm();
  updateAdminBadges();
  syncActiveCustomerBooking();
  updateAvailableSlots();
  handleUrlHash();

  // Log confirmation in console for evaluators
  console.log('✨ Salon Hair Bride Landing Page initialized successfully.');
  console.log('📍 Colombo, Sri Lanka | Phone: 077 123 4567');
});



function sendFormDirectToWhatsApp() {
    try {
        let name = document.getElementById("fullName") ? document.getElementById("fullName").value.trim() : "";
        let phone = document.getElementById("phoneNumber") ? document.getElementById("phoneNumber").value.trim() : "";
        let service = document.getElementById("serviceSelect") ? document.getElementById("serviceSelect").value : "";
        let date = document.getElementById("preferredDate") ? document.getElementById("preferredDate").value : "";
        let time = document.getElementById("preferredTime") ? document.getElementById("preferredTime").value : "";
        let messageText = document.getElementById("bookingMessage") ? document.getElementById("bookingMessage").value.trim() : "";

        if (!name || !phone || !service || !date) {
            alert("place Enter Name, Phone Number, Service and  Preferred Date .");
            return;
        }

        let salonNumber = "94720638733"; 

        let message = "Hello Salon Hair Bride!\n\n" +
                      "*New Appointment Request*\n" +
                      "-----------------------------\n" +
                      "*Name:* " + name + "\n" +
                      "*Phone:* " + phone + "\n" +
                      "*Service:* " + service + "\n" +
                      "*Date:* " + date + "\n" +
                      "*Time Slot:* " + (time || "Not specified") + "\n" +
                      "*Notes:* " + (messageText || "None") + "\n\n" +
                      "Please confirm my booking.";

        let whatsappUrl = "https://wa.me/" + salonNumber + "?text=" + encodeURIComponent(message);
        window.open(whatsappUrl, "_blank");
    } catch (error) {
        console.error("Error in sendFormDirectToWhatsApp:", error);
    }
}

// 2. Summary Card Submit via WhatsApp ("Send Summary via WhatsApp" Button එකට)
function sendSummaryToWhatsApp() {
    try {
        let bookingId = "";
        let bookingEl = document.getElementById("summaryBookingId");
        if (bookingEl) {
            bookingId = bookingEl.innerText.replace("Booking ID:", "").trim();
        }

        let clientName = "";
        let nameInput = document.getElementById("fullName");
        if (nameInput && nameInput.value.trim() !== "") {
            clientName = nameInput.value.trim();
        } else {
            let nameEl = document.getElementById("feedbackClientName");
            if (nameEl) clientName = nameEl.innerText.trim();
        }
        if (!clientName || clientName === "Client") clientName = "Shakya";

        let service = "";
        let serviceEl = document.getElementById("summaryService");
        if (serviceEl && serviceEl.innerText.trim() !== "-" && serviceEl.innerText.trim() !== "") {
            service = serviceEl.innerText.trim();
        } else {
            let serviceSelect = document.getElementById("serviceSelect");
            if (serviceSelect) service = serviceSelect.value;
        }

        let dateVal = document.getElementById("preferredDate") ? document.getElementById("preferredDate").value : "";
        let timeVal = document.getElementById("preferredTime") ? document.getElementById("preferredTime").value : "";

        let fullDateTime = "";
        if (dateVal) {
            fullDateTime = dateVal + (timeVal ? " (" + timeVal + ")" : "");
        } else {
            let summaryDateEl = document.getElementById("summaryDateTime");
            if (summaryDateEl) fullDateTime = summaryDateEl.innerText.trim();
        }

        let salonNumber = "94720638733"; 

        let message = "Hello Salon Hair Bride!\n\n" +
                      "*Appointment Request Summary*\n" +
                      "-----------------------------\n" +
                      "*Booking ID:* " + bookingId + "\n" +
                      "*Name:* " + clientName + "\n" +
                      "*Service:* " + service + "\n" +
                      "*Date:* " + fullDateTime + "\n\n" +
                      "Please confirm my booking.";

        let whatsappUrl = "https://wa.me/" + salonNumber + "?text=" + encodeURIComponent(message);
        window.open(whatsappUrl, "_blank");
    } catch (error) {
        console.error("Error in sendSummaryToWhatsApp:", error);
    }
}