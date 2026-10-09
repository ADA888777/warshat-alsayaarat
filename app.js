// إعداد الاتصال: غيّر الرابط والمفتاح العام هنا عند تغيير مشروع Supabase.
    const SUPABASE_URL = "https://xrwatehjxfqjiucwxyom.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rUGpLp3PpEswCZdpRd-ZCA_dTpuSmMC";

    const $ = id => document.getElementById(id);
    const views = ['home', 'services', 'booking', 'confirmation', 'admin'];
    const statusNames = {new:'جديد', confirmed:'مؤكد', completed:'مكتمل', cancelled:'ملغي'};
    const connectionFailure = 'تعذر الاتصال بقاعدة البيانات. تحقق من إعدادات Supabase والجداول والصلاحيات.';
    const adminQuery = 'id,reference_code,appointment_at,status,created_at,updated_at,customer:customers(full_name,phone),car:cars(make,model,plate_number),service:services(id,name_ar)';
    let supabaseClient = null;
    let services = [];
    let bookings = [];
    let lastBooking = null;
    let selectedCancel = null;
    let bookingBusy = false;
    let adminBusy = false;
    let authGeneration = 0;
    let adminAuthorized = false;
    let connectionBusy = false;
    let returningFocus = null;

    function setMessage(id, text, success = false) {
      const el = $(id);
      el.textContent = text;
      el.hidden = !text;
      el.classList.toggle('notice-success', success);
      el.classList.toggle('notice-error', !success);
    }

    function show(view) {
      if (!views.includes(view)) return;
      views.forEach(id => $(id).hidden = id !== view);
      $('confirmation-empty').hidden = !!lastBooking;
      $('confirmation-result').hidden = !lastBooking;
      $('mobile-nav').classList.add('hidden');
      $('menu-toggle').setAttribute('aria-expanded', 'false');
      if (view === 'admin') refreshAuth();
      window.scrollTo({top:0, behavior:'smooth'});
    }

    document.querySelectorAll('[data-go]').forEach(button => {
      button.addEventListener('click', () => show(button.dataset.go));
    });
    $('menu-toggle').addEventListener('click', () => {
      const closed = $('mobile-nav').classList.toggle('hidden');
      $('menu-toggle').setAttribute('aria-expanded', String(!closed));
    });

    function latinDigits(value) {
      return String(value).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
        .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    }
    function localDay(date = new Date()) {
      return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
    }
    function displayDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-SA', {dateStyle:'medium',timeStyle:'short'}).format(date);
    }
    function setConnection(connected, loading = false) {
      $('connection-status').textContent = loading ? 'جارٍ فحص الاتصال...' : connected ? 'قاعدة البيانات متصلة' : 'قاعدة البيانات غير متصلة';
      $('connection-status').className = 'inline-flex rounded-full px-4 py-1.5 font-bold ' +
        (loading ? 'bg-slate-200 text-slate-700' : connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');
      $('retry-connection').hidden = loading || connected;
      setMessage('connection-error', loading || connected ? '' : connectionFailure);
    }

    // لا تُعرض الخدمات إلا بعد نجاح الاستعلام الحقيقي.
    async function loadServices() {
      if (connectionBusy) return;
      connectionBusy = true;
      setConnection(false, true);
      ['home-services-state','services-state'].forEach(id => { $(id).hidden = false; $(id).textContent = 'جارٍ تحميل الخدمات...'; });
      $('home-retry').hidden = $('services-retry').hidden = true;
      try {
        if (!supabaseClient) throw new Error('client unavailable');
        const {data, error} = await supabaseClient.from('services')
          .select('id,name_ar,description_ar,active').eq('active', true).order('name_ar');
        if (error) throw error;
        services = data || [];
        setConnection(true);
        renderServices();
        setMessage('test-result', 'نجح استعلام الخدمات من Supabase.', true);
      } catch {
        services = [];
        setConnection(false);
        renderServices();
        setMessage('test-result', connectionFailure);
      } finally {
        connectionBusy = false;
        $('test-connection').disabled = false;
      }
    }
    function renderServices() {
      for (const [targetId, stateId, retryId, subset] of [
        ['home-services','home-services-state','home-retry',true],
        ['services-list','services-state','services-retry',false]
      ]) {
        const target = $(targetId);
        target.replaceChildren();
        (subset ? services.slice(0,3) : services).forEach(service => {
          const card = $('service-template').content.firstElementChild.cloneNode(true);
          card.querySelector('[data-template-id="service-name"]').textContent = service.name_ar || 'خدمة';
          card.querySelector('[data-template-id="service-description"]').textContent = service.description_ar || '';
          card.querySelector('[data-template-id="service-book"]').addEventListener('click', () => {
            $('service_type').value = String(service.id);
            show('booking');
          });
          target.appendChild(card);
        });
        $(stateId).textContent = services.length ? '' :
          $('connection-error').hidden ? 'لم تتم إضافة الخدمات بعد' : connectionFailure;
        $(stateId).hidden = !!services.length;
        $(retryId).hidden = !!services.length;
      }
      const select = $('service_type');
      const previouslySelected = select.value;
      select.replaceChildren(new Option('اختر الخدمة', ''));
      const serviceFilter = $('service-filter');
      const filterValue = serviceFilter.value;
      serviceFilter.replaceChildren(new Option('كل الخدمات', ''));
      services.forEach(service => {
        select.add(new Option(service.name_ar, String(service.id)));
        serviceFilter.add(new Option(service.name_ar, String(service.id)));
      });
      if (services.some(s => String(s.id) === previouslySelected)) select.value = previouslySelected;
      if (services.some(s => String(s.id) === filterValue)) serviceFilter.value = filterValue;
    }

    async function initializeSupabase() {
      try {
        if (!window.supabase?.createClient) throw new Error('library unavailable');
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
        supabaseClient.auth.onAuthStateChange(() => {
          // تأجيل استعلامات Auth إلى ما بعد انتهاء إشعار تغيير الجلسة.
          setTimeout(() => refreshAuth(), 0);
        });
        await loadServices();
        await refreshAuth();
      } catch {
        services = [];
        setConnection(false);
        renderServices();
        $('admin-auth-loading').hidden = true;
        $('login-form').hidden = false;
        setMessage('auth-message', connectionFailure);
      }
    }

    $('retry-connection').addEventListener('click', loadServices);
    $('home-retry').addEventListener('click', loadServices);
    $('services-retry').addEventListener('click', loadServices);
    $('test-connection').addEventListener('click', () => {
      $('test-connection').disabled = true;
      loadServices();
    });

    function fieldError(id, text) {
      $('error-' + id).textContent = text;
      $(id).setAttribute('aria-invalid', String(!!text));
    }
    function validateBooking() {
      let firstInvalid = null;
      for (const id of ['customer_name','phone','car_type','car_model','service_type','date','time']) {
        const value = latinDigits($(id).value).trim();
        let error = value ? '' : 'هذا الحقل مطلوب.';
        if (id === 'phone' && value && !/^(?:05\d{8}|(?:\+?966)5\d{8})$/.test(value.replace(/[\s()-]/g,''))) {
          error = 'أدخل رقم جوال سعودي صحيحًا، مثل 05XXXXXXXX.';
        }
        if (id === 'service_type' && value && !services.some(s => String(s.id) === value)) error = 'اختر خدمة متاحة.';
        if (id === 'date' && value && value < localDay()) error = 'اختر تاريخ اليوم أو تاريخًا لاحقًا.';
        if (id === 'time' && value && !/^\d{2}:\d{2}$/.test(value)) error = 'أدخل وقتًا صحيحًا.';
        fieldError(id, error);
        if (error && !firstInvalid) firstInvalid = $(id);
      }
      if (!$('error-date').textContent && !$('error-time').textContent) {
        const appointment = new Date(`${$('date').value}T${latinDigits($('time').value)}`);
        if (Number.isNaN(appointment.getTime()) || appointment <= new Date()) {
          fieldError('time', 'اختر تاريخًا ووقتًا في المستقبل.');
          firstInvalid ||= $('time');
        }
      }
      if (firstInvalid) firstInvalid.focus();
      return !firstInvalid;
    }
    ['customer_name','phone','car_type','car_model','service_type','date','time'].forEach(id => {
      $(id).addEventListener('input', () => fieldError(id, ''));
      $(id).addEventListener('change', () => fieldError(id, ''));
    });
    $('date').min = localDay();

    function bookingError(error) {
      const code = String(error?.code || '');
      const text = String(error?.message || '').toLowerCase();
      if (code === '42883' || text.includes('could not find the function') || text.includes('function public.create_public_booking')) {
        return 'دالة create_public_booking غير موجودة. شغّل ملف SQL الخاص بك في Supabase وتحقق من أسماء المعاملات والصلاحيات.';
      }
      if (code === '23505' || code === '23P01' || /conflict|already.booked|slot.taken|موعد محجوز/i.test(text)) {
        return 'هذا الموعد يتعارض مع حجز آخر، اختر وقتًا مختلفًا.';
      }
      if (code === '22023') return 'تحقق من الاسم ورقم الجوال والسيارة والخدمة وموعد الحجز ثم حاول مرة أخرى.';
      return 'تعذر إرسال طلب الحجز. تحقق من الاتصال وإعدادات SQL والصلاحيات، ثم حاول مرة أخرى.';
    }
    $('booking-form').addEventListener('submit', async event => {
      event.preventDefault();
      setMessage('form-message', '');
      if (bookingBusy || !validateBooking()) return;
      if (!supabaseClient) { setMessage('form-message', connectionFailure); return; }

      const service = services.find(s => String(s.id) === $('service_type').value);
      const appointment = new Date(`${$('date').value}T${latinDigits($('time').value)}`);
      const payload = {
        p_full_name: $('customer_name').value.trim(),
        p_phone: latinDigits($('phone').value).replace(/[\s()-]/g,''),
        p_car_make: $('car_type').value.trim(),
        p_car_model: $('car_model').value.trim(),
        p_plate_number: latinDigits($('plate_number').value.trim()),
        p_service_id: service.id,
        p_appointment_at: appointment.toISOString(),
        p_notes: $('notes').value.trim()
      };
      bookingBusy = true;
      $('submit-booking').disabled = true;
      $('booking-loading').hidden = false;
      try {
        const {data, error} = await supabaseClient.rpc('create_public_booking', payload);
        if (error) throw error;
        // لا يُعرض تأكيد دون مرجع فعلي من الدالة التي أنشأها المستخدم.
        const result = Array.isArray(data) ? data[0] : data;
        const reference = result?.reference_code;
        if (!result || typeof reference !== 'string' || !/^WR-[A-F0-9]{12}$/.test(reference)) {
          setMessage('form-message', 'لم تُرجع قاعدة البيانات رقم حجز صالحًا؛ لم يتم عرض التأكيد. راجع دالة SQL ثم أعد المحاولة.');
          return;
        }
        lastBooking = result;
        $('summary-reference').textContent = String(reference);
        $('summary-name').textContent = String(result.full_name ?? result.customer_name ?? payload.p_full_name);
        $('summary-car').textContent = String(result.car_make ?? payload.p_car_make) + ' ' + String(result.car_model ?? payload.p_car_model);
        $('summary-service').textContent = String(result.service_name_ar ?? result.service_name ?? service.name_ar);
        $('summary-date').textContent = displayDate(result.appointment_at ?? payload.p_appointment_at);
        $('booking-form').reset();
        show('confirmation');
      } catch (error) {
        setMessage('form-message', bookingError(error));
      } finally {
        bookingBusy = false;
        $('submit-booking').disabled = false;
        $('booking-loading').hidden = true;
      }
    });

    function clearAdminData() {
      adminAuthorized = false;
      bookings = [];
      $('booking-rows').replaceChildren();
      $('admin-empty').hidden = true;
      for (const id of ['stat-total','stat-today','stat-upcoming']) $(id).textContent = '—';
      $('admin-panel').hidden = true;
      closeModal();
    }
    function isAllowed(value) {
      if (value === true) return true;
      if (value && typeof value === 'object') {
        return value.allowed === true || value.is_admin === true || value.role === 'admin';
      }
      return false;
    }
    async function refreshAuth() {
      const generation = ++authGeneration;
      if (!supabaseClient) return;
      if (!$('admin').hidden) $('admin-auth-loading').hidden = false;
      clearAdminData();
      $('login-form').hidden = true;
      setMessage('auth-message', '');
      try {
        const {data:{session}, error} = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (generation !== authGeneration) return;
        if (!session) {
          $('logout-outside').hidden = true;
          $('admin-auth-loading').hidden = true;
          $('login-form').hidden = false;
          return;
        }
        $('logout-outside').hidden = false;
        const permission = await supabaseClient.rpc('is_admin');
        if (generation !== authGeneration) return;
        if (permission.error) {
          setMessage('auth-message', 'تعذر التحقق من صلاحية الإدارة. تأكد من إنشاء دالة is_admin وصلاحياتها، ثم حاول إعادة تحميل الصفحة.');
          $('admin-auth-loading').hidden = true;
          return;
        }
        if (!isAllowed(permission.data)) {
          setMessage('auth-message', 'ليس لديك صلاحية للوصول إلى لوحة الإدارة');
          $('admin-auth-loading').hidden = true;
          $('logout-outside').hidden = false;
          return;
        }
        adminAuthorized = true;
        $('logout-outside').hidden = true;
        $('admin-auth-loading').hidden = true;
        $('admin-panel').hidden = false;
        await loadBookings();
      } catch {
        if (generation !== authGeneration) return;
        clearAdminData();
        $('admin-auth-loading').hidden = true;
        setMessage('auth-message', 'تعذر التحقق من الجلسة. تحقق من الاتصال وحاول مرة أخرى.');
      }
    }
    $('login-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (!supabaseClient) { setMessage('auth-message', connectionFailure); return; }
      const button = $('login-submit');
      button.disabled = true;
      setMessage('auth-message', '');
      try {
        const {error} = await supabaseClient.auth.signInWithPassword({
          email: $('admin-email').value.trim(),
          password: $('admin-password').value
        });
        if (error) throw error;
        $('admin-password').value = '';
        await refreshAuth();
      } catch {
        setMessage('auth-message', 'تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور أو الاتصال.');
      } finally {
        button.disabled = false;
      }
    });
    async function signOut(button) {
      if (!supabaseClient) return;
      const logoutButton = button || $('logout');
      logoutButton.disabled = true;
      try {
        const {error} = await supabaseClient.auth.signOut();
        if (error) throw error;
        clearAdminData();
        $('admin-password').value = '';
        await refreshAuth();
      } catch {
        setMessage('auth-message', 'تعذر تسجيل الخروج الآن. حاول مرة أخرى.');
      } finally {
        logoutButton.disabled = false;
      }
    }
    $('logout').addEventListener('click', () => signOut($('logout')));
    $('logout-outside').addEventListener('click', () => signOut($('logout-outside')));

    function adminError(error) {
      const code = String(error?.code || '');
      const text = String(error?.message || '').toLowerCase();
      if (code === '42501' || /permission denied|row.level.security/.test(text)) return 'لا تسمح سياسات RLS بهذه العملية. تحقق من صلاحيات المسؤول في Supabase.';
      if (code === 'PGRST200' || code === 'PGRST201' || /relationship/.test(text)) return 'تعذر قراءة علاقات الحجوزات. راجع أسماء العلاقات والحقول في قسم إعداد Supabase.';
      if (/jwt|session|token|unauthorized/i.test(text) || code === 'PGRST301') return 'انتهت الجلسة أو لم تعد صالحة. سجّل الدخول مجددًا.';
      return 'تعذر تحميل أو تحديث الحجوزات. تحقق من الاتصال والجداول والصلاحيات ثم أعد المحاولة.';
    }
    async function loadBookings() {
      if (!adminAuthorized || adminBusy) return;
      const generation = authGeneration;
      adminBusy = true;
      $('reload-bookings').disabled = true;
      bookings = [];
      $('booking-rows').replaceChildren();
      $('admin-empty').hidden = true;
      for (const id of ['stat-total','stat-today','stat-upcoming']) $(id).textContent = '—';
      setMessage('admin-message', 'جارٍ تحميل الحجوزات...');
      try {
        const {data, error} = await supabaseClient.from('bookings')
          .select(adminQuery).order('appointment_at', {ascending:false});
        if (error) throw error;
        if (generation !== authGeneration || !adminAuthorized) return;
        bookings = data || [];
        setMessage('admin-message', '');
        renderBookings();
      } catch (error) {
        if (generation !== authGeneration) return;
        bookings = [];
        $('booking-rows').replaceChildren();
        $('admin-empty').hidden = true;
        setMessage('admin-message', adminError(error));
      } finally {
        adminBusy = false;
        $('reload-bookings').disabled = false;
      }
    }
    function related(value) { return Array.isArray(value) ? value[0] || {} : value || {}; }
    function renderBookings() {
      if (!adminAuthorized) return;
      const now = new Date();
      const today = localDay(now);
      $('stat-total').textContent = bookings.length.toLocaleString('ar-SA');
      $('stat-today').textContent = bookings.filter(b => localDay(new Date(b.appointment_at)) === today && b.status !== 'cancelled').length.toLocaleString('ar-SA');
      $('stat-upcoming').textContent = bookings.filter(b => new Date(b.appointment_at) >= now && !['completed','cancelled'].includes(b.status)).length.toLocaleString('ar-SA');

      const query = latinDigits($('search').value.trim()).toLowerCase();
      const status = $('status-filter').value;
      const service = $('service-filter').value;
      const visible = bookings.filter(b => {
        const customer = related(b.customer);
        const serviceRow = related(b.service);
        const searchable = latinDigits([customer.full_name,customer.phone,b.reference_code].join(' ')).toLowerCase();
        return (!query || searchable.includes(query)) && (!status || b.status === status) && (!service || String(serviceRow.id) === service);
      });
      const tbody = $('booking-rows');
      const existing = new Map([...tbody.children].map(row => [row.dataset.id,row]));
      visible.forEach(b => {
        const key = String(b.id);
        let row = existing.get(key);
        if (!row) {
          row = $('row-template').content.firstElementChild.cloneNode(true);
          row.dataset.id = key;
          tbody.appendChild(row);
        }
        existing.delete(key);
        const customer = related(b.customer), car = related(b.car), serviceRow = related(b.service);
        const cells = {
          reference: b.reference_code ?? String(b.id),
          name: customer.full_name ?? '—',
          phone: customer.phone ?? '—',
          car: [car.make,car.model,car.plate_number].filter(Boolean).join(' · ') || '—',
          service: serviceRow.name_ar ?? '—',
          appointment: displayDate(b.appointment_at),
          status: statusNames[b.status] ?? b.status ?? '—'
        };
        Object.entries(cells).forEach(([name,value]) => {
          const cell = row.querySelector(`[data-field="${name}"]`);
          if (cell.textContent !== String(value)) cell.textContent = String(value);
        });
        row.querySelector('[data-field="status"]').className = 'canva-tag status status-' + (statusNames[b.status] ? b.status : 'new');
        row.querySelector('[data-action="confirm"]').hidden = b.status !== 'new';
        row.querySelector('[data-action="advance"]').hidden = b.status !== 'confirmed';
        row.querySelector('[data-action="cancel"]').hidden = !['new','confirmed'].includes(b.status);
      });
      existing.forEach(row => row.remove());
      $('admin-empty').hidden = visible.length !== 0;
    }
    $('search').addEventListener('input', renderBookings);
    $('status-filter').addEventListener('change', renderBookings);
    $('service-filter').addEventListener('change', renderBookings);
    $('reload-bookings').addEventListener('click', loadBookings);

    async function updateStatus(bookingId, status, button) {
      if (!adminAuthorized || adminBusy || !bookings.some(b => String(b.id) === String(bookingId))) return false;
      const generation = authGeneration;
      adminBusy = true;
      button.disabled = true;
      setMessage('admin-message', '');
      let succeeded = false;
      try {
        const {data, error} = await supabaseClient.from('bookings')
          .update({status})
          .eq('id', bookingId).select().single();
        if (error) throw error;
        if (!data || generation !== authGeneration || !adminAuthorized) return false;
        succeeded = true;
      } catch (error) {
        if (generation === authGeneration) setMessage('admin-message', adminError(error));
      } finally {
        adminBusy = false;
        button.disabled = false;
      }
      if (succeeded) {
        await loadBookings();
        if (adminAuthorized && $('admin-message').hidden) setMessage('admin-message', 'تم تحديث حالة الحجز بنجاح.', true);
      }
      return succeeded;
    }
    $('booking-rows').addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button || !adminAuthorized) return;
      const id = button.closest('tr')?.dataset.id;
      const booking = bookings.find(b => String(b.id) === id);
      if (!booking) return;
      if (button.dataset.action === 'cancel') {
        selectedCancel = id;
        returningFocus = button;
        $('cancel-modal').hidden = false;
        $('cancel-confirm').focus();
      } else {
        updateStatus(id, button.dataset.action === 'confirm' ? 'confirmed' : 'completed', button);
      }
    });
    function closeModal() {
      selectedCancel = null;
      $('cancel-modal').hidden = true;
      if (returningFocus?.isConnected) returningFocus.focus();
      returningFocus = null;
    }
    $('cancel-close').addEventListener('click', closeModal);
    $('cancel-modal').addEventListener('click', event => {
      if (event.target === $('cancel-modal')) closeModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('cancel-modal').hidden) closeModal();
    });
    $('cancel-confirm').addEventListener('click', async () => {
      if (!selectedCancel) return;
      const id = selectedCancel;
      const succeeded = await updateStatus(id, 'cancelled', $('cancel-confirm'));
      if (succeeded) closeModal();
    });

    initializeSupabase();
