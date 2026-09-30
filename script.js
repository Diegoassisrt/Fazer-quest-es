/* Estudos para Concursos — roda 100% no navegador (GitHub Pages).
   Dados salvos no localStorage do seu navegador. */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// ---------- Armazenamento ----------
const KEY = "estudos_concursos_v1";
let db = JSON.parse(localStorage.getItem(KEY) || '{"materias":{}}');
let sel = { materia: null, lista: null };
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Extração do PDF ----------
const LIXO = /(www\.estrategia|estrat[eé]gia concursos|p[aá]gina\s+\d+|^\s*\d+\s*(de|\/)\s*\d+\s*$|documento licenciado|^\s*prof\.)/i;
// Gabarito: "1. C", "2 - A", "3: Certo", "4) ANULADA"...
const PAD_GAB = /(?<!\d)(\d{1,3})\s*[.\-–:)]?\s*(ANULAD[AO]|CERTO|ERRADO|[A-E])(?![A-Za-zÀ-ú])/g;

async function extrairTexto(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const paginas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const linhas = [];
    let linha = "", y = null;
    for (const it of tc.items) {
      const yy = it.transform[5];
      if (y !== null && Math.abs(yy - y) > 3) { linhas.push(linha); linha = ""; } // nova linha
      linha += it.str;
      y = yy;
    }
    linhas.push(linha);
    paginas.push(linhas.filter((l) => !LIXO.test(l)).join("\n"));
  }
  return paginas.join("\n");
}

const norm = (r) => {
  r = r.toUpperCase();
  return r === "CERTO" ? "C" : r === "ERRADO" ? "E" : r.startsWith("ANULAD") ? "ANULADA" : r;
};

function lerGabarito(t) {
  const g = {};
  for (const m of t.replace(/\s+/g, " ").matchAll(PAD_GAB)) {
    const n = +m[1];
    if (!(n in g)) g[n] = norm(m[2]);
  }
  return g;
}

// Testa cada "GABARITO" e escolhe a ocorrência com maior sequência 1,2,3...
function extrairGabarito(texto) {
  let best = { g: {}, pos: texto.length }, bestRun = 0;
  for (const m of texto.matchAll(/gabarito/gi)) {
    const g = lerGabarito(texto.slice(m.index + m[0].length));
    let r = 0;
    while (r + 1 in g) r++;
    if (r > bestRun) { bestRun = r; best = { g, pos: m.index }; }
  }
  return best;
}

// Divide por "1.", "2.", ... aceitando só o número esperado na sequência
function dividirQuestoes(texto) {
  let ach = [], esp = 1;
  for (const m of texto.matchAll(/^[ \t]*(\d{1,3})[ \t]*[.)][ \t]+(?=\S)/gm)) {
    const n = +m[1];
    if (n === 1 && ach.length < 3) { ach = []; esp = 1; } // ignora sumário
    if (n === esp) { ach.push({ n, ini: m.index, fim: m.index + m[0].length }); esp++; }
  }
  return ach.map((a, i) => ({ n: a.n, bloco: texto.slice(a.fim, i + 1 < ach.length ? ach[i + 1].ini : texto.length) }));
}

// Separa enunciado e alternativas a) b) c) d) e); sem alternativas => Certo/Errado
function parsearQuestao(num, bloco) {
  bloco = bloco.trim().replace(/\s*\n\s*/g, " ");
  const marcas = [...bloco.matchAll(/(?:^|\s)\(?([a-eA-E])\)\s/g)]
    .map((m) => ({ l: m[1].toLowerCase(), ini: m.index, fim: m.index + m[0].length }));
  let seq = [];
  for (let i = marcas.length - 1; i >= 0; i--) {
    if (marcas[i].l !== "a") continue;
    const t = [marcas[i]];
    let esp = "b";
    for (const mk of marcas.slice(i + 1))
      if (mk.l === esp) { t.push(mk); esp = String.fromCharCode(esp.charCodeAt(0) + 1); }
    if (t.length >= 2) { seq = t; break; }
  }
  if (seq.length) {
    const alt = {};
    seq.forEach((s, k) => (alt[s.l.toUpperCase()] = bloco.slice(s.fim, k + 1 < seq.length ? seq[k + 1].ini : bloco.length).trim()));
    return { num, tipo: "ME", enunciado: bloco.slice(0, seq[0].ini).trim(), alternativas: alt };
  }
  return { num, tipo: "CE", enunciado: bloco, alternativas: { C: "Certo", E: "Errado" } };
}

async function processarPDF(file) {
  const texto = await extrairTexto(file);
  const { g, pos } = extrairGabarito(texto);
  const questoes = dividirQuestoes(texto.slice(0, pos)).map((q) => parsearQuestao(q.n, q.bloco));
  return { id: Date.now() + Math.random().toString(36).slice(2, 6), nome: file.name.replace(/\.pdf$/i, ""), questoes, gabarito: g, respostas: {}, corrigido: false };
}

// ---------- Interface ----------
function renderSide() {
  $("listaMaterias").innerHTML = Object.keys(db.materias).map((m) =>
    `<div class="mat"><button class="nome ${m === sel.materia ? "on" : ""}" data-m="${esc(m)}">${esc(m)}</button>
     <button data-dm="${esc(m)}" title="Excluir matéria">🗑️</button></div>`).join("") || '<p class="muted">Nenhuma matéria ainda.</p>';
}

function renderMain() {
  const el = $("main");
  if (!sel.materia) { el.innerHTML = "<h2>Bem-vindo 👋</h2><p>Crie e selecione uma matéria ao lado para começar.</p>"; return; }
  const mat = db.materias[sel.materia];
  let h = `<h2>📖 ${esc(sel.materia)}</h2>
    <div class="card"><label>📤 Enviar PDF(s) de questões: <input type="file" id="pdf" accept="application/pdf" multiple></label>
    <div id="status" class="muted"></div></div>
    <div class="tabs">${mat.listas.map((l) =>
      `<button class="tab ${l.id === sel.lista ? "on" : ""}" data-l="${l.id}">${esc(l.nome)}</button>
       <button data-dl="${l.id}" title="Excluir PDF">🗑️</button>`).join("")}</div>`;

  const L = mat.listas.find((l) => l.id === sel.lista);
  if (L) h += renderLista(L);
  else if (mat.listas.length) h += '<p class="muted">Selecione uma lista acima.</p>';
  el.innerHTML = h;
}

function renderLista(L) {
  const temGab = Object.keys(L.gabarito).length > 0;
  let h = `<p class="muted">${L.questoes.length} questões · ${Object.keys(L.gabarito).length} respostas no gabarito</p>`;
  if (!L.questoes.length) return h + '<p class="card">Não consegui identificar questões neste PDF (talvez seja escaneado).</p>';
  if (!temGab) h += '<p class="card">⚠️ Gabarito não encontrado no final do PDF — a correção não será possível.</p>';

  let ac = 0, er = 0, br = 0;
  const cards = L.questoes.map((q) => {
    const marc = L.respostas[q.num], certa = L.gabarito[q.num];
    let cls = "", fb = "";
    if (L.corrigido) {
      if (!certa) fb = "Sem gabarito para esta questão.";
      else if (certa === "ANULADA") fb = "Questão anulada.";
      else if (!marc) { br++; cls = "branco"; fb = `Em branco. Gabarito: ${certa}`; }
      else if (marc === certa) { ac++; cls = "ok"; fb = `✅ Acertou! Gabarito: ${certa}`; }
      else { er++; cls = "err"; fb = `❌ Errou. Você marcou ${marc} — gabarito: ${certa}`; }
    }
    const alts = Object.entries(q.alternativas).map(([k, t]) =>
      `<label class="alt"><input type="radio" name="q${q.num}" value="${k}" data-q="${q.num}"
       ${marc === k ? "checked" : ""} ${L.corrigido ? "disabled" : ""}> ${q.tipo === "CE" ? t : `<b>${k})</b> ${esc(t)}`}</label>`).join("");
    return `<div class="card q ${cls}"><b>Questão ${q.num}</b><p>${esc(q.enunciado)}</p>${alts}${fb ? `<p class="fb">${fb}</p>` : ""}</div>`;
  }).join("");

  if (L.corrigido) {
    const total = ac + er + br, pct = total ? (ac / total) * 100 : 0;
    h += `<div class="card"><h3>📊 Seu desempenho</h3><div class="stats">
      <div><b>${ac}</b>Acertos</div><div><b>${er}</b>Erros</div><div><b>${br}</b>Em branco</div>
      <div><b>${pct.toFixed(1)}%</b>Aproveitamento</div></div>
      <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }
  h += cards;
  h += L.corrigido ? '<button id="refazer" class="pri">🔄 Refazer lista</button>'
                   : `<button id="corrigir" class="pri" ${temGab ? "" : "disabled"}>✅ Corrigir</button>`;
  return h;
}

const render = () => { renderSide(); renderMain(); };
const listaAtual = () => db.materias[sel.materia]?.listas.find((l) => l.id === sel.lista);

// ---------- Eventos ----------
$("formMateria").addEventListener("submit", (e) => {
  e.preventDefault();
  const nome = $("novaMateria").value.trim();
  if (!nome) return;
  if (db.materias[nome]) return alert("Essa matéria já existe.");
  db.materias[nome] = { listas: [] };
  sel = { materia: nome, lista: null };
  $("novaMateria").value = "";
  save(); render();
});

document.addEventListener("click", (e) => {
  const d = e.target.dataset, L = listaAtual();
  if (d.m) { sel = { materia: d.m, lista: db.materias[d.m].listas[0]?.id || null }; render(); }
  else if (d.dm) {
    if (!confirm(`Excluir "${d.dm}" e todas as suas listas?`)) return;
    delete db.materias[d.dm];
    if (sel.materia === d.dm) sel = { materia: null, lista: null };
    save(); render();
  } else if (d.l) { sel.lista = d.l; renderMain(); }
  else if (d.dl) {
    if (!confirm("Excluir esta lista?")) return;
    const m = db.materias[sel.materia];
    m.listas = m.listas.filter((l) => l.id !== d.dl);
    if (sel.lista === d.dl) sel.lista = m.listas[0]?.id || null;
    save(); render();
  } else if (e.target.id === "corrigir") { L.corrigido = true; save(); renderMain(); window.scrollTo(0, 0); }
  else if (e.target.id === "refazer") { L.respostas = {}; L.corrigido = false; save(); renderMain(); window.scrollTo(0, 0); }
});

document.addEventListener("change", async (e) => {
  if (e.target.dataset.q) { // marcou alternativa
    listaAtual().respostas[e.target.dataset.q] = e.target.value;
    save();
  } else if (e.target.id === "pdf") { // upload de PDFs
    const st = $("status");
    for (const f of e.target.files) {
      st.textContent = `Processando ${f.name}...`;
      try {
        const lista = await processarPDF(f);
        db.materias[sel.materia].listas.push(lista);
        sel.lista = lista.id;
        save();
      } catch (err) {
        console.error(err);
        alert(`Erro ao ler ${f.name}: ${err.message}`);
      }
    }
    renderMain();
  }
});

render();
