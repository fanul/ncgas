<script setup>
/**
 * Inspector — right panel, three altitudes:
 *   component selected  -> Properties / Layout / Rules / Services (events)
 *   nothing selected    -> Page settings + App settings (RBAC, services, shared rules)
 * All edits mutate the reactive blueprint; structural ops go through engine.commit.
 */
import { computed, ref } from 'vue';
import { useNoCodeEngine } from '../store/useNoCodeEngine.js';
import { REGISTRY } from './registry.js';
import { FIELD_KINDS, FieldExpression, FieldText, FieldBoolean, FieldSelect, FieldJson } from './fields.js';
import { Blueprint } from '../engine.js';

const engine = useNoCodeEngine();
const { state } = engine;
const comp = engine.selectedComponent;

const def = computed(() => (comp.value ? REGISTRY[comp.value.type] : null));
const page = computed(() => state.blueprint?.pages?.[state.currentPageId]);
const bp = computed(() => state.blueprint);
const idDraft = ref(null);

// ------------------------------------------------ path get/set on component --
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let target = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (target[keys[i]] == null || typeof target[keys[i]] !== 'object') target[keys[i]] = {};
    target = target[keys[i]];
  }
  if (value === '' || value === undefined) delete target[keys[keys.length - 1]];
  else target[keys[keys.length - 1]] = value;
  state.dirty = true;
  state.previewNonce++;
}

// -------------------------------------------------------------- rules edits --
function validationRules() {
  return comp.value.rules?.validation || [];
}
function addValidationRule() {
  if (!comp.value.rules) comp.value.rules = {};
  if (!comp.value.rules.validation) comp.value.rules.validation = [];
  comp.value.rules.validation.push({ trigger: 'onChange', condition: 'self.value !== null', errorMessage: 'Wajib diisi.' });
  state.dirty = true; state.previewNonce++;
}
function removeValidationRule(i) {
  comp.value.rules.validation.splice(i, 1);
  state.dirty = true; state.previewNonce++;
}

// ------------------------------------------------------------ service edits --
const serviceIds = computed(() => Object.keys(bp.value?.sharedServices || {}));

function eventBinding(event) {
  return comp.value.services?.[event] || null;
}
function setEventAction(event, action) {
  if (!comp.value.services) comp.value.services = {};
  if (!action) { delete comp.value.services[event]; state.dirty = true; state.previewNonce++; return; }
  const existing = comp.value.services[event] || {};
  comp.value.services[event] = { inputs: {}, ...existing, action };
  if (action === 'NAVIGATE' ) comp.value.services[event].to = comp.value.services[event].to || Object.keys(bp.value.pages)[0];
  state.dirty = true; state.previewNonce++;
}
function bindingInputs(event) {
  return Object.entries(eventBinding(event)?.inputs || {});
}
function setBindingInput(event, key, expr) {
  const b = comp.value.services[event];
  if (!b.inputs) b.inputs = {};
  b.inputs[key] = expr;
  state.dirty = true; state.previewNonce++;
}
function renameBindingInput(event, oldKey, newKey) {
  const b = comp.value.services[event];
  if (!newKey || newKey === oldKey) return;
  b.inputs[newKey] = b.inputs[oldKey];
  delete b.inputs[oldKey];
  state.dirty = true; state.previewNonce++;
}
function removeBindingInput(event, key) {
  delete comp.value.services[event].inputs[key];
  state.dirty = true; state.previewNonce++;
}
function addBindingInput(event) {
  const b = comp.value.services[event];
  if (!b.inputs) b.inputs = {};
  let i = 1;
  while (b.inputs['field' + i] !== undefined) i++;
  b.inputs['field' + i] = comp.value.id + '.value';
  state.dirty = true; state.previewNonce++;
}

// -------------------------------------------------------- app-level editors --
const SERVICE_TYPE_OPTIONS = Blueprint.SERVICE_TYPES;

function addService() {
  let i = 1;
  while (bp.value.sharedServices['srv_service_' + i]) i++;
  bp.value.sharedServices['srv_service_' + i] = {
    type: 'GAS_RPC', functionName: 'myFunction', cachePolicy: '', allowedRoles: [], mockResult: null
  };
  state.dirty = true;
}
function removeService(id) {
  delete bp.value.sharedServices[id];
  state.dirty = true;
}
function renameService(oldId, newId) {
  if (!/^srv_[a-z0-9_]+$/.test(newId)) { engine.toast('error', 'ID service harus srv_[a-z0-9_]+'); return; }
  if (newId !== oldId && bp.value.sharedServices[newId]) { engine.toast('error', 'ID sudah dipakai.'); return; }
  bp.value.sharedServices[newId] = bp.value.sharedServices[oldId];
  delete bp.value.sharedServices[oldId];
  engine.toast('info', `Binding komponen yang memakai ${oldId} perlu diarahkan ulang.`);
  state.dirty = true;
}

function addSharedRule() {
  let i = 1;
  while (bp.value.sharedRules['rule_custom_' + i]) i++;
  bp.value.sharedRules['rule_custom_' + i] = { expression: 'true', errorMessage: 'Akses ditolak.' };
  state.dirty = true;
}
function removeSharedRule(id) {
  delete bp.value.sharedRules[id];
  state.dirty = true;
}

const rolesText = computed({
  get: () => (bp.value?.rbac?.roles || []).join(', '),
  set: (v) => {
    bp.value.rbac.roles = v.split(',').map((s) => s.trim()).filter(Boolean);
    state.dirty = true;
  }
});

function applyRename() {
  if (idDraft.value && idDraft.value !== comp.value.id) engine.renameComponent(comp.value.id, idDraft.value);
  idDraft.value = null;
}
</script>

<template>
  <aside class="ed-inspector">
    <!-- ============================== COMPONENT ============================== -->
    <template v-if="comp && def">
      <div class="ed-panel-title ed-insp-head">
        <span>{{ def.label }}</span>
        <span class="ed-insp-actions">
          <button class="ed-btn-icon" title="naik" @click="engine.moveComponent(comp.id, -1)">↑</button>
          <button class="ed-btn-icon" title="turun" @click="engine.moveComponent(comp.id, 1)">↓</button>
          <button class="ed-btn-icon" title="duplikat" @click="engine.duplicateComponent(comp.id)">⧉</button>
          <button class="ed-btn-icon is-danger" title="hapus" @click="engine.removeComponent(comp.id)">🗑</button>
        </span>
      </div>

      <div class="ed-section">
        <label class="ed-field-label">ID komponen</label>
        <input class="ed-input ed-mono" :value="idDraft ?? comp.id"
               @input="idDraft = $event.target.value" @blur="applyRename" @keydown.enter="applyRename" />
      </div>

      <div class="ed-section" v-if="def.fields.length">
        <div class="ed-section-title">Properties</div>
        <div v-for="field in def.fields" :key="field.path" class="ed-field">
          <label class="ed-field-label">{{ field.label }}</label>
          <component
            :is="FIELD_KINDS[field.kind]"
            :model-value="getPath(comp, field.path)"
            :options="field.options"
            @update:model-value="setPath(comp, field.path, $event)"
          />
        </div>
      </div>

      <div class="ed-section">
        <div class="ed-section-title">Layout (grid 12 kolom)</div>
        <div class="ed-row2">
          <div class="ed-field">
            <label class="ed-field-label">Lebar desktop (md)</label>
            <input class="ed-input" type="number" min="1" max="12" :value="comp.layoutGrid?.md ?? 12"
                   @input="setPath(comp, 'layoutGrid.md', Math.max(1, Math.min(12, Number($event.target.value) || 12)))" />
          </div>
          <div class="ed-field">
            <label class="ed-field-label">Lebar mobile (xs)</label>
            <input class="ed-input" type="number" min="1" max="12" :value="comp.layoutGrid?.xs ?? 12"
                   @input="setPath(comp, 'layoutGrid.xs', Math.max(1, Math.min(12, Number($event.target.value) || 12)))" />
          </div>
        </div>
      </div>

      <div class="ed-section">
        <div class="ed-section-title">Rules · Visibility</div>
        <div class="ed-field">
          <label class="ed-field-label">Tampil jika (kosong = selalu)</label>
          <FieldExpression :model-value="comp.rules?.visibility?.condition ?? ''"
                           @update:model-value="setPath(comp, 'rules.visibility.condition', $event)" />
        </div>
      </div>

      <div class="ed-section">
        <div class="ed-section-title">Rules · Validation</div>
        <div v-for="(rule, i) in validationRules()" :key="i" class="ed-card">
          <div class="ed-row2">
            <div class="ed-field">
              <label class="ed-field-label">Trigger</label>
              <FieldSelect :model-value="rule.trigger" :options="['onChange', 'onBlur']"
                           @update:model-value="rule.trigger = $event; state.previewNonce++" />
            </div>
            <button class="ed-btn-icon is-danger" style="align-self:end" @click="removeValidationRule(i)">✕</button>
          </div>
          <div class="ed-field">
            <label class="ed-field-label">Valid jika</label>
            <FieldExpression :model-value="rule.condition" @update:model-value="rule.condition = $event; state.previewNonce++" />
          </div>
          <div class="ed-field">
            <label class="ed-field-label">Pesan error</label>
            <FieldText :model-value="rule.errorMessage" @update:model-value="rule.errorMessage = $event" />
          </div>
        </div>
        <button class="ed-btn ed-btn-ghost" @click="addValidationRule">+ Aturan validasi</button>
      </div>

      <div class="ed-section" v-if="def.events.length">
        <div class="ed-section-title">Services · Events</div>
        <div v-for="event in def.events" :key="event" class="ed-card">
          <div class="ed-field">
            <label class="ed-field-label">{{ event }}</label>
            <FieldSelect
              :model-value="eventBinding(event)?.action ?? ''"
              :options="[{ label: '— tidak ada —', value: '' }, { label: 'NAVIGATE (pindah halaman)', value: 'NAVIGATE' }, ...serviceIds.map((s) => ({ label: s, value: s }))]"
              @update:model-value="setEventAction(event, $event)"
            />
          </div>
          <template v-if="eventBinding(event)">
            <template v-if="eventBinding(event).action === 'NAVIGATE'">
              <div class="ed-field">
                <label class="ed-field-label">Tujuan</label>
                <FieldSelect :model-value="eventBinding(event).to"
                             :options="engine.pageList.value.map((p) => ({ label: p.title + ' (' + p.route + ')', value: p.id }))"
                             @update:model-value="eventBinding(event).to = $event; state.previewNonce++" />
              </div>
            </template>
            <template v-else>
              <div class="ed-field">
                <label class="ed-field-label">Simpan hasil ke state key</label>
                <FieldText :model-value="eventBinding(event).resultKey ?? ''" placeholder="default: id service"
                           @update:model-value="eventBinding(event).resultKey = $event || undefined; state.previewNonce++" />
              </div>
              <div class="ed-field">
                <label class="ed-field-label">Validasi halaman dulu</label>
                <FieldBoolean :model-value="eventBinding(event).validateFirst ?? false"
                              @update:model-value="eventBinding(event).validateFirst = $event; state.previewNonce++" />
              </div>
              <div class="ed-field">
                <label class="ed-field-label">Inputs (nilai = expression)</label>
                <div v-for="[key, expr] in bindingInputs(event)" :key="key" class="ed-kv">
                  <input class="ed-input ed-mono" :value="key" @change="renameBindingInput(event, key, $event.target.value)" />
                  <FieldExpression :model-value="expr" @update:model-value="setBindingInput(event, key, $event)" />
                  <button class="ed-btn-icon" @click="removeBindingInput(event, key)">✕</button>
                </div>
                <button class="ed-btn ed-btn-ghost" @click="addBindingInput(event)">+ Input</button>
              </div>
            </template>
          </template>
        </div>
      </div>
    </template>

    <!-- ============================ PAGE + APP ============================ -->
    <template v-else-if="page && bp">
      <div class="ed-panel-title">Halaman: {{ page.settings.title }}</div>
      <div class="ed-section">
        <div class="ed-field"><label class="ed-field-label">Judul</label>
          <FieldText :model-value="page.settings.title" @update:model-value="page.settings.title = $event; state.dirty = true" /></div>
        <div class="ed-field"><label class="ed-field-label">Route</label>
          <FieldText :model-value="page.settings.route" @update:model-value="page.settings.route = $event; state.dirty = true" /></div>
        <div class="ed-field"><label class="ed-field-label">Wajib login</label>
          <FieldBoolean :model-value="page.settings.requireAuth" @update:model-value="page.settings.requireAuth = $event; state.dirty = true" /></div>
        <div class="ed-field">
          <label class="ed-field-label">Roles yang boleh akses (kosong = semua)</label>
          <FieldJson :model-value="page.settings.allowedRoles" :rows="2"
                     @update:model-value="page.settings.allowedRoles = Array.isArray($event) ? $event : []; state.dirty = true" />
        </div>
        <button class="ed-btn ed-btn-ghost is-danger" @click="engine.removePage(state.currentPageId)">Hapus halaman ini</button>
      </div>

      <div class="ed-panel-title">Aplikasi: {{ bp.meta.name }}</div>
      <div class="ed-section">
        <div class="ed-field"><label class="ed-field-label">Nama aplikasi</label>
          <FieldText :model-value="bp.meta.name" @update:model-value="bp.meta.name = $event; state.dirty = true" /></div>
        <div class="ed-field"><label class="ed-field-label">Theme</label>
          <FieldSelect :model-value="bp.meta.globalSettings.theme" :options="['dark', 'light']"
                       @update:model-value="bp.meta.globalSettings.theme = $event; state.dirty = true; state.previewNonce++" /></div>
        <div class="ed-field"><label class="ed-field-label">Autentikasi</label>
          <FieldSelect :model-value="bp.meta.globalSettings.authStrategy"
                       :options="[{ label: 'Google Workspace (domain)', value: 'GOOGLE_WORKSPACE' }, { label: 'Publik (anonim)', value: 'PUBLIC' }]"
                       @update:model-value="bp.meta.globalSettings.authStrategy = $event; state.dirty = true" /></div>
      </div>

      <div class="ed-section">
        <div class="ed-section-title">RBAC</div>
        <div class="ed-field"><label class="ed-field-label">Daftar role (pisahkan koma)</label>
          <input class="ed-input" v-model="rolesText" /></div>
        <div class="ed-field">
          <label class="ed-field-label">Role map — email → [roles], '*' = default</label>
          <FieldJson :model-value="bp.rbac.roleMap" :rows="6"
                     @update:model-value="bp.rbac.roleMap = $event || {}; state.dirty = true" />
        </div>
      </div>

      <div class="ed-section">
        <div class="ed-section-title">Shared Services</div>
        <div v-for="sid in serviceIds" :key="sid" class="ed-card">
          <div class="ed-kv-tight">
            <input class="ed-input ed-mono" :value="sid" @change="renameService(sid, $event.target.value)" />
            <button class="ed-btn-icon is-danger" @click="removeService(sid)">✕</button>
          </div>
          <div class="ed-field"><label class="ed-field-label">Type</label>
            <FieldSelect :model-value="bp.sharedServices[sid].type" :options="SERVICE_TYPE_OPTIONS"
                         @update:model-value="bp.sharedServices[sid].type = $event; state.dirty = true" /></div>
          <div class="ed-field">
            <label class="ed-field-label">Definisi (JSON — functionName / spreadsheetId / sheet / to / subject / htmlTemplate / cachePolicy / allowedRoles / dataBoundary / rules / mockResult)</label>
            <FieldJson :model-value="bp.sharedServices[sid]" :rows="10"
                       @update:model-value="Object.keys(bp.sharedServices[sid]).forEach((k) => delete bp.sharedServices[sid][k]); Object.assign(bp.sharedServices[sid], $event); state.dirty = true" />
          </div>
        </div>
        <button class="ed-btn ed-btn-ghost" @click="addService">+ Service</button>
      </div>

      <div class="ed-section">
        <div class="ed-section-title">Shared Rules</div>
        <div v-for="(rule, rid) in bp.sharedRules" :key="rid" class="ed-card">
          <div class="ed-kv-tight">
            <span class="ed-mono ed-dim">{{ rid }}</span>
            <button class="ed-btn-icon is-danger" @click="removeSharedRule(rid)">✕</button>
          </div>
          <div class="ed-field"><label class="ed-field-label">Expression</label>
            <FieldExpression :model-value="rule.expression" @update:model-value="rule.expression = $event; state.dirty = true" /></div>
          <div class="ed-field"><label class="ed-field-label">Pesan error</label>
            <FieldText :model-value="rule.errorMessage" @update:model-value="rule.errorMessage = $event; state.dirty = true" /></div>
        </div>
        <button class="ed-btn ed-btn-ghost" @click="addSharedRule">+ Rule</button>
      </div>

      <div class="ed-section" v-if="state.validation && !state.validation.ok">
        <div class="ed-section-title is-danger">Validasi ({{ state.validation.errors.length }} error)</div>
        <div v-for="(err, i) in state.validation.errors" :key="i" class="ed-verr">
          <span class="ed-mono">{{ err.path }}</span> — {{ err.message }}
        </div>
      </div>
    </template>
  </aside>
</template>
