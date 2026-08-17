// ════════════════════════════════════════════════════════════════════
//  SISTEMA DE REGISTRO DE ASISTENCIA — Supabase Client
//  Archivo: supabase-api.js
//  Reemplaza completamente a Code.gs
//  Incluir en Index.html: <script src="supabase-api.js"></script>
//  O copiar el contenido dentro de un <script> en Index.html
// ════════════════════════════════════════════════════════════════════

// ── CONFIGURACIÓN ────────────────────────────────────────────────────
// Reemplaza estos valores con los de tu proyecto Supabase:
// Dashboard → Settings → API
const SUPABASE_URL    = 'https://qvtztwqbbbzortkodtla.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2dHp0d3FiYmJ6b3J0a29kdGxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NDA4NTMsImV4cCI6MjA4OTAxNjg1M30.zMcRweclE46qwOCTduo7sLfduZxXjKvFLmim7nZyiok';

// Google Sheets de vacaciones/permisos (se mantienen externos)
// Necesitas un Apps Script separado que exponga estos datos como API pública
// Ver instrucciones al final de este archivo.
const SHEETS_API_VACACIONES = 'https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec?tipo=vacaciones';
const SHEETS_API_PERMISOS   = 'https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec?tipo=permisos';

const CONFIG = {
  VERSION      : '3.0-supabase',
  MAX_BUSQUEDA : 20,
  CACHE_TTL    : 300,   // 5 min
  CACHE_EMP    : 600,   // 10 min
  CACHE_EXT    : 600,   // 10 min
};

// ── CLIENTE SUPABASE (usando CDN — agregar en <head> del HTML) ────────
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
let _supabase = null;
function getClient() {
  if (!_supabase) {
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}

// ════════════════════════════════════════════════════════════════════
//  CACHÉ EN MEMORIA (reemplaza CacheService de Apps Script)
// ════════════════════════════════════════════════════════════════════
const _memCache = {};

function _cacheGet(key) {
  const entry = _memCache[key];
  if (!entry) return null;
  if (Date.now() > entry.exp) { delete _memCache[key]; return null; }
  return entry.data;
}

function _cachePut(key, data, ttl) {
  _memCache[key] = { data, exp: Date.now() + (ttl || CONFIG.CACHE_TTL) * 1000 };
}

function _cacheRemove(key) {
  delete _memCache[key];
}

function _cacheRemovePattern(prefix) {
  Object.keys(_memCache).forEach(k => { if (k.startsWith(prefix)) delete _memCache[k]; });
}

// ════════════════════════════════════════════════════════════════════
//  UTILIDADES
// ════════════════════════════════════════════════════════════════════
function _ok(data, mensaje) {
  return { success: true, mensaje: mensaje || 'OK', data: data || null, ts: new Date().toISOString() };
}

function _err(mensaje, codigo) {
  console.error('[ERROR ' + (codigo || 'GEN') + ']', mensaje);
  return { success: false, mensaje, codigo: codigo || 'ERR_GENERAL', ts: new Date().toISOString() };
}

function _isoSemana(d) {
  const fecha = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia   = fecha.getUTCDay() || 7;
  fecha.setUTCDate(fecha.getUTCDate() + 4 - dia);
  const anioInicio = new Date(Date.UTC(fecha.getUTCFullYear(), 0, 1));
  return [Math.ceil((((fecha - anioInicio) / 86400000) + 1) / 7), fecha.getUTCFullYear()];
}

// Convierte datetime local a ISO para Supabase (timestamptz)
function _toISO(val) {
  if (!val || val === 'No aplica') return null;
  // Acepta "yyyy-MM-ddTHH:mm" o "yyyy-MM-dd"
  if (val.includes('T')) return new Date(val).toISOString();
  return null;
}

// Formatea timestamptz de Supabase al formato original "yyyy-MM-ddTHH:mm"
function _fmtTs(val) {
  if (!val) return '';
  const d = new Date(val);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convierte una fila de Supabase al array de 24 columnas que espera el frontend
function _rowToArray(r) {
  return [
    r.mes || '',
    r.fecha || '',
    r.responsable || '',
    r.turno || '',
    r.linea || '',
    r.codigo || '',
    r.nombre || '',
    r.tipo_contrato || '',
    r.funcion || '',
    r.centro_costo || '',
    r.especie || '',
    r.producto || '',
    r.proceso || '',
    r.operacion || '',
    _fmtTs(r.proceso_inicio),
    _fmtTs(r.proceso_termino),
    r.atraso_inicio || '0',
    _fmtTs(r.descanso_inicio),
    _fmtTs(r.descanso_termino),
    r.desayuno_programado || '',
    _fmtTs(r.colacion_inicio),
    _fmtTs(r.colacion_termino),
    r.colacion_programado || '',
    r.created_at ? _fmtTs(r.created_at) : '',
    r.id || '',   // [24] UUID — usado por abrirEditar() y abrirEliminar() en el frontend
  ];
}

// ════════════════════════════════════════════════════════════════════
//  AUDIT
// ════════════════════════════════════════════════════════════════════
async function _audit(accion, detalle) {
  try {
    const db = getClient();
    await db.from('audit_log').insert({
      accion,
      detalle: detalle || '',
      usuario: 'usuario',   // reemplazar con auth.user.email si implementas Supabase Auth
      sesion:  Math.random().toString(36).slice(2),
    });
  } catch (e) {
    console.warn('[AUDIT ERROR]', e.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  LISTAS DE PRODUCCIÓN — con caché
//  Reemplaza getListData() de Code.gs
// ════════════════════════════════════════════════════════════════════
async function getListData() {
  const cKey = 'listData_v' + CONFIG.VERSION;
  const cached = _cacheGet(cKey);
  if (cached) return cached;

  const db = getClient();
  const { data, error } = await db
    .from('produccion')
    .select('especie,funcion,producto,proceso,operacion,responsable,linea,linea_especial,funcion_especial')
    .eq('activo', true);

  if (error) { console.error('[LISTAS]', error.message); return {}; }

  const LESP = new Set(['EMPAQUE','MPRIMA','SERVICIOS','STAFF','SUBPRODUCTO']);
  const uniq = arr => [...new Set(arr.map(v => String(v||'').trim()).filter(Boolean))].sort();

  let esp=[], fun=[], pro=[], proc=[], oper=[], lin=[];
  const respSet = new Set();
  const mE={}, mP={}, mL={};

  (data || []).forEach(r => {
    const e=r.especie||'', f=r.funcion||'', p=r.producto||'',
          pr=r.proceso||'', op=r.operacion||'', rs=r.responsable||'',
          l=r.linea||'', le=r.linea_especial||'', lf=r.funcion_especial||'';
    const lu = le.toUpperCase();

    if(e) esp.push(e); if(f) fun.push(f); if(p) pro.push(p);
    if(pr) proc.push(pr); if(op) oper.push(op);
    if(rs) respSet.add(rs);
    if(l && !LESP.has(l.toUpperCase())) lin.push(l);
    if(e && p) {
      if(!mE[e]) mE[e]={productos:[]};
      if(!mE[e].productos.includes(p)) mE[e].productos.push(p);
      const k=e+'||'+p;
      if(!mP[k]) mP[k]={funciones:[],procesos:[],operaciones:[]};
      if(f&&!mP[k].funciones.includes(f))    mP[k].funciones.push(f);
      if(pr&&!mP[k].procesos.includes(pr))   mP[k].procesos.push(pr);
      if(op&&!mP[k].operaciones.includes(op)) mP[k].operaciones.push(op);
    }
    if(lu && LESP.has(lu) && lf) {
      if(!mL[lu]) mL[lu]=[];
      if(!mL[lu].includes(lf)) mL[lu].push(lf);
      if(!lin.includes(lu)) lin.push(lu);
    }
  });

  const result = {
    especies: uniq(esp), funciones: uniq(fun), productos: uniq(pro),
    procesos: uniq(proc), operaciones: uniq(oper),
    responsables: [...uniq([...respSet])],
    lineas: uniq(lin), mapaEspecie: mE, mapaProducto: mP, mapaLinea: mL,
    version: CONFIG.VERSION,
  };

  _cachePut(cKey, result, CONFIG.CACHE_TTL);
  return result;
}

// ════════════════════════════════════════════════════════════════════
//  EMPLEADOS — con caché
// ════════════════════════════════════════════════════════════════════
async function obtenerEmpleados() {
  const cKey = 'empleados_v' + CONFIG.VERSION;
  const cached = _cacheGet(cKey);
  if (cached) return cached;

  const db = getClient();
  const { data, error } = await db
    .from('empleados')
    .select('codigo,nombre,centro_costo,contrato')
    .eq('activo', true)
    .order('nombre');

  if (error) { console.error('[EMP]', error.message); return []; }

  const result = (data || []).map(r => ({
    codigo:      r.codigo,
    nombre:      r.nombre,
    centroCosto: r.centro_costo,
    contrato:    r.contrato,
  }));

  _cachePut(cKey, result, CONFIG.CACHE_EMP);
  return result;
}

async function buscarEmpleados(query) {
  if (!query || String(query).trim().length < 1) return [];
  const q    = String(query).toLowerCase().trim();
  const todos = await obtenerEmpleados();
  const found = [];
  for (const e of todos) {
    if (e.codigo.toLowerCase().includes(q) || e.nombre.toLowerCase().includes(q)) {
      found.push(e);
      if (found.length >= CONFIG.MAX_BUSQUEDA) break;
    }
  }
  return found;
}

async function buscarResponsables(query) {
  if (!query || String(query).trim().length < 1) return [];
  const q    = String(query).toLowerCase().trim();
  const data = await getListData();
  return (data.responsables || []).filter(r => r.toLowerCase().includes(q)).slice(0, 15);
}

async function obtenerResponsables() {
  const data = await getListData();
  return data.responsables || [];
}

// ════════════════════════════════════════════════════════════════════
//  C — CREATE
// ════════════════════════════════════════════════════════════════════
async function guardarAsistencia(data) {
  try {
    if (!data.fecha)  return _err('Fecha es requerida.',    'VAL_FECHA');
    if (!data.codigo) return _err('Empleado es requerido.', 'VAL_EMP');
    if (!data.turno)  return _err('Turno es requerido.',    'VAL_TURNO');
    if (!data.linea)  return _err('Línea es requerida.',    'VAL_LINEA');

    const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const mes = MESES[new Date(data.fecha + 'T12:00:00').getMonth()];

    const db = getClient();
    const { data: inserted, error } = await db
      .from('registros')
      .insert({
        mes,
        fecha:               data.fecha,
        responsable:         data.responsable || '',
        turno:               data.turno,
        linea:               data.linea,
        codigo:              data.codigo,
        nombre:              data.nombre || '',
        tipo_contrato:       data.tipoContrato || '',
        funcion:             data.funcion || '',
        centro_costo:        data.centroCosto || '',
        especie:             data.especie || '',
        producto:            data.producto || '',
        proceso:             data.proceso || '',
        operacion:           data.operacion || '',
        proceso_inicio:      _toISO(data.procesoInicio),
        proceso_termino:     _toISO(data.procesoTermino),
        atraso_inicio:       String(data.atrasoInicio || '0'),
        descanso_inicio:     _toISO(data.descansoInicio),
        descanso_termino:    _toISO(data.descansoTermino),
        desayuno_programado: data.desayunoProgramado || '',
        colacion_inicio:     _toISO(data.colacionInicio),
        colacion_termino:    _toISO(data.colacionTermino),
        colacion_programado: data.colacionProgramado || '',
      })
      .select('id')
      .single();

    if (error) return _err('Error al guardar: ' + error.message, 'ERR_CREATE');

    // Invalida caché de semana afectada
    const [sem, anio] = _isoSemana(new Date(data.fecha + 'T12:00:00'));
    _cacheRemove('semana_' + sem + '_' + anio);

    await _audit('CREATE', `${data.codigo} ${data.nombre} | ${data.fecha} | ${data.turno} | ${data.linea}`);
    return _ok({ id: inserted.id }, '✅ Registro guardado correctamente.');
  } catch (e) {
    return _err('Error al guardar: ' + e.message, 'ERR_CREATE');
  }
}

// ════════════════════════════════════════════════════════════════════
//  R — READ
// ════════════════════════════════════════════════════════════════════

// Dashboard: solo registros de la semana ISO solicitada
async function obtenerRegistrosSemana(semana, anio) {
  try {
    semana = parseInt(semana) || _isoSemana(new Date())[0];
    anio   = parseInt(anio)   || new Date().getFullYear();

    const cKey = 'semana_' + semana + '_' + anio;
    const cached = _cacheGet(cKey);
    if (cached) return cached;

    // Calcular rango de fechas de la semana ISO
    const jan4  = new Date(Date.UTC(anio, 0, 4));
    const day4  = jan4.getUTCDay() || 7;
    const lunes = new Date(jan4);
    lunes.setUTCDate(jan4.getUTCDate() - day4 + 1 + (semana - 1) * 7);
    const domingo = new Date(lunes);
    domingo.setUTCDate(lunes.getUTCDate() + 6);

    const desde = lunes.toISOString().substring(0, 10);
    const hasta = domingo.toISOString().substring(0, 10);

    const db = getClient();
    const { data, error } = await db
      .from('registros')
      .select('*')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) { console.error('[SEM]', error.message); return []; }

    const result = (data || []).map(_rowToArray);
    _cachePut(cKey, result, 120);
    return result;
  } catch (e) {
    console.error('[SEM ERROR]', e.message);
    return [];
  }
}

// Vista Registros: paginado con filtros en servidor
async function obtenerRegistrosFiltrados(filtros, pagina, porPagina) {
  try {
    pagina    = Math.max(1, parseInt(pagina) || 1);
    porPagina = Math.min(2000, parseInt(porPagina) || 50);
    filtros   = filtros || {};

    const db = getClient();
    let query = db.from('registros').select('*', { count: 'exact' });

    if (filtros.desde) query = query.gte('fecha', filtros.desde);
    if (filtros.hasta) query = query.lte('fecha', filtros.hasta);
    if (filtros.turno) query = query.ilike('turno', '%' + filtros.turno + '%');
    if (filtros.linea) query = query.ilike('linea', '%' + filtros.linea + '%');
    if (filtros.busq) {
      const b = filtros.busq;
      query = query.or(`codigo.ilike.%${b}%,nombre.ilike.%${b}%,responsable.ilike.%${b}%`);
    }

    const inicio = (pagina - 1) * porPagina;
    query = query
      .order('fecha',      { ascending: false })
      .order('created_at', { ascending: false })
      .range(inicio, inicio + porPagina - 1);

    const { data, error, count } = await query;
    if (error) return _err('Error filtrado: ' + error.message, 'ERR_FILTRADO');

    const registros    = (data || []).map(_rowToArray);
    const total        = count || 0;
    const totalPaginas = Math.ceil(total / porPagina);

    return _ok({ registros, total, pagina, porPagina, totalPaginas });
  } catch (e) {
    return _err('Error filtrado: ' + e.message, 'ERR_FILTRADO');
  }
}

// Compatibilidad legacy (últimas 500 filas)
async function obtenerRegistros() {
  try {
    const db = getClient();
    const { data, error } = await db
      .from('registros')
      .select('*')
      .order('fecha',      { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) { console.error('[READ]', error.message); return []; }
    return (data || []).map(_rowToArray);
  } catch (e) {
    console.error('[READ ERROR]', e.message);
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════
//  U — UPDATE
//  NOTA: En Supabase el registro se identifica por UUID, no por
//  índice de fila como en Sheets. El frontend pasa el id UUID
//  en lugar de editIdx cuando llama a guardarEdicion().
// ════════════════════════════════════════════════════════════════════
async function editarRegistro(id, rowData) {
  try {
    if (!id) return _err('ID requerido.', 'VAL_IDX');
    if (!Array.isArray(rowData) || !rowData.length) return _err('Datos requeridos.', 'VAL_DATA');

    // rowData = array de 24 cols en el mismo orden que _rowToArray produce
    const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const fechaStr = rowData[1] || '';
    const mes = fechaStr ? MESES[new Date(fechaStr + 'T12:00:00').getMonth()] : rowData[0];

    const db = getClient();
    const { error } = await db
      .from('registros')
      .update({
        mes,
        fecha:               fechaStr,
        responsable:         rowData[2]  || '',
        turno:               rowData[3]  || '',
        linea:               rowData[4]  || '',
        codigo:              rowData[5]  || '',
        nombre:              rowData[6]  || '',
        tipo_contrato:       rowData[7]  || '',
        funcion:             rowData[8]  || '',
        centro_costo:        rowData[9]  || '',
        especie:             rowData[10] || '',
        producto:            rowData[11] || '',
        proceso:             rowData[12] || '',
        operacion:           rowData[13] || '',
        proceso_inicio:      _toISO(rowData[14]),
        proceso_termino:     _toISO(rowData[15]),
        atraso_inicio:       String(rowData[16] || '0'),
        descanso_inicio:     _toISO(rowData[17]),
        descanso_termino:    _toISO(rowData[18]),
        desayuno_programado: rowData[19] || '',
        colacion_inicio:     _toISO(rowData[20]),
        colacion_termino:    _toISO(rowData[21]),
        colacion_programado: rowData[22] || '',
      })
      .eq('id', id);

    if (error) return _err('Error al actualizar: ' + error.message, 'ERR_UPDATE');

    if (fechaStr) {
      const [sem, anio] = _isoSemana(new Date(fechaStr + 'T12:00:00'));
      _cacheRemove('semana_' + sem + '_' + anio);
    }

    await _audit('UPDATE', `id ${id} | ${rowData[5]} ${rowData[6]} | ${fechaStr}`);
    return _ok({ id }, '✅ Registro actualizado correctamente.');
  } catch (e) {
    return _err('Error al actualizar: ' + e.message, 'ERR_UPDATE');
  }
}

// ════════════════════════════════════════════════════════════════════
//  D — DELETE
// ════════════════════════════════════════════════════════════════════
async function eliminarRegistro(id) {
  try {
    if (!id) return _err('ID requerido.', 'VAL_IDX');

    const db = getClient();

    // Leer antes de eliminar para auditoría
    const { data: antes } = await db
      .from('registros')
      .select('codigo,nombre,fecha,turno')
      .eq('id', id)
      .single();

    const { error } = await db.from('registros').delete().eq('id', id);
    if (error) return _err('Error al eliminar: ' + error.message, 'ERR_DELETE');

    if (antes?.fecha) {
      const [sem, anio] = _isoSemana(new Date(antes.fecha + 'T12:00:00'));
      _cacheRemove('semana_' + sem + '_' + anio);
    }

    await _audit('DELETE', `id ${id} | ${antes?.codigo} ${antes?.nombre} | ${antes?.fecha} | ${antes?.turno}`);
    return _ok(null, '✅ Registro eliminado correctamente.');
  } catch (e) {
    return _err('Error al eliminar: ' + e.message, 'ERR_DELETE');
  }
}

// ════════════════════════════════════════════════════════════════════
//  AUSENTES DEL DÍA
//  Las hojas de vacaciones/permisos se consultan vía Apps Script API
//  (ver instrucciones al final de este archivo)
// ════════════════════════════════════════════════════════════════════
async function obtenerAusentesDia(fechaStr) {
  try {
    if (!fechaStr) {
      const hoy = new Date();
      fechaStr = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
    }

    const db = getClient();

    // 1. Lista noregistrar
    const { data: noRegData } = await db.from('noregistrar').select('codigo,nombre');
    const noRegCods   = new Set((noRegData||[]).map(r => r.codigo.trim().toLowerCase()).filter(Boolean));
    const noRegNombres = new Set((noRegData||[]).map(r => r.nombre.trim().toLowerCase()).filter(Boolean));

    // 2. Empleados activos (desde caché)
    const empleados = (await obtenerEmpleados()).filter(e =>
      !noRegCods.has(e.codigo.toLowerCase()) &&
      !noRegNombres.has(e.nombre.toLowerCase())
    );

    // 3. Registros del día
    const { data: regsHoy } = await db
      .from('registros')
      .select('codigo')
      .eq('fecha', fechaStr);
    const conRegistro = new Set((regsHoy || []).map(r => r.codigo));

    const ausentes = empleados.filter(e => !conRegistro.has(e.codigo));
    if (!ausentes.length) return [];

    // 4. Vacaciones — desde Apps Script API (caché 10 min)
    let vacSet = new Set();
    const vacCached = _cacheGet('ext_vac');
    if (vacCached) {
      vacSet = new Set(vacCached);
    } else {
      try {
        const res = await fetch(SHEETS_API_VACACIONES);
        if (res.ok) {
          const json = await res.json();
          vacSet = new Set((json.codigosEnCurso || []));
          _cachePut('ext_vac', [...vacSet], CONFIG.CACHE_EXT);
        }
      } catch (eVac) { console.warn('[VAC]', eVac.message); }
    }

    // 5. Permisos — desde Apps Script API (caché 10 min por fecha)
    const permCacheKey = 'ext_perm_' + fechaStr;
    let permPersonalSet = new Set(), permMedicoSet = new Set(), permJudicialSet = new Set();
    const permCached = _cacheGet(permCacheKey);
    if (permCached) {
      permPersonalSet  = new Set(permCached.personal  || []);
      permMedicoSet    = new Set(permCached.medico     || []);
      permJudicialSet  = new Set(permCached.judicial   || []);
    } else {
      try {
        const res = await fetch(SHEETS_API_PERMISOS + '&fecha=' + fechaStr);
        if (res.ok) {
          const json = await res.json();
          permPersonalSet  = new Set(json.personal  || []);
          permMedicoSet    = new Set(json.medico     || []);
          permJudicialSet  = new Set(json.judicial   || []);
          _cachePut(permCacheKey, {
            personal: [...permPersonalSet],
            medico:   [...permMedicoSet],
            judicial: [...permJudicialSet],
          }, CONFIG.CACHE_EXT);
        }
      } catch (ePerm) { console.warn('[PERM]', ePerm.message); }
    }

    // 6. Asignar estado
    const ord = {'Sin registro':0,'Permiso Personal':1,'Permiso Médico':2,'Permiso Judicial':3,'Vacaciones en curso':4};
    return ausentes.map(e => {
      let estado = 'Sin registro';
      if      (vacSet.has(e.codigo))             estado = 'Vacaciones en curso';
      else if (permJudicialSet.has(e.codigo))    estado = 'Permiso Judicial';
      else if (permMedicoSet.has(e.codigo))      estado = 'Permiso Médico';
      else if (permPersonalSet.has(e.codigo))    estado = 'Permiso Personal';
      return { ...e, estado };
    }).sort((a, b) => {
      const oa = ord[a.estado] ?? 9, ob = ord[b.estado] ?? 9;
      if (oa !== ob) return oa - ob;
      return a.nombre.localeCompare(b.nombre, 'es');
    });

  } catch (e) {
    console.error('[AUSENTES ERROR]', e.message);
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════
//  INVALIDAR CACHÉ
// ════════════════════════════════════════════════════════════════════
function invalidarCache() {
  _cacheRemovePattern('listData_v');
  _cacheRemovePattern('empleados_v');
  _cacheRemove('ext_vac');
  _cacheRemovePattern('ext_perm_');
  _cacheRemovePattern('semana_');
}

function limpiarCache() { invalidarCache(); return _ok(null, '✅ Caché limpiado.'); }

// ════════════════════════════════════════════════════════════════════
//  ESTADÍSTICAS
// ════════════════════════════════════════════════════════════════════
async function obtenerEstadisticas() {
  try {
    const db = getClient();
    const [
      { count: totalRegistros },
      { count: totalEmpleados },
      { count: totalAcciones },
    ] = await Promise.all([
      db.from('registros')  .select('*', { count: 'exact', head: true }),
      db.from('empleados')  .select('*', { count: 'exact', head: true }).eq('activo', true),
      db.from('audit_log')  .select('*', { count: 'exact', head: true }),
    ]);
    return _ok({
      totalRegistros: totalRegistros || 0,
      totalEmpleados: totalEmpleados || 0,
      totalAcciones:  totalAcciones  || 0,
      version:        CONFIG.VERSION,
    });
  } catch (e) { return _err('Error: ' + e.message, 'ERR_STATS'); }
}

// ════════════════════════════════════════════════════════════════════
//  OBJETO "google.script.run" SIMULADO
//  Permite que el HTML existente funcione sin cambiar la forma de
//  llamar a las funciones. Solo cambia el backend.
//
//  Uso en el HTML (sin cambios):
//    google.script.run
//      .withSuccessHandler(res => { ... })
//      .withFailureHandler(e => { ... })
//      .guardarAsistencia(data);
//
//  Esto intercepta esa llamada y la redirige a supabase-api.js
// ════════════════════════════════════════════════════════════════════
const _apiFunctions = {
  getListData,
  obtenerEmpleados,
  buscarEmpleados,
  buscarResponsables,
  obtenerResponsables,
  guardarAsistencia,
  obtenerRegistrosSemana,
  obtenerRegistrosFiltrados,
  obtenerRegistros,
  editarRegistro,
  eliminarRegistro,
  obtenerAusentesDia,
  invalidarCache,
  limpiarCache,
  obtenerEstadisticas,
};

// Polyfill del objeto google.script.run
window.google = window.google || {};
window.google.script = window.google.script || {};
window.google.script.run = new Proxy({}, {
  get(_, fnName) {
    let _successHandler = () => {};
    let _failureHandler = e => console.error('[API]', e);

    const runner = {
      withSuccessHandler(fn) { _successHandler = fn; return runner; },
      withFailureHandler(fn) { _failureHandler = fn; return runner; },
    };

    // Devuelve un proxy del runner que, al llamar la función, ejecuta el async
    return new Proxy(runner, {
      get(target, prop) {
        if (prop in target) return target[prop];
        // Es el nombre de la función a ejecutar
        return function(...args) {
          const fn = _apiFunctions[prop];
          if (!fn) {
            _failureHandler(new Error(`Función "${prop}" no encontrada en supabase-api.js`));
            return;
          }
          Promise.resolve(fn(...args))
            .then(result => _successHandler(result))
            .catch(err   => _failureHandler(err));
        };
      },
    });
  },
});

// ════════════════════════════════════════════════════════════════════
//  INSTRUCCIONES: API para hojas externas de Vacaciones/Permisos
// ════════════════════════════════════════════════════════════════════
/*
Crea un Apps Script separado (en el mismo Google Script de vacaciones/permisos)
con este doGet() que expone los datos como JSON:

```javascript
function doGet(e) {
  const tipo  = (e.parameter.tipo || '').toLowerCase();
  const fecha = e.parameter.fecha || '';

  if (tipo === 'vacaciones') {
    const ss  = SpreadsheetApp.openById('ID_VACACIONES');
    const sh  = ss.getSheetByName('Tabla auxiliar');
    const rows = sh.getRange(2, 1, sh.getLastRow()-1, 14).getValues();
    const codigosEnCurso = rows
      .filter(r => String(r[13]).trim().toUpperCase() === 'EN CURSO')
      .map(r => String(r[9]).trim())
      .filter(Boolean);
    return ContentService
      .createTextOutput(JSON.stringify({ codigosEnCurso }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (tipo === 'permisos' && fecha) {
    const ss  = SpreadsheetApp.openById('ID_PERMISOS');
    const sh  = ss.getSheetByName('Auxiliar20');
    const rows = sh.getRange(2, 1, sh.getLastRow()-1, 7).getValues();
    const tz = Session.getScriptTimeZone();
    const personal=[], medico=[], judicial=[];
    rows.forEach(r => {
      const cod   = String(r[4] || '').trim();
      let fPerm   = r[5];
      const tipo2 = String(r[6] || '').trim().toUpperCase();
      if (!cod) return;
      if (fPerm instanceof Date) fPerm = Utilities.formatDate(fPerm, tz, 'yyyy-MM-dd');
      else fPerm = String(fPerm || '').substring(0, 10);
      if (fPerm !== fecha) return;
      if (tipo2.includes('JUDICIAL'))                          judicial.push(cod);
      else if (tipo2.includes('MÉDICO') || tipo2.includes('MEDICO')) medico.push(cod);
      else if (tipo2.includes('PERMISO') || tipo2.includes('PERSONAL')) personal.push(cod);
    });
    return ContentService
      .createTextOutput(JSON.stringify({ personal, medico, judicial }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ error: 'Parámetro inválido' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Despliega como "Web app" con acceso "Anyone" y copia la URL en
SHEETS_API_VACACIONES y SHEETS_API_PERMISOS al inicio de este archivo.
*/
