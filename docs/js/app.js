'use strict';
/* Shell: login, first-run setup, menus, toolbar */
const LOGO = '<svg viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M32 8v42M18 52h28M10 20h44"/><path d="M10 20l-7 16a9 6 0 0 0 14 0zM54 20l-7 16a9 6 0 0 0 14 0z"/><circle cx="32" cy="8" r="2.5" fill="#fff"/></svg>';
const MENUS = [
  ['الإعدادات', [['⚙', 'الإعدادات العامة وربط الحسابات', 'settings', 'settings'], ['🏢', 'الفروع', 'branches', 'settings'], ['👤', 'المستخدمون والصلاحيات', 'users', 'users'], ['🎯', 'مراكز التكلفة', 'cost_centers', 'accounts'], ['🕵', 'سجل المراجعة', 'audit', 'audit']]],
  ['الملفات', [['📚', 'دليل الحسابات', 'accounts', 'accounts'], ['👥', 'العملاء', 'customers', 'parties'], ['🚚', 'الموردون', 'suppliers', 'parties'], ['📦', 'الأصناف (بطاقة الصنف)', 'items', 'items'], ['🗂', 'مجموعات الأصناف', 'item_groups', 'items'], ['🏬', 'المخازن', 'warehouses', 'warehouses']]],
  ['المشتريات', [['🛒', 'فواتير المشتريات', 'inv-purchase', 'purchases'], ['↩', 'مردودات المشتريات', 'inv-purchase_return', 'purchases'], ['📝', 'أوامر الشراء', 'inv-purchase_order', 'purchases'], ['-'], ['📄', 'كشف حساب مورد', 'statement_s', 'reports'], ['💼', 'أرصدة الموردين', 'bal_s', 'reports'], ['⏳', 'أعمار ديون الموردين', 'aging_s', 'reports'], ['📊', 'مشتريات حسب الصنف', 'rep_pur_item', 'reports'], ['📊', 'مشتريات حسب المورد', 'rep_pur_party', 'reports']]],
  ['المبيعات', [['🧾', 'فواتير المبيعات', 'inv-sale', 'sales'], ['↩', 'مردودات المبيعات', 'inv-sale_return', 'sales'], ['💬', 'عروض الأسعار', 'inv-quote', 'sales'], ['📋', 'أوامر البيع', 'inv-sale_order', 'sales'], ['🖥', 'نقطة البيع (POS)', 'pos', 'sales'], ['✅', 'الاعتمادات المعلقة', 'approvals', 'approve'], ['🤝', 'علاقات العملاء CRM', 'crm', 'crm'], ['-'], ['📄', 'كشف حساب عميل', 'statement_c', 'reports'], ['💼', 'أرصدة العملاء', 'bal_c', 'reports'], ['⏳', 'أعمار ديون العملاء', 'aging_c', 'reports'], ['📊', 'مبيعات حسب الصنف', 'rep_sales_item', 'reports'], ['📊', 'مبيعات حسب العميل', 'rep_sales_party', 'reports'], ['📊', 'مبيعات شهرية', 'rep_sales_month', 'reports']]],
  ['المخازن', [['🏬', 'أرصدة المخازن', 'stock_bal', 'reports'], ['🗃', 'كارت الصنف', 'stockcard', 'reports'], ['🔢', 'جرد وتسوية', 'stock_adjust', 'warehouses'], ['🔁', 'تحويل بين المخازن', 'stock_transfer', 'warehouses'], ['🔥', 'الأكثر حركة والراكدة', 'movement', 'reports'], ['-'], ['🏭', 'التصنيع وقوائم المواد', 'boms', 'mfg']]],
  ['الخزينة والقيود', [['💰', 'سندات القبض', 'v-receipt', 'vouchers'], ['💸', 'سندات الصرف', 'v-payment', 'vouchers'], ['📒', 'القيود اليومية', 'journal', 'journal'], ['📑', 'كشف حساب (أستاذ)', 'ledger', 'reports']]],
  ['التقارير', [['⚖', 'ميزان المراجعة', 'trial', 'reports'], ['📑', 'كشف حساب (أستاذ)', 'ledger', 'reports'], ['📈', 'قائمة الدخل', 'income', 'reports'], ['🏛', 'المركز المالي', 'balance', 'reports'], ['🧮', 'الموازنات', 'budgets', 'budgets'], ['📃', 'كشف الفواتير', 'rep_inv_list', 'reports']]],
  ['الموارد والأصول', [['🧑‍💼', 'الموظفون', 'employees', 'hr'], ['💵', 'مسير الرواتب', 'payroll', 'hr'], ['🏗', 'الأصول الثابتة والإهلاك', 'assets', 'assets'], ['-'], ['🔧', 'الصيانة', 'maint', 'misc'], ['🏘', 'العقارات', 'estate', 'misc'], ['🎓', 'المعاهد', 'students', 'misc'], ['🗄', 'الأرشيف', 'archive', 'misc']]]
];
const TOOLBAR = [['🏠', 'الرئيسية', 'home'], ['🧾', 'مبيعات', 'inv-sale'], ['🛒', 'مشتريات', 'inv-purchase'], ['💰', 'قبض', 'v-receipt'], ['💸', 'صرف', 'v-payment'], ['📒', 'قيود', 'journal'], ['👥', 'العملاء', 'customers'], ['📦', 'الأصناف', 'items'], ['🏬', 'المخازن', 'stock_bal'], ['⚖', 'الميزان', 'trial'], ['📈', 'الدخل', 'income'], ['🖥', 'POS', 'pos']];
const TITLES = {}; MENUS.forEach(m => m[1].forEach(i => { if (i.length > 2) TITLES[i[2]] = i[1]; })); TITLES.home = 'الرئيسية';

async function openPage(key) {
  if (key !== 'home') { const perm = (MENUS.flatMap(m => m[1]).find(i => i[2] === key) || [])[3]; if (perm && !can(perm + ':view')) return toast('ليست لديك صلاحية لهذه الشاشة', 'err'); }
  const f = MZ.pages[key]; if (!f) return toast('الشاشة غير متاحة', 'err');
  openWin(key, TITLES[key] || key, async () => { const r = f(); return await r; });
}

function logout() { SND.play('logout'); sessionStorage.removeItem('mz_tok'); setTimeout(() => location.reload(), 650); }
function muteBtn() { const b = h('button', { class: 'mute', title: 'كتم / تشغيل الأصوات', onclick: () => { const m = SND.toggle(); b.textContent = m ? '🔇' : '🔊'; } }, SND.muted ? '🔇' : '🔊'); return b; }

function shell() {
  const app = $('#app'); app.innerHTML = '';
  const menu = h('div', { class: 'menubar' }, MENUS.map(([t, items]) => {
    const vis = items.filter(i => i[0] === '-' || !i[3] || can(i[3] + ':view'));
    if (!vis.some(i => i[0] !== '-')) return null;
    return h('div', { class: 'mi' }, h('span', null, t), h('div', { class: 'dd' }, vis.map(i => i[0] === '-' ? h('div', { class: 'sep' }) : h('div', { class: 'it', onclick: () => openPage(i[2]) }, h('span', null, i[0]), i[1]))));
  }));
  const tb = h('div', { class: 'toolbar' }, TOOLBAR.filter(t => { const p = (MENUS.flatMap(m => m[1]).find(i => i[2] === t[2]) || [])[3]; return t[2] === 'home' || !p || can(p + ':view'); }).map(t => h('button', { class: 'tb', onclick: () => openPage(t[2]) }, h('i', null, t[0]), t[1])),
    h('button', { class: 'tb', onclick: () => { const w = MZ.wins[MZ.active]; w && w.refresh && w.refresh(); } }, h('i', null, '🔄'), 'تحديث'));
  app.append(
    h('div', { class: 'banner' }, h('div', { class: 'brand', html: LOGO + '<div><h1>ميزان ERP</h1><small>' + esc(MZ.settings.company_name || 'نظام المحاسبة وإدارة الأعمال') + '</small></div>' }),
      h('div', { class: 'who' }, muteBtn(), h('span', { class: 'chip' }, '👤 ' + (MZ.user.name || MZ.user.username) + ' | ' + (MZ.user.role_name || '')), h('button', { onclick: logout }, 'تسجيل الخروج'))),
    menu, tb, h('div', { class: 'tabs', id: 'tabs' }), h('div', { id: 'desk' }),
    h('div', { class: 'statusbar' }, h('span', null, 'ميزان ERP'), h('span', null, new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))));
  openWin('home', 'الرئيسية', () => MZ.pages.home());
}

async function boot() {
  const app = $('#app');
  if (!MZ.api) { app.textContent = 'إعداد الخادم غير موجود'; return; }
  if (MZ.token) {
    try { const me = await GET('/me'); MZ.user = me.user; MZ.settings = me.settings; MZ.modules = me.modules; await Promise.all(['accounts', 'parties', 'items', 'warehouses', 'branches', 'cost_centers', 'item_groups'].filter(n => can(({ accounts: 'accounts', parties: 'parties', items: 'items', warehouses: 'warehouses', branches: 'settings', cost_centers: 'accounts', item_groups: 'items' })[n] + ':view')).map(n => load(n, true))); shell(); return; } catch (e) { sessionStorage.removeItem('mz_tok'); MZ.token = null; }
  }
  loginScreen();
}

function loginScreen() {
  const app = $('#app'); app.innerHTML = '';
  const msg = h('div', { class: 'lg-msg info' }, 'جاري الاتصال بالخادم...');
  const user = h('input', { id: 'u', autocomplete: 'username', placeholder: 'اسم المستخدم' }), pass = h('input', { id: 'p', type: 'password', autocomplete: 'current-password', placeholder: '••••••••' });
  const company = h('input', { id: 'c', placeholder: 'اسم الشركة' });
  const go = h('button', { class: 'go', type: 'submit', disabled: true }, 'تسجيل الدخول');
  const title = h('h2', null, 'مرحباً بعودتك'), sub = h('div', { class: 'sub' }, 'سجّل الدخول للمتابعة إلى لوحة التحكم');
  const compBox = h('div', { style: { display: 'none' } }, h('label', null, 'اسم الشركة'), company);
  let setupMode = false;
  const form = h('form', { class: 'lg-card', onsubmit: async (e) => {
    e.preventDefault(); go.disabled = true; msg.className = 'lg-msg info'; msg.textContent = 'جاري التحقق...';
    try {
      if (setupMode) { await POST('/setup', { username: user.value, password: pass.value, company: company.value, name: 'مدير النظام' }); }
      const r = await POST('/login', { username: user.value, password: pass.value });
      MZ.token = r.token; sessionStorage.setItem('mz_tok', r.token); SND.play('login'); await boot();
    } catch (err) { msg.className = 'lg-msg'; msg.textContent = err.message; go.disabled = false; }
  } }, title, sub, compBox, h('label', { for: 'u' }, 'اسم المستخدم'), user, h('label', { for: 'p' }, 'كلمة المرور'), pass, go, msg, h('div', { class: 'lg-foot' }, 'ميزان ERP © نظام محاسبة وإدارة أعمال متكامل'));
  app.append(h('div', { class: 'login-page' },
    h('div', { class: 'lg-art' }, h('div', { html: LOGO }), h('h1', null, 'ميزان ERP'), h('p', null, 'نظام متكامل للمحاسبة والمخازن والمبيعات والمشتريات والموارد البشرية، مصمم للشركات الكبيرة والصغيرة.'),
      h('ul', null, ['قيد مزدوج وقيود تلقائية من كل مستند', 'تعدد الفروع والمخازن ومراكز التكلفة', 'صلاحيات مستخدمين دقيقة وسجل مراجعة كامل', 'تقارير مالية ومخزنية فورية'].map(t => h('li', null, t)))),
    h('div', { class: 'lg-form' }, form)));
  const ping = async (n = 0) => {
    try {
      const st = await GET('/status'); go.disabled = false; msg.textContent = '';
      if (st.setup_needed) { setupMode = true; title.textContent = 'إعداد النظام لأول مرة'; sub.textContent = 'أنشئ حساب مدير النظام'; compBox.style.display = 'block'; go.textContent = 'إنشاء الحساب والدخول'; user.value = ''; pass.placeholder = '8 أحرف على الأقل'; }
    } catch (e) { msg.textContent = n < 2 ? 'جاري الاتصال بالخادم...' : 'الخادم يستيقظ، قد يستغرق ذلك حتى دقيقة...'; setTimeout(() => ping(n + 1), 4000); }
  };
  ping(); user.focus();
}
boot();
