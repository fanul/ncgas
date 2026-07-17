<script setup>
/**
 * CRUD Table wizard — the Inspector section for CRUD_TABLE components.
 *
 * Flow: filter -> read -> add -> edit -> delete, matching how BPJS-style
 * admin tools actually get built. "Sumber Data: Google Sheet" auto-generates
 * the four backing services (SHEET_READ/APPEND/UPDATE/DELETE) and column
 * schema from the sheet's real headers when hosted on Apps Script; local dev
 * falls back to typing headers manually since there's no real Sheet to probe.
 *
 * Master-detail: any other CRUD_TABLE component (any page — runtime state
 * persists across navigation) can be picked as the parent; the child then
 * auto-scopes its rows to the parent's selected row and pre-fills the
 * foreign key on new records.
 */
import { computed, ref } from 'vue';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';
import { api, NCGASApiError } from '../rpc/adapter.js';
import { Blueprint } from '../engine.js';
import { FieldText, FieldBoolean, FieldSelect, FieldExpression } from './fields.js';

const props = defineProps({ comp: { type: Object, required: true } });
const engine = useNoCodeEngine();
const { state } = engine;
const bp = computed(() => state.blueprint);
const p = computed(() => props.comp.properties);

function touch() { state.dirty = true; state.previewNonce++; }

// ------------------------------------------------------------- connection --

const connectionState = ref('idle'); // idle | testing | connected | error
const connectionError = ref('');
const discoveredSheets = ref([]);
const manualHeadersText = ref('');

function humanize(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function applyHeaders(headers) {
  if (!headers || !headers.length) return;
  const existing = {};
  (p.value.columns || []).forEach((c) => { existing[c.key] = c; });
  p.value.columns = headers.map((h) => existing[h] || {
    key: h, label: humanize(h), type: 'text', editable: true, required: false, showInForm: true
  });
  if (!p.value.keyColumn || headers.indexOf(p.value.keyColumn) === -1) {
    p.value.keyColumn = headers.find((h) => h.toLowerCase() === 'id') || headers[0];
  }
  touch();
}

async function testConnection() {
  if (!p.value.spreadsheetId?.trim()) { engine.toast('error', 'Isi Spreadsheet ID dulu.'); return; }
  connectionState.value = 'testing';
  connectionError.value = '';
  try {
    const result = await api('inspectSheet', { spreadsheetId: p.value.spreadsheetId.trim() });
    discoveredSheets.value = result.sheets;
    connectionState.value = 'connected';
    if (!p.value.sheet || !result.sheets.some((s) => s.name === p.value.sheet)) {
      p.value.sheet = result.sheets[0]?.name || '';
    }
    const found = result.sheets.find((s) => s.name === p.value.sheet);
    applyHeaders(found?.headers || []);
  } catch (e) {
    connectionState.value = 'error';
    connectionError.value = e instanceof NCGASApiError ? e.message : String(e.message || e);
  }
}

function onPickDiscoveredSheet(name) {
  p.value.sheet = name;
  const found = discoveredSheets.value.find((s) => s.name === name);
  applyHeaders(found?.headers || []);
  touch();
}

function applyManualHeaders() {
  const headers = manualHeadersText.value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!headers.length) { engine.toast('error', 'Tulis minimal satu nama kolom, dipisah koma.'); return; }
  applyHeaders(headers);
  engine.toast('success', `${headers.length} kolom diterapkan.`);
}

// -------------------------------------------------------------- services --

function generateCrudServices() {
  if (!p.value.spreadsheetId?.trim() || !p.value.sheet?.trim() || !p.value.keyColumn) {
    engine.toast('error', 'Lengkapi Spreadsheet ID, nama sheet, dan kolom kunci terlebih dahulu.');
    return;
  }
  const base = props.comp.id.replace(/^comp_/, 'srv_');
  const ids = {
    read: p.value.serviceRead || `${base}_read`,
    create: p.value.serviceCreate || `${base}_create`,
    update: p.value.serviceUpdate || `${base}_update`,
    delete: p.value.serviceDelete || `${base}_delete`
  };
  const existingRead = bp.value.sharedServices[ids.read];
  bp.value.sharedServices[ids.read] = {
    type: 'SHEET_READ', spreadsheetId: p.value.spreadsheetId.trim(), sheet: p.value.sheet.trim(),
    cachePolicy: '', allowedRoles: [], dataBoundary: null,
    mockResult: existingRead?.mockResult ?? []
  };
  bp.value.sharedServices[ids.create] = {
    type: 'SHEET_APPEND', spreadsheetId: p.value.spreadsheetId.trim(), sheet: p.value.sheet.trim(), keyColumn: p.value.keyColumn,
    allowedRoles: [], dataBoundary: null, mockResult: { appended: 1 }
  };
  bp.value.sharedServices[ids.update] = {
    type: 'SHEET_UPDATE', spreadsheetId: p.value.spreadsheetId.trim(), sheet: p.value.sheet.trim(), keyColumn: p.value.keyColumn,
    allowedRoles: [], dataBoundary: null, mockResult: { updated: 1 }
  };
  bp.value.sharedServices[ids.delete] = {
    type: 'SHEET_DELETE', spreadsheetId: p.value.spreadsheetId.trim(), sheet: p.value.sheet.trim(), keyColumn: p.value.keyColumn,
    allowedRoles: [], dataBoundary: null, mockResult: { deleted: 1 }
  };
  p.value.serviceRead = ids.read;
  p.value.serviceCreate = ids.create;
  p.value.serviceUpdate = ids.update;
  p.value.serviceDelete = ids.delete;
  touch();
  engine.toast('success', 'Layanan CRUD dibuat/diperbarui (lihat & atur mockResult di panel Shared Services).');
}

const servicesReady = computed(() => !!(p.value.serviceRead && p.value.serviceCreate && p.value.serviceUpdate && p.value.serviceDelete));

// -------------------------------------------------------------- columns --

function addColumn() {
  let i = 1;
  while ((p.value.columns || []).some((c) => c.key === 'kolom_' + i)) i++;
  p.value.columns = [...(p.value.columns || []), { key: 'kolom_' + i, label: 'Kolom ' + i, type: 'text', editable: true, required: false, showInForm: true }];
  touch();
}
function removeColumn(key) {
  p.value.columns = p.value.columns.filter((c) => c.key !== key);
  touch();
}
function onColumnTypeChange(col, newType) {
  col.type = newType;
  if (newType === 'rollup' && !col.rollup) {
    col.rollup = {
      fromComponentId: otherCrudTables.value[0]?.id || '', matchColumn: '', statusColumn: '',
      doneValue: 'Ya', doneLabel: 'Selesai', doneColor: 'ok',
      pendingLabel: 'Berjalan', pendingColor: 'warn',
      emptyLabel: '—', emptyColor: 'dim'
    };
  }
  if (newType === 'computed' && !col.valueExpression) {
    col.valueExpression = 'row.' + col.key;
  }
  touch();
}
function columnsOf(componentId) {
  return findComponentById(componentId)?.properties?.columns || [];
}

// --------------------------------------------------------------- filters --

function addFilter() {
  const first = p.value.columns?.[0];
  if (!first) { engine.toast('error', 'Tambahkan kolom terlebih dahulu.'); return; }
  p.value.filters = [...(p.value.filters || []), { key: first.key, label: first.label, type: 'text' }];
  touch();
}
function removeFilter(i) {
  p.value.filters = p.value.filters.filter((_, idx) => idx !== i);
  touch();
}

// ---------------------------------------------------------- master-detail --

function allPageComponents() {
  const list = [];
  Object.entries(bp.value?.pages || {}).forEach(([pageId, pg]) => {
    pg.components.forEach((c) => list.push({ ...c, pageId }));
  });
  return list;
}
const otherCrudTables = computed(() => allPageComponents().filter((c) => c.type === 'CRUD_TABLE' && c.id !== props.comp.id));
function findComponentById(id) {
  return allPageComponents().find((c) => c.id === id) || null;
}
const parentColumns = computed(() => {
  if (!p.value.relatedTo) return [];
  return findComponentById(p.value.relatedTo.parentComponentId)?.properties?.columns || [];
});

function toggleRelatedTo(on) {
  if (on) {
    p.value.relatedTo = { parentComponentId: otherCrudTables.value[0]?.id || '', parentKeyColumn: '', childForeignKeyColumn: p.value.columns?.[0]?.key || '' };
  } else {
    p.value.relatedTo = null;
  }
  touch();
}
</script>

<template>
  <div class="ed-section">
    <div class="ed-section-title">Sumber Data</div>
    <FieldSelect
      :model-value="p.dataSource"
      :options="[
        { label: 'Google Sheet (CRUD otomatis)', value: 'sheet' },
        { label: 'Lokal — sementara di memori, tanpa Sheet (cth. keranjang POS)', value: 'local' },
        { label: 'Expression (tampilan saja)', value: 'expression' }
      ]"
      @update:model-value="p.dataSource = $event; touch()"
    />
  </div>

  <template v-if="p.dataSource === 'expression'">
    <div class="ed-section">
      <div class="ed-field">
        <label class="ed-field-label">Rows expression (array)</label>
        <FieldExpression :model-value="p.rowsExpression" @update:model-value="p.rowsExpression = $event; touch()" />
      </div>
    </div>
  </template>

  <template v-else>
    <div class="ed-section" v-if="p.dataSource === 'sheet'">
      <div class="ed-field">
        <label class="ed-field-label">Spreadsheet ID</label>
        <FieldText :model-value="p.spreadsheetId" placeholder="tempel ID dari URL spreadsheet"
                   @update:model-value="p.spreadsheetId = $event; touch()" />
      </div>
      <div class="ed-row2">
        <div class="ed-field">
          <label class="ed-field-label">Nama Sheet</label>
          <FieldText :model-value="p.sheet" placeholder="cth. Karyawan" @update:model-value="p.sheet = $event; touch()" />
        </div>
        <div class="ed-field" style="align-self:end">
          <button class="ed-btn ed-btn-ghost" :disabled="connectionState === 'testing'" @click="testConnection">
            {{ connectionState === 'testing' ? 'Menguji…' : '🔌 Tes Koneksi' }}
          </button>
        </div>
      </div>

      <div v-if="connectionState === 'connected'" class="ed-hint-ok">
        ✓ Terhubung. {{ discoveredSheets.length }} sheet ditemukan.
        <select class="ed-input" style="margin-top:6px" :value="p.sheet" @change="onPickDiscoveredSheet($event.target.value)">
          <option v-for="s in discoveredSheets" :key="s.name" :value="s.name">{{ s.name }} ({{ s.rowCount }} baris)</option>
        </select>
      </div>
      <div v-else-if="connectionState === 'error'" class="ed-expr-err">{{ connectionError }}</div>

      <div class="ed-field" style="margin-top:10px">
        <label class="ed-field-label">Atau tulis nama kolom manual (pisahkan koma) — untuk local dev / tanpa tes koneksi</label>
        <div class="ed-kv-tight">
          <input class="ed-input" v-model="manualHeadersText" placeholder="id, nama, divisi, gaji" @keydown.enter="applyManualHeaders" />
          <button class="ed-btn ed-btn-ghost" @click="applyManualHeaders">Terapkan</button>
        </div>
      </div>
    </div>

    <div class="ed-section" v-if="p.dataSource === 'local'">
      <div class="ed-field">
        <label class="ed-field-label">Kunci state (nama array di state, cth. "cart")</label>
        <FieldText :model-value="p.localKey" placeholder="cart" @update:model-value="p.localKey = $event; touch()" />
      </div>
      <p class="ed-hint">Data disimpan sementara di <span class="ed-mono">state.{{ p.localKey || '...' }}</span> selama sesi berjalan — hilang saat halaman dimuat ulang. Cocok untuk keranjang belanja sebelum checkout.</p>
      <div class="ed-field">
        <label class="ed-field-label">Tulis nama kolom (pisahkan koma)</label>
        <div class="ed-kv-tight">
          <input class="ed-input" v-model="manualHeadersText" placeholder="product_id, nama, qty, harga" @keydown.enter="applyManualHeaders" />
          <button class="ed-btn ed-btn-ghost" @click="applyManualHeaders">Terapkan</button>
        </div>
      </div>
    </div>

    <div class="ed-section" v-if="p.columns.length">
      <div class="ed-section-title">Kolom{{ p.dataSource === 'sheet' ? ' & Kunci' : '' }}</div>
      <div class="ed-field" v-if="p.dataSource === 'sheet'">
        <label class="ed-field-label">Kolom Kunci (identitas unik baris)</label>
        <FieldSelect :model-value="p.keyColumn" :options="p.columns.map((c) => c.key)" @update:model-value="p.keyColumn = $event; touch()" />
      </div>
      <div v-for="col in p.columns" :key="col.key" class="ed-card">
        <div class="ed-kv-tight">
          <span class="ed-mono ed-dim">{{ col.key }}</span>
          <button class="ed-btn-icon is-danger" title="hapus kolom" @click="removeColumn(col.key)">✕</button>
        </div>
        <div class="ed-row2">
          <div class="ed-field">
            <label class="ed-field-label">Label</label>
            <FieldText :model-value="col.label" @update:model-value="col.label = $event; touch()" />
          </div>
          <div class="ed-field">
            <label class="ed-field-label">Tipe</label>
            <FieldSelect :model-value="col.type" :options="['text', 'number', 'date', 'select', 'rollup', 'computed', 'image']" @update:model-value="onColumnTypeChange(col, $event)" />
          </div>
        </div>

        <template v-if="col.type === 'computed'">
          <p class="ed-hint">Nilai dihitung ulang setiap render dari kolom lain di baris yang sama — tidak pernah disimpan.</p>
          <div class="ed-field">
            <label class="ed-field-label">Expression (gunakan "row.kolom_lain")</label>
            <FieldExpression :model-value="col.valueExpression" placeholder="row.qty * row.harga"
                             @update:model-value="col.valueExpression = $event; touch()" />
          </div>
        </template>
        <template v-else-if="col.type === 'image'">
          <p class="ed-hint">Tabel menampilkan thumbnail; kosongkan "Service upload" untuk menampilkan URL saja tanpa tombol unggah di form.</p>
          <div class="ed-row2">
            <div class="ed-field">
              <label class="ed-field-label">ID service DRIVE_UPLOAD (opsional)</label>
              <FieldText :model-value="col.uploadService" @update:model-value="col.uploadService = $event; touch()" />
            </div>
            <div class="ed-field">
              <label class="ed-field-label">Ukuran maksimum (MB)</label>
              <FieldText :model-value="String(col.maxSizeMB ?? 5)" @update:model-value="col.maxSizeMB = Number($event) || 5; touch()" />
            </div>
          </div>
        </template>
        <template v-else-if="col.type === 'rollup'">
          <p class="ed-hint">Kolom status otomatis: hijau jika SEMUA baris terkait di tabel lain sudah selesai.</p>
          <div class="ed-field">
            <label class="ed-field-label">Ambil dari tabel</label>
            <FieldSelect :model-value="col.rollup.fromComponentId"
                         :options="otherCrudTables.map((c) => ({ label: (c.properties.title || c.id) + ' (' + c.pageId + ')', value: c.id }))"
                         @update:model-value="col.rollup.fromComponentId = $event; touch()" />
          </div>
          <div class="ed-row2">
            <div class="ed-field">
              <label class="ed-field-label">Kolom relasi (di tabel tsb, cocok dengan {{ p.keyColumn || 'kolom kunci' }})</label>
              <FieldSelect :model-value="col.rollup.matchColumn" :options="columnsOf(col.rollup.fromComponentId).map((c) => c.key)"
                           @update:model-value="col.rollup.matchColumn = $event; touch()" />
            </div>
            <div class="ed-field">
              <label class="ed-field-label">Kolom status (di tabel tsb)</label>
              <FieldSelect :model-value="col.rollup.statusColumn" :options="columnsOf(col.rollup.fromComponentId).map((c) => c.key)"
                           @update:model-value="col.rollup.statusColumn = $event; touch()" />
            </div>
          </div>
          <div class="ed-field">
            <label class="ed-field-label">Nilai yang berarti "selesai"</label>
            <FieldText :model-value="col.rollup.doneValue" placeholder="cth. Ya" @update:model-value="col.rollup.doneValue = $event; touch()" />
          </div>
          <div class="ed-row2" v-for="pair in [['done','Selesai'],['pending','Berjalan'],['empty','Kosong']]" :key="pair[0]">
            <div class="ed-field">
              <label class="ed-field-label">Label ({{ pair[1] }})</label>
              <FieldText :model-value="col.rollup[pair[0] + 'Label']" @update:model-value="col.rollup[pair[0] + 'Label'] = $event; touch()" />
            </div>
            <div class="ed-field">
              <label class="ed-field-label">Warna</label>
              <FieldSelect :model-value="col.rollup[pair[0] + 'Color']" :options="['ok', 'warn', 'err', 'dim']"
                           @update:model-value="col.rollup[pair[0] + 'Color'] = $event; touch()" />
            </div>
          </div>
        </template>
        <div class="ed-checkrow" v-else>
          <label><input type="checkbox" :checked="col.editable !== false" @change="col.editable = $event.target.checked; touch()" /> Bisa diedit</label>
          <label><input type="checkbox" :checked="!!col.required" @change="col.required = $event.target.checked; touch()" /> Wajib</label>
          <label><input type="checkbox" :checked="col.showInForm !== false" @change="col.showInForm = $event.target.checked; touch()" /> Tampil di form</label>
        </div>
      </div>
      <button class="ed-btn ed-btn-ghost" @click="addColumn">+ Kolom manual</button>
    </div>

    <div class="ed-section" v-if="p.dataSource === 'sheet'">
      <button class="ed-btn" @click="generateCrudServices">
        {{ servicesReady ? '🔄 Perbarui Layanan CRUD' : '⚡ Buat Layanan CRUD' }}
      </button>
      <p class="ed-hint" v-if="servicesReady">
        Terhubung ke: <span class="ed-mono">{{ p.serviceRead }}</span>, <span class="ed-mono">{{ p.serviceCreate }}</span>,
        <span class="ed-mono">{{ p.serviceUpdate }}</span>, <span class="ed-mono">{{ p.serviceDelete }}</span>
      </p>
    </div>

    <div class="ed-section">
      <div class="ed-section-title">Aksi</div>
      <div class="ed-checkrow">
        <label><input type="checkbox" :checked="p.allowAdd !== false" @change="p.allowAdd = $event.target.checked; touch()" /> Tambah</label>
        <label><input type="checkbox" :checked="p.allowEdit !== false" @change="p.allowEdit = $event.target.checked; touch()" /> Ubah</label>
        <label><input type="checkbox" :checked="p.allowDelete !== false" @change="p.allowDelete = $event.target.checked; touch()" /> Hapus</label>
      </div>
    </div>

    <div class="ed-section">
      <div class="ed-section-title">Master-Detail</div>
      <div class="ed-field">
        <label class="ed-field-label">Hubungkan sebagai detail dari tabel induk</label>
        <FieldBoolean :model-value="!!p.relatedTo" @update:model-value="toggleRelatedTo" />
      </div>
      <template v-if="p.relatedTo">
        <div class="ed-field">
          <label class="ed-field-label">Tabel induk</label>
          <FieldSelect :model-value="p.relatedTo.parentComponentId"
                       :options="otherCrudTables.map((c) => ({ label: (c.properties.title || c.id) + ' (' + c.pageId + ')', value: c.id }))"
                       @update:model-value="p.relatedTo.parentComponentId = $event; touch()" />
        </div>
        <div class="ed-row2">
          <div class="ed-field">
            <label class="ed-field-label">Kolom kunci induk</label>
            <FieldSelect :model-value="p.relatedTo.parentKeyColumn" :options="parentColumns.map((c) => c.key)"
                         @update:model-value="p.relatedTo.parentKeyColumn = $event; touch()" />
          </div>
          <div class="ed-field">
            <label class="ed-field-label">Kolom foreign key (di tabel ini)</label>
            <FieldSelect :model-value="p.relatedTo.childForeignKeyColumn" :options="p.columns.map((c) => c.key)"
                         @update:model-value="p.relatedTo.childForeignKeyColumn = $event; touch()" />
          </div>
        </div>
        <p class="ed-hint">Klik baris pada tabel induk (di halaman manapun) untuk memilihnya sebagai konteks; tabel ini otomatis menampilkan & membatasi data pada baris tersebut.</p>
      </template>
    </div>
  </template>

  <div class="ed-section">
    <div class="ed-section-title">Pencarian & Tampilan</div>
    <div class="ed-field">
      <label class="ed-field-label">Judul tabel</label>
      <FieldText :model-value="p.title" @update:model-value="p.title = $event; touch()" />
    </div>
    <div class="ed-field">
      <label class="ed-field-label">Kotak pencarian bebas</label>
      <FieldBoolean :model-value="p.searchable !== false" @update:model-value="p.searchable = $event; touch()" />
    </div>
    <div v-for="(f, i) in p.filters" :key="i" class="ed-kv-tight">
      <select class="ed-input ed-mono" :value="f.key" @change="f.key = $event.target.value; touch()">
        <option v-for="c in p.columns" :key="c.key" :value="c.key">{{ c.key }}</option>
      </select>
      <select class="ed-input" :value="f.type" @change="f.type = $event.target.value; touch()">
        <option value="text">teks</option>
        <option value="select">pilihan</option>
      </select>
      <button class="ed-btn-icon is-danger" @click="removeFilter(i)">✕</button>
    </div>
    <button class="ed-btn ed-btn-ghost" @click="addFilter">+ Filter kolom</button>
    <div class="ed-field" style="margin-top:8px">
      <label class="ed-field-label">Teks saat data kosong</label>
      <FieldText :model-value="p.emptyText" @update:model-value="p.emptyText = $event; touch()" />
    </div>
  </div>
</template>
