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
    }
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
        id: 'comp_welcome', type: 'HEADING', layoutGrid: { xs: 12, md: 12 },
        properties: { level: 2, textExpression: "'Halo, ' + coalesce(user.email, 'tamu')" }
      },
      {
        id: 'comp_kpi_count', type: 'KPI_CARD', layoutGrid: { xs: 12, md: 4 },
        properties: { label: 'Jumlah Karyawan', valueExpression: 'count(coalesce(state.employees_raw, []))' }
      },
      {
        id: 'comp_kpi_payroll', type: 'KPI_CARD', layoutGrid: { xs: 12, md: 4 },
        properties: { label: 'Total Payroll', valueExpression: "isEmpty(state.employees_raw) ? '—' : formatIDR(sum(pluck(state.employees_raw, 'salary')))" },
        rules: { visibility: { condition: "includes(user.roles, 'Admin') || includes(user.roles, 'HR_Manager')" } }
      },
      {
        id: 'comp_kpi_role', type: 'KPI_CARD', layoutGrid: { xs: 12, md: 4 },
        properties: { label: 'Peran Anda', valueExpression: "join(user.roles, ', ')" }
      },
      {
        id: 'comp_btn_refresh', type: 'BUTTON', layoutGrid: { xs: 12, md: 3 },
        properties: { label: 'Muat Data Karyawan', variant: 'secondary' },
        services: { onClick: { action: 'srv_fetch_employees', resultKey: 'employees_raw', inputs: {} } },
        rules: { visibility: { condition: "includes(user.roles, 'Admin') || includes(user.roles, 'HR_Manager')" } }
      },
      {
        id: 'comp_tbl_employees', type: 'DATA_TABLE', layoutGrid: { xs: 12, md: 12 },
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
        id: 'comp_req_title', type: 'HEADING', layoutGrid: { xs: 12, md: 12 },
        properties: { text: 'Form Pengajuan Reimbursement', level: 2 }
      },
      {
        id: 'comp_input_amount', type: 'FORM_INPUT_NUMBER', layoutGrid: { xs: 12, md: 6 },
        properties: { label: 'Nominal (IDR)', placeholder: 'cth. 150000', defaultValue: 0 },
        rules: {
          validation: [
            { trigger: 'onChange', condition: 'self.value > 0', errorMessage: 'Nominal harus lebih besar dari 0.' },
            { trigger: 'onChange', condition: 'self.value <= 50000000', errorMessage: 'Maksimal Rp 50.000.000.' }
          ]
        }
      },
      {
        id: 'comp_input_reason', type: 'FORM_INPUT_TEXT', layoutGrid: { xs: 12, md: 6 },
        properties: { label: 'Keterangan', placeholder: 'Tujuan pengeluaran…', defaultValue: '' },
        rules: {
          validation: [{ trigger: 'onBlur', condition: 'len(string(self.value)) >= 5', errorMessage: 'Keterangan minimal 5 karakter.' }]
        }
      },
      {
        id: 'comp_chk_confirm', type: 'FORM_CHECKBOX', layoutGrid: { xs: 12, md: 12 },
        properties: { label: 'Saya menyatakan data ini benar', defaultValue: false },
        rules: {
          validation: [{ trigger: 'onChange', condition: 'self.value === true', errorMessage: 'Wajib dicentang sebelum mengirim.' }]
        }
      },
      {
        id: 'comp_btn_submit', type: 'BUTTON', layoutGrid: { xs: 12, md: 3 },
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
        id: 'comp_req_note', type: 'TEXT', layoutGrid: { xs: 12, md: 12 },
        properties: { text: 'Pengajuan akan dicatat atas email Anda (data boundary: owner_email) dan diverifikasi HR.' }
      }
    ]
  };

  bp.meta.globalSettings.homePage = homeId;
  return bp;
}
