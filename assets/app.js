"use strict";

const DATA_URL = "data/results.json";
const REFRESH_MS = 60_000;
const STALE_MIN = 45;

const $ = (id) => document.getElementById(id);

const nf = new Intl.NumberFormat("pt-BR");
const pf = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const whenFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const state = {
  data: null,
  section: "all",
  onlyData: true,
  sort: "alpha",
};

/* ---------- helpers ---------- */

function pctText(value, published) {
  const text = `${pf.format(value)}%`;
  return published ? text : `≈${text}`;
}

function ageMinutes() {
  if (!state.data) return Infinity;
  return (Date.now() - Date.parse(state.data.generated_at)) / 60000;
}

function allCountries() {
  return state.data.sections.flatMap((s) => s.countries);
}

const totalVotes = (c) => (c.lula_votes ?? 0) + (c.flavio_votes ?? 0);

function visibleCountries() {
  const list = allCountries().filter(
    (c) =>
      (state.section === "all" || c.section === state.section) &&
      (!state.onlyData || c.has_data)
  );
  const cmp = {
    alpha: (a, b) => a.name.localeCompare(b.name, "pt-BR"),
    votes: (a, b) => totalVotes(b) - totalVotes(a),
    margin: (a, b) =>
      Math.abs((b.lula_pct ?? 0) - (b.flavio_pct ?? 0)) -
      Math.abs((a.lula_pct ?? 0) - (a.flavio_pct ?? 0)),
    lula: (a, b) => (b.lula_votes ?? 0) - (a.lula_votes ?? 0),
    flavio: (a, b) => (b.flavio_votes ?? 0) - (a.flavio_votes ?? 0),
  };
  return list.sort(cmp[state.sort]);
}

/* ---------- totals ---------- */

function renderTotals() {
  const t = state.data.totals;

  $("lula-pct").textContent = pf.format(t.lula_pct);
  $("flavio-pct").textContent = pf.format(t.flavio_pct);
  $("lula-votes").textContent = nf.format(t.lula_votes);
  $("flavio-votes").textContent = nf.format(t.flavio_votes);

  $("bar-lula").style.width = `${t.lula_pct}%`;
  $("bar-flavio").style.width = `${t.flavio_pct}%`;

  $("stat-reporting").textContent = `${t.countries_reporting} de ${t.countries_total}`;
  $("stat-valid").textContent = nf.format(t.valid_votes);
  $("stat-lula").textContent = t.countries_lula;
  $("stat-flavio").textContent = t.countries_flavio;

  const leader = $("leader");
  leader.hidden = false;
  leader.replaceChildren();

  if (!t.valid_votes) {
    leader.textContent = "Aguardando os primeiros boletins de urna com votos.";
    return;
  }

  if (t.leader === "tie") {
    leader.textContent = `Empate no total do exterior: ${nf.format(t.lula_votes)} votos para cada candidato nos ${t.countries_reporting} países já divulgados.`;
    return;
  }

  const margin = Math.abs(t.lula_pct - t.flavio_pct);
  const name = t.leader === "lula" ? "Lula" : "Flávio Bolsonaro";
  const cls = t.leader === "lula" ? "is-lula" : "is-flavio";

  const strong = document.createElement("strong");
  strong.textContent = name;
  strong.className = cls;
  leader.append(
    strong,
    ` lidera no exterior com ${pf.format(
      t.leader === "lula" ? t.lula_pct : t.flavio_pct
    )}% dos votos válidos — vantagem de ${pf.format(margin)} pontos, com ${t.countries_reporting} de ${t.countries_total} países já divulgados.`
  );
}

/* ---------- table ---------- */

function voteCell(country, who) {
  const votes = who === "lula" ? country.lula_votes : country.flavio_votes;
  const pct = who === "lula" ? country.lula_pct : country.flavio_pct;
  const published =
    who === "lula" ? country.lula_pct_published : country.flavio_pct_published;

  const cell = document.createElement("div");
  cell.className = `row__vote is-${who}${votes === 0 ? " is-zero" : ""}`;
  cell.setAttribute("role", "cell");

  if (!country.has_data) {
    cell.textContent = "—";
    cell.title = "boletim ainda não divulgado";
    return cell;
  }

  const v = document.createElement("strong");
  v.textContent = nf.format(votes);
  const p = document.createElement("span");
  p.textContent = pctText(pct, published);
  if (!published) p.title = "percentual calculado a partir dos votos; o g1 não publicou este percentual";

  cell.append(v, p);
  return cell;
}

function countryRow(country, showSection) {
  const row = document.createElement("div");
  row.className = "row";
  row.setAttribute("role", "row");

  const cell = document.createElement("div");
  cell.className = "row__country";
  cell.setAttribute("role", "cell");

  const name = document.createElement("span");
  name.className = "row__name";
  name.textContent = country.name;

  cell.append(name);

  if (showSection) {
    const sec = document.createElement("span");
    sec.className = "row__section";
    sec.textContent = country.has_data ? country.section : "sem boletim";
    cell.append(sec);
  }

  row.append(cell, voteCell(country, "lula"), voteCell(country, "flavio"));

  if (country.has_data) {
    const valid = country.lula_votes + country.flavio_votes;
    if (valid > 0) {
      const split = document.createElement("div");
      split.className = "row__split";
      split.setAttribute("aria-hidden", "true");
      const l = document.createElement("i");
      l.className = "s-lula";
      l.style.width = `${(country.lula_votes / valid) * 100}%`;
      const f = document.createElement("i");
      f.className = "s-flavio";
      f.style.width = `${(country.flavio_votes / valid) * 100}%`;
      split.append(l, f);
      row.append(split);
    }
  }

  return row;
}

function renderTable() {
  const rows = $("rows");
  $("only-data-count").textContent = state.data.totals.countries_reporting;
  const items = visibleCountries();
  rows.replaceChildren();

  $("empty").hidden = items.length > 0;

  if (state.sort === "alpha") {
    const groups = new Map();
    for (const c of items) {
      if (!groups.has(c.section)) groups.set(c.section, []);
      groups.get(c.section).push(c);
    }
    for (const [name, list] of groups) {
      const head = document.createElement("div");
      head.className = "group";
      head.setAttribute("role", "row");
      const section = state.data.sections.find((s) => s.name === name);
      const reporting = section.countries.filter((c) => c.has_data).length;
      const label = document.createElement("span");
      label.setAttribute("role", "columnheader");
      label.setAttribute("aria-colspan", "3");
      label.textContent = `${name} · ${reporting} com dados de ${section.countries.length} países`;
      head.append(label);
      rows.append(head);
      for (const c of list) rows.append(countryRow(c, false));
    }
  } else {
    for (const c of items) rows.append(countryRow(c, true));
  }

  const pending = allCountries().filter((c) => !c.has_data);
  $("pending-count").textContent = `${pending.length}`;
  $("pending-wrap").hidden = !state.onlyData || pending.length === 0;

  const chips = $("pending-list");
  chips.replaceChildren();
  for (const c of pending.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = c.name;
    chips.append(chip);
  }
}

/* ---------- tabs / controls ---------- */

function renderTabs() {
  const tabs = $("tabs");
  tabs.replaceChildren();

  const entries = [
    ["all", "Todos", allCountries().filter((c) => c.has_data).length],
    ...state.data.sections.map((s) => [
      s.name,
      s.name,
      s.countries.filter((c) => c.has_data).length,
    ]),
  ];

  for (const [value, label, count] of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab";
    btn.dataset.value = value;
    btn.setAttribute("aria-pressed", String(state.section === value));
    btn.textContent = value === "all" ? label : `${label} · ${count}`;
    btn.addEventListener("click", () => {
      state.section = value;
      renderTabs();
      renderTable();
    });
    tabs.append(btn);
  }
}

/* ---------- freshness ---------- */

function renderTimestamps() {
  if (!state.data) return;
  const generated = new Date(state.data.generated_at);
  const updated = $("updated");
  updated.textContent = `coleta de ${whenFmt.format(generated)} (Brasília)`;
  updated.classList.remove("is-stale", "is-very-stale");

  const mins = ageMinutes();
  const fresh = $("freshness");
  fresh.hidden = false;
  fresh.classList.remove("is-stale", "is-very-stale");

  if (!Number.isFinite(mins) || mins < 1) {
    fresh.textContent = "atualizado agora";
  } else if (mins < 60) {
    fresh.textContent = `atualizado há ${Math.floor(mins)} min`;
  } else {
    const h = Math.floor(mins / 60);
    fresh.textContent = `atualizado há ${h} h`;
  }

  if (mins > 120) {
    fresh.classList.add("is-very-stale");
    fresh.textContent += " · atualização atrasada";
  } else if (mins > STALE_MIN) {
    fresh.classList.add("is-stale");
    fresh.textContent += " · pode estar atrasado";
  }

  if (state.data.source_updated_at) {
    fresh.title = `Página do g1 modificada em ${whenFmt.format(
      new Date(state.data.source_updated_at)
    )} (Brasília)`;
  }
}

/* ---------- load ---------- */

async function load({ quiet = false } = {}) {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (state.data && data.generated_at === state.data.generated_at) {
      renderTimestamps();
      return;
    }

    state.data = data;
    $("source").href = data.source_url;
    renderTotals();
    renderTabs();
    renderTable();
    renderTimestamps();
  } catch (err) {
    if (quiet) return;
    $("updated").textContent =
      "não foi possível carregar os dados — tentando novamente em 1 min";
    $("updated").classList.add("is-very-stale");
    console.error(err);
  }
}

/* ---------- wire up ---------- */

$("only-data").addEventListener("change", (e) => {
  state.onlyData = e.target.checked;
  renderTable();
});

$("sort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderTable();
});

load();
setInterval(() => load({ quiet: true }), REFRESH_MS);
setInterval(renderTimestamps, 30_000);
