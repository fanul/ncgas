/**
 * "Employee Dashboard" starter template — seeds a new workspace with a
 * working two-page app that exercises every subsystem: RBAC visibility,
 * validation rules, services with mock data, KPI expressions and email.
 */
import { Blueprint } from '../engine.js';

export function employeeDashboardTemplate(ownerEmail) {
  const bp = Blueprint.createEmptyBlueprint('ncgas_employee_demo', 'Employee Dashboard');
  const homeId = Object.keys(bp.pages)[0];

  bp.meta.globalSettings.theme = 'dark';
  bp.rbac.roles = ['Admin', 'HR_Manager', 'Employee'];
  bp.rbac.roleMap = { '*': ['Employee'] };
  if (ownerEmail) bp.rbac.roleMap[ownerEmail] = ['Admin'];

  bp.sharedServices = {
    srv_fetch_employees: {
      type: 'SHEET_READ',
      spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE',
      sheet: 'Employees',
      cachePolicy: 'LOCAL_STORAGE_5M',
      allowedRoles: ['Admin', 'HR_Manager'],
      dataBoundary: null,
      mockResult: [
        { name: 'Ani Lestari', division: 'Finance', salary: 8500000, owner_email: 'ani@example.com' },
        { name: 'Budi Santoso', division: 'IT', salary: 9750000, owner_email: 'budi@example.com' },
        { name: 'Citra Ayu', division: 'HR', salary: 7200000, owner_email: 'citra@example.com' }
      ]
    },
    srv_submit_request: {
      type: 'SHEET_APPEND',
      spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE',
      sheet: 'Requests',
      allowedRoles: [],
      dataBoundary: { ownerColumn: 'owner_email' },
      mockResult: { appended: 1 },
      rules: {
        execution: [{
          condition: 'payload.amount > 0 && payload.amount <= 50000000',
          errorMessage: 'Nominal harus antara 1 dan 50.000.000.'
        }]
      }
    },
    srv_notify_hr: {
      type: 'EMAIL_SEND',
      to: 'hr@example.com',
      subject: 'Pengajuan baru dari {{email}}',
      htmlTemplate: '<p>Dear HR,</p><p>Pengajuan baru sebesar <b>{{amount}}</b> dari {{email}}.</p><p>Keterangan: {{reason}}</p>',
      allowedRoles: [],
      mockResult: { sent: true }
    },

    // --- CRUD_TABLE demo: flat Sheet-backed CRUD (filter -> read -> add -> edit -> delete) ---
    srv_crud_karyawan_read: {
      type: 'SHEET_READ', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Karyawan',
      allowedRoles: [], dataBoundary: null,
      mockResult: [
        { id: 'k1', nama: 'Ani Lestari', divisi: 'Finance', gaji: 8500000 },
        { id: 'k2', nama: 'Budi Santoso', divisi: 'IT', gaji: 9750000 },
        { id: 'k3', nama: 'Citra Ayu', divisi: 'HR', gaji: 7200000 }
      ]
    },
    srv_crud_karyawan_create: { type: 'SHEET_APPEND', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Karyawan', keyColumn: 'id', allowedRoles: [], dataBoundary: null, mockResult: { appended: 1 } },
    srv_crud_karyawan_update: { type: 'SHEET_UPDATE', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Karyawan', keyColumn: 'id', allowedRoles: [], dataBoundary: null, mockResult: { updated: 1 } },
    srv_crud_karyawan_delete: { type: 'SHEET_DELETE', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Karyawan', keyColumn: 'id', allowedRoles: [], mockResult: { deleted: 1 } },

    // --- CRUD_TABLE demo: master-detail (Proyek -> Tugas, "add detail" pattern) ---
    srv_crud_proyek_read: {
      type: 'SHEET_READ', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Proyek',
      allowedRoles: [], dataBoundary: null,
      mockResult: [
        { id: 'p1', nama_proyek: 'Migrasi Sistem Absensi', status: 'Berjalan' },
        { id: 'p2', nama_proyek: 'Portal Layanan Peserta', status: 'Ditunda' }
      ]
    },
    srv_crud_proyek_create: { type: 'SHEET_APPEND', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Proyek', keyColumn: 'id', allowedRoles: [], dataBoundary: null, mockResult: { appended: 1 } },
    srv_crud_proyek_update: { type: 'SHEET_UPDATE', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Proyek', keyColumn: 'id', allowedRoles: [], dataBoundary: null, mockResult: { updated: 1 } },
    srv_crud_proyek_delete: { type: 'SHEET_DELETE', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Proyek', keyColumn: 'id', allowedRoles: [], mockResult: { deleted: 1 } },

    srv_crud_tugas_read: {
      type: 'SHEET_READ', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Tugas',
      allowedRoles: [], dataBoundary: null,
      mockResult: [
        { id: 't1', proyek_id: 'p1', nama_tugas: 'Audit data lama', selesai: 'Ya' },
        { id: 't2', proyek_id: 'p1', nama_tugas: 'Migrasi ke sheet baru', selesai: 'Tidak' },
        { id: 't3', proyek_id: 'p2', nama_tugas: 'Kickoff meeting', selesai: 'Tidak' }
      ]
    },
    srv_crud_tugas_create: { type: 'SHEET_APPEND', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Tugas', keyColumn: 'id', allowedRoles: [], dataBoundary: null, mockResult: { appended: 1 } },
    srv_crud_tugas_update: { type: 'SHEET_UPDATE', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Tugas', keyColumn: 'id', allowedRoles: [], dataBoundary: null, mockResult: { updated: 1 } },
    srv_crud_tugas_delete: { type: 'SHEET_DELETE', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Tugas', keyColumn: 'id', allowedRoles: [], mockResult: { deleted: 1 } },

    // --- POS demo: product catalog (sheet + images), local cart, sales dashboard ---
    srv_produk_read: {
      type: 'SHEET_READ', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Produk',
      allowedRoles: [], dataBoundary: null,
      mockResult: [
        { id: 'p1', nama: 'Kopi Susu', kategori: 'Minuman', harga: 18000, foto: '' },
        { id: 'p2', nama: 'Roti Bakar', kategori: 'Makanan', harga: 15000, foto: '' },
        { id: 'p3', nama: 'Es Teh', kategori: 'Minuman', harga: 8000, foto: '' }
      ]
    },
    srv_produk_create: { type: 'SHEET_APPEND', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Produk', keyColumn: 'id', allowedRoles: [], dataBoundary: null, mockResult: { appended: 1 } },
    srv_produk_update: { type: 'SHEET_UPDATE', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Produk', keyColumn: 'id', allowedRoles: [], dataBoundary: null, mockResult: { updated: 1 } },
    srv_produk_delete: { type: 'SHEET_DELETE', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Produk', keyColumn: 'id', allowedRoles: [], mockResult: { deleted: 1 } },
    srv_produk_upload: { type: 'DRIVE_UPLOAD', allowedRoles: [], maxSizeMB: 5, mockResult: null },

    srv_sales_report: {
      type: 'SHEET_READ', spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Penjualan',
      allowedRoles: [], dataBoundary: null,
      mockResult: [
        { kategori: 'Minuman', total: 1250000 },
        { kategori: 'Makanan', total: 860000 },
        { kategori: 'Snack', total: 340000 }
      ]
    },

    srv_pos_pdf: { type: 'PDF_EXPORT', allowedRoles: [], mockResult: { url: null } }
  };

  bp.sharedRules = {
    rule_is_hr: {
      expression: "includes(user.roles, 'Admin') || includes(user.roles, 'HR_Manager')",
      errorMessage: 'Akses ditolak: khusus HR.'
    }
  };

  bp.pages[homeId] = {
    settings: { title: 'Dashboard', route: '/dashboard', requireAuth: true, allowedRoles: [] },
    layout: { type: 'GRID', config: { columns: 12, rowGap: '16px', colGap: '16px', maxWidth: '1080px' } },
    components: [
      {
        id: 'comp_welcome', type: 'HEADING', layoutGrid: { row: 1, col: 1, colSpan: 12 },
        properties: { level: 2, textExpression: "'Halo, ' + coalesce(user.email, 'tamu')" }
      },
      {
        id: 'comp_kpi_count', type: 'KPI_CARD', layoutGrid: { row: 2, col: 1, colSpan: 4 },
        properties: { label: 'Jumlah Karyawan', valueExpression: 'count(coalesce(state.employees_raw, []))' }
      },
      {
        id: 'comp_kpi_payroll', type: 'KPI_CARD', layoutGrid: { row: 2, col: 5, colSpan: 4 },
        properties: { label: 'Total Payroll', valueExpression: "isEmpty(state.employees_raw) ? '—' : formatIDR(sum(pluck(state.employees_raw, 'salary')))" },
        rules: { visibility: { condition: "includes(user.roles, 'Admin') || includes(user.roles, 'HR_Manager')" } }
      },
      {
        id: 'comp_kpi_role', type: 'KPI_CARD', layoutGrid: { row: 2, col: 9, colSpan: 4 },
        properties: { label: 'Peran Anda', valueExpression: "join(user.roles, ', ')" }
      },
      {
        id: 'comp_btn_refresh', type: 'BUTTON', layoutGrid: { row: 3, col: 1, colSpan: 3 },
        properties: { label: 'Muat Data Karyawan', variant: 'secondary' },
        services: { onClick: { action: 'srv_fetch_employees', resultKey: 'employees_raw', inputs: {} } },
        rules: { visibility: { condition: "includes(user.roles, 'Admin') || includes(user.roles, 'HR_Manager')" } }
      },
      {
        id: 'comp_tbl_employees', type: 'DATA_TABLE', layoutGrid: { row: 4, col: 1, colSpan: 12 },
        properties: {
          title: 'Daftar Karyawan',
          rowsExpression: 'coalesce(state.employees_raw, [])',
          columns: [
            { key: 'name', label: 'Nama' },
            { key: 'division', label: 'Divisi' },
            { key: 'salary', label: 'Gaji (IDR)' }
          ],
          emptyText: 'Klik "Muat Data Karyawan" untuk mengambil data.'
        },
        rules: { visibility: { condition: "includes(user.roles, 'Admin') || includes(user.roles, 'HR_Manager')" } }
      }
    ]
  };

  const requestPageId = 'pg_requests';
  bp.pages[requestPageId] = {
    settings: { title: 'Pengajuan', route: '/requests', requireAuth: true, allowedRoles: [] },
    layout: { type: 'GRID', config: { columns: 12, rowGap: '16px', colGap: '16px', maxWidth: '860px' } },
    components: [
      {
        id: 'comp_req_title', type: 'HEADING', layoutGrid: { row: 1, col: 1, colSpan: 12 },
        properties: { text: 'Form Pengajuan Reimbursement', level: 2 }
      },
      {
        id: 'comp_input_amount', type: 'FORM_INPUT_NUMBER', layoutGrid: { row: 2, col: 1, colSpan: 6 },
        properties: { label: 'Nominal (IDR)', placeholder: 'cth. 150000', defaultValue: 0 },
        rules: {
          validation: [
            { trigger: 'onChange', condition: 'self.value > 0', errorMessage: 'Nominal harus lebih besar dari 0.' },
            { trigger: 'onChange', condition: 'self.value <= 50000000', errorMessage: 'Maksimal Rp 50.000.000.' }
          ]
        }
      },
      {
        id: 'comp_input_reason', type: 'FORM_INPUT_TEXT', layoutGrid: { row: 2, col: 7, colSpan: 6 },
        properties: { label: 'Keterangan', placeholder: 'Tujuan pengeluaran…', defaultValue: '' },
        rules: {
          validation: [{ trigger: 'onBlur', condition: 'len(string(self.value)) >= 5', errorMessage: 'Keterangan minimal 5 karakter.' }]
        }
      },
      {
        id: 'comp_chk_confirm', type: 'FORM_CHECKBOX', layoutGrid: { row: 3, col: 1, colSpan: 12 },
        properties: { label: 'Saya menyatakan data ini benar', defaultValue: false },
        rules: {
          validation: [{ trigger: 'onChange', condition: 'self.value === true', errorMessage: 'Wajib dicentang sebelum mengirim.' }]
        }
      },
      {
        id: 'comp_btn_submit', type: 'BUTTON', layoutGrid: { row: 4, col: 1, colSpan: 3 },
        properties: { label: 'Kirim Pengajuan', variant: 'primary' },
        services: {
          onClick: {
            action: 'srv_submit_request',
            validateFirst: true,
            successMessage: 'Pengajuan terkirim!',
            resultKey: 'last_submit',
            inputs: {
              amount: 'comp_input_amount.value',
              reason: 'comp_input_reason.value',
              email: 'user.email'
            }
          }
        }
      },
      {
        id: 'comp_req_note', type: 'TEXT', layoutGrid: { row: 5, col: 1, colSpan: 12 },
        properties: { text: 'Pengajuan akan dicatat atas email Anda (data boundary: owner_email) dan diverifikasi HR.' }
      }
    ]
  };

  const dataPageId = 'pg_data_management';
  bp.pages[dataPageId] = {
    settings: { title: 'Manajemen Data', route: '/data', requireAuth: true, allowedRoles: [] },
    layout: { type: 'GRID', config: { columns: 12, rowGap: '16px', colGap: '16px', maxWidth: '1080px' } },
    components: [
      {
        id: 'comp_data_title', type: 'HEADING', layoutGrid: { row: 1, col: 1, colSpan: 12 },
        properties: { text: 'Data Karyawan (CRUD lengkap)', level: 2 }
      },
      {
        id: 'comp_crud_karyawan', type: 'CRUD_TABLE', layoutGrid: { row: 2, col: 1, colSpan: 12 },
        properties: {
          title: 'Karyawan', dataSource: 'sheet',
          spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Karyawan', keyColumn: 'id',
          serviceRead: 'srv_crud_karyawan_read', serviceCreate: 'srv_crud_karyawan_create',
          serviceUpdate: 'srv_crud_karyawan_update', serviceDelete: 'srv_crud_karyawan_delete',
          columns: [
            { key: 'id', label: 'ID', type: 'text', editable: false, required: false, showInForm: false },
            { key: 'nama', label: 'Nama', type: 'text', editable: true, required: true, showInForm: true },
            { key: 'divisi', label: 'Divisi', type: 'select', editable: true, required: true, showInForm: true,
              options: [{ label: 'Finance', value: 'Finance' }, { label: 'IT', value: 'IT' }, { label: 'HR', value: 'HR' }] },
            { key: 'gaji', label: 'Gaji (IDR)', type: 'number', editable: true, required: true, showInForm: true }
          ],
          filters: [{ key: 'divisi', label: 'Divisi', type: 'select' }],
          searchable: true, allowAdd: true, allowEdit: true, allowDelete: true,
          emptyText: 'Belum ada data karyawan.'
        }
      },
      {
        id: 'comp_md_title', type: 'HEADING', layoutGrid: { row: 3, col: 1, colSpan: 12 },
        properties: { text: 'Proyek & Tugas (contoh master-detail)', level: 2 }
      },
      {
        id: 'comp_md_note', type: 'TEXT', layoutGrid: { row: 4, col: 1, colSpan: 12 },
        properties: { text: 'Klik salah satu baris proyek di bawah untuk memilihnya, lalu tambah/atur tugasnya pada tabel Tugas di bawahnya.' }
      },
      {
        id: 'comp_crud_proyek', type: 'CRUD_TABLE', layoutGrid: { row: 5, col: 1, colSpan: 12 },
        properties: {
          title: 'Proyek', dataSource: 'sheet',
          spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Proyek', keyColumn: 'id',
          serviceRead: 'srv_crud_proyek_read', serviceCreate: 'srv_crud_proyek_create',
          serviceUpdate: 'srv_crud_proyek_update', serviceDelete: 'srv_crud_proyek_delete',
          columns: [
            { key: 'id', label: 'ID', type: 'text', editable: false, required: false, showInForm: false },
            { key: 'nama_proyek', label: 'Nama Proyek', type: 'text', editable: true, required: true, showInForm: true },
            { key: 'status', label: 'Status', type: 'select', editable: true, required: true, showInForm: true,
              options: [{ label: 'Berjalan', value: 'Berjalan' }, { label: 'Selesai', value: 'Selesai' }, { label: 'Ditunda', value: 'Ditunda' }] },
            { key: 'status_tugas', label: 'Progres Tugas', type: 'rollup',
              rollup: {
                fromComponentId: 'comp_crud_tugas', matchColumn: 'proyek_id', statusColumn: 'selesai', doneValue: 'Ya',
                doneLabel: 'Semua tugas selesai', doneColor: 'ok',
                pendingLabel: 'Masih berjalan', pendingColor: 'warn',
                emptyLabel: 'Belum ada tugas', emptyColor: 'dim'
              } }
          ],
          filters: [{ key: 'status', label: 'Status', type: 'select' }],
          searchable: true, allowAdd: true, allowEdit: true, allowDelete: true,
          emptyText: 'Belum ada proyek.'
        }
      },
      {
        id: 'comp_crud_tugas', type: 'CRUD_TABLE', layoutGrid: { row: 6, col: 1, colSpan: 12 },
        properties: {
          title: 'Tugas Proyek Terpilih', dataSource: 'sheet',
          spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Tugas', keyColumn: 'id',
          serviceRead: 'srv_crud_tugas_read', serviceCreate: 'srv_crud_tugas_create',
          serviceUpdate: 'srv_crud_tugas_update', serviceDelete: 'srv_crud_tugas_delete',
          columns: [
            { key: 'id', label: 'ID', type: 'text', editable: false, required: false, showInForm: false },
            { key: 'proyek_id', label: 'ID Proyek', type: 'text', editable: false, required: false, showInForm: false },
            { key: 'nama_tugas', label: 'Nama Tugas', type: 'text', editable: true, required: true, showInForm: true },
            { key: 'selesai', label: 'Selesai?', type: 'select', editable: true, required: true, showInForm: true,
              options: [{ label: 'Ya', value: 'Ya' }, { label: 'Tidak', value: 'Tidak' }] }
          ],
          filters: [],
          searchable: true, allowAdd: true, allowEdit: true, allowDelete: true,
          emptyText: 'Pilih baris pada tabel Proyek di atas untuk melihat & menambah tugasnya.',
          relatedTo: { parentComponentId: 'comp_crud_proyek', parentKeyColumn: 'id', childForeignKeyColumn: 'proyek_id' }
        }
      }
    ]
  };

  const addressPageId = 'pg_address_form';
  bp.pages[addressPageId] = {
    settings: { title: 'Formulir Alamat', route: '/alamat', requireAuth: true, allowedRoles: [] },
    layout: { type: 'GRID', config: { columns: 12, rowGap: '16px', colGap: '16px', maxWidth: '760px' } },
    components: [
      {
        id: 'comp_addr_title', type: 'HEADING', layoutGrid: { row: 1, col: 1, colSpan: 12 },
        properties: { text: 'Contoh Dropdown Bertingkat & Bisa Dicari', level: 2 }
      },
      {
        id: 'comp_addr_note', type: 'TEXT', layoutGrid: { row: 2, col: 1, colSpan: 12 },
        properties: { text: 'Pilih Provinsi dulu — pilihan Kabupaten/Kota akan menyesuaikan otomatis dan ketikan bisa dipakai untuk mencari.' }
      },
      {
        id: 'comp_provinsi', type: 'FORM_SELECT', layoutGrid: { row: 3, col: 1, colSpan: 6 },
        properties: {
          label: 'Provinsi', placeholder: 'Cari provinsi...', searchable: true,
          options: [{ label: 'Jawa Barat', value: 'jabar' }, { label: 'Jawa Timur', value: 'jatim' }, { label: 'DKI Jakarta', value: 'dki' }]
        },
        rules: { validation: [{ trigger: 'onChange', condition: 'self.value !== null', errorMessage: 'Pilih provinsi terlebih dahulu.' }] }
      },
      {
        id: 'comp_kabupaten', type: 'FORM_SELECT', layoutGrid: { row: 3, col: 7, colSpan: 6 },
        properties: {
          label: 'Kabupaten/Kota', placeholder: 'Cari kabupaten/kota...', searchable: true, dependsOn: 'comp_provinsi',
          optionsExpression: "pluck(whereEquals([" +
            "{nama:'Bandung',provinsi_id:'jabar'},{nama:'Bekasi',provinsi_id:'jabar'},{nama:'Cimahi',provinsi_id:'jabar'}," +
            "{nama:'Surabaya',provinsi_id:'jatim'},{nama:'Malang',provinsi_id:'jatim'}," +
            "{nama:'Jakarta Selatan',provinsi_id:'dki'},{nama:'Jakarta Pusat',provinsi_id:'dki'}" +
            "], 'provinsi_id', comp_provinsi.value), 'nama')"
        },
        rules: { validation: [{ trigger: 'onChange', condition: 'self.value !== null', errorMessage: 'Pilih kabupaten/kota.' }] }
      },
      {
        id: 'comp_addr_summary', type: 'TEXT', layoutGrid: { row: 4, col: 1, colSpan: 12 },
        properties: { textExpression: "isEmpty(coalesce(comp_kabupaten.value, '')) ? 'Belum lengkap.' : 'Alamat dipilih: ' + comp_kabupaten.value + ', ' + comp_provinsi.value" }
      }
    ]
  };

  const posPageId = 'pg_pos';
  bp.pages[posPageId] = {
    settings: { title: 'Kasir POS', route: '/pos', requireAuth: true, allowedRoles: [] },
    layout: { type: 'GRID', config: { columns: 12, rowGap: '16px', colGap: '16px', maxWidth: '1080px' } },
    components: [
      {
        id: 'comp_pos_title', type: 'HEADING', layoutGrid: { row: 1, col: 1, colSpan: 12 },
        properties: { text: 'Kasir — Point of Sale', level: 2 }
      },
      {
        id: 'comp_crud_produk', type: 'CRUD_TABLE', layoutGrid: { row: 2, col: 1, colSpan: 12 },
        properties: {
          title: 'Produk', dataSource: 'sheet',
          spreadsheetId: 'PASTE_SPREADSHEET_ID_HERE', sheet: 'Produk', keyColumn: 'id',
          serviceRead: 'srv_produk_read', serviceCreate: 'srv_produk_create',
          serviceUpdate: 'srv_produk_update', serviceDelete: 'srv_produk_delete',
          columns: [
            { key: 'id', label: 'ID', type: 'text', editable: false, required: false, showInForm: false },
            { key: 'foto', label: 'Foto', type: 'image', uploadService: 'srv_produk_upload', maxSizeMB: 5, showInForm: true },
            { key: 'nama', label: 'Nama', type: 'text', editable: true, required: true, showInForm: true },
            { key: 'kategori', label: 'Kategori', type: 'select', editable: true, required: true, showInForm: true,
              options: [{ label: 'Minuman', value: 'Minuman' }, { label: 'Makanan', value: 'Makanan' }, { label: 'Snack', value: 'Snack' }] },
            { key: 'harga', label: 'Harga (IDR)', type: 'number', editable: true, required: true, showInForm: true }
          ],
          filters: [{ key: 'kategori', label: 'Kategori', type: 'select' }],
          searchable: true, allowAdd: true, allowEdit: true, allowDelete: true,
          emptyText: 'Belum ada produk.'
        }
      },
      {
        id: 'comp_cart_title', type: 'HEADING', layoutGrid: { row: 3, col: 1, colSpan: 12 },
        properties: { text: 'Keranjang', level: 2 }
      },
      {
        id: 'comp_cart_note', type: 'TEXT', layoutGrid: { row: 4, col: 1, colSpan: 12 },
        properties: { text: 'Klik "+ Tambah" dan isi sesuai produk yang dipilih dari daftar Produk di atas (harga per satuan, bukan subtotal — subtotal dihitung otomatis).' }
      },
      {
        id: 'comp_cart', type: 'CRUD_TABLE', layoutGrid: { row: 5, col: 1, colSpan: 12 },
        properties: {
          title: 'Keranjang Belanja', dataSource: 'local', localKey: 'cart',
          columns: [
            { key: 'nama', label: 'Item', type: 'text', editable: true, required: true, showInForm: true },
            { key: 'qty', label: 'Qty', type: 'number', editable: true, required: true, showInForm: true, defaultValue: 1 },
            { key: 'harga', label: 'Harga Satuan', type: 'number', editable: true, required: true, showInForm: true },
            { key: 'subtotal', label: 'Subtotal', type: 'computed', valueExpression: 'formatIDR(row.qty * row.harga)' }
          ],
          searchable: false, allowAdd: true, allowEdit: true, allowDelete: true,
          emptyText: 'Keranjang masih kosong.'
        }
      },
      {
        id: 'comp_cart_total', type: 'KPI_CARD', layoutGrid: { row: 6, col: 1, colSpan: 4 },
        properties: { label: 'Total Belanja', valueExpression: "formatIDR(sumProduct(coalesce(state.cart, []), 'qty', 'harga'))" }
      },
      {
        id: 'comp_print_receipt', type: 'PRINT_BUTTON', layoutGrid: { row: 6, col: 5, colSpan: 4 },
        properties: {
          label: '🖨 Cetak Struk', title: 'Struk Pembelian',
          htmlTemplate: '<h3>Struk Pembelian</h3>' +
            '<p>Kasir: {{coalesce(user.email, \'-\')}}<br>Tanggal: {{now()}}</p>' +
            '{{items_table}}' +
            '<p style="margin-top:10px"><b>Total: {{formatIDR(sumProduct(coalesce(state.cart, []), \'qty\', \'harga\'))}}</b></p>',
          itemsExpression: 'coalesce(state.cart, [])',
          itemColumns: [{ key: 'nama', label: 'Item' }, { key: 'qty', label: 'Qty' }, { key: 'harga', label: 'Harga' }],
          pdfExportService: 'srv_pos_pdf'
        }
      },
      {
        id: 'comp_sales_title', type: 'HEADING', layoutGrid: { row: 7, col: 1, colSpan: 12 },
        properties: { text: 'Laporan Penjualan', level: 2 }
      },
      {
        id: 'comp_sales_chart', type: 'CHART', layoutGrid: { row: 8, col: 1, colSpan: 12 },
        properties: {
          title: 'Penjualan per Kategori (Bulan Ini)', chartType: 'bar',
          labelsExpression: "pluck(groupBySum(coalesce(state.sales_report, []), 'kategori', 'total'), 'key')",
          valuesExpression: "pluck(groupBySum(coalesce(state.sales_report, []), 'kategori', 'total'), 'total')"
        },
        services: { onLoad: { action: 'srv_sales_report', resultKey: 'sales_report', inputs: {} } }
      }
    ]
  };

  // Explicit sidebar menu: flat pages plus a group, demonstrating icons and grouping.
  // (Leaving bp.menu empty would still work — the runtime falls back to a flat page list.)
  bp.menu = [
    { id: Blueprint.uid('mi'), type: 'page', label: 'Dashboard', icon: '🏠', pageId: homeId, allowedRoles: [] },
    { id: Blueprint.uid('mi'), type: 'page', label: 'Pengajuan', icon: '📝', pageId: requestPageId, allowedRoles: [] },
    { id: Blueprint.uid('mi'), type: 'page', label: 'Kasir POS', icon: '🧾', pageId: posPageId, allowedRoles: [] },
    { id: Blueprint.uid('mi'), type: 'divider' },
    { id: Blueprint.uid('mi'), type: 'group', label: 'Data', icon: '📁', allowedRoles: [], children: [
      { id: Blueprint.uid('mi'), type: 'page', label: 'Manajemen Data', icon: '📊', pageId: dataPageId, allowedRoles: [] },
      { id: Blueprint.uid('mi'), type: 'page', label: 'Formulir Alamat', icon: '📍', pageId: addressPageId, allowedRoles: [] }
    ] }
  ];

  bp.meta.globalSettings.homePage = homeId;
  return bp;
}
