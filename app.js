const hubLink = document.getElementById("hub-link");
if (hubLink) {
  hubLink.href = window.TOOLS_HUB_URL;
}

const inputEl = document.getElementById("ip-input");
const fileInput = document.getElementById("file-input");
const dedupeEl = document.getElementById("dedupe");
const lookupBtn = document.getElementById("lookup-btn");
const exportBtn = document.getElementById("export-btn");
const cancelBtn = document.getElementById("cancel-btn");
const pasteBtn = document.getElementById("paste-btn");
const clearBtn = document.getElementById("clear-btn");
const inputErrorEl = document.getElementById("input-error");
const headerStatusEl = document.getElementById("header-status");
const progressWrap = document.getElementById("progress-wrap");
const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");
const progressBar = progressWrap?.querySelector(".progress-bar");
const summarySection = document.getElementById("summary-section");
const tableSection = document.getElementById("table-section");
const statsEl = document.getElementById("stats");
const countriesList = document.getElementById("countries-list");
const citiesList = document.getElementById("cities-list");
const resultsBody = document.getElementById("results-body");
const filterCountEl = document.getElementById("filter-count");
const filterEmptyEl = document.getElementById("filter-empty");
const resetFiltersBtn = document.getElementById("reset-filters-btn");
const filterMenu = document.getElementById("filter-menu");
const filterMenuTitle = document.getElementById("filter-menu-title");
const filterMenuSearch = document.getElementById("filter-menu-search");
const filterMenuAll = document.getElementById("filter-menu-all");
const filterMenuList = document.getElementById("filter-menu-list");
const filterMenuApply = document.getElementById("filter-menu-apply");
const filterMenuClear = document.getElementById("filter-menu-clear");
const filterBtns = [...document.querySelectorAll(".col-filter__btn")];
const toastEl = document.getElementById("toast");

let allRows = [];
let abortController = null;
let columnFilters = {};
let openFilterKey = null;
let openFilterBtn = null;
let pendingFilterValues = new Set();

const FILTER_KEYS = ["ip", "country", "city", "region", "isp"];

const FILTER_LABELS = {
  ip: "IP",
  country: "Страна",
  city: "Город",
  region: "Регион",
  isp: "Провайдер",
};

function initColumnFilters() {
  columnFilters = Object.fromEntries(FILTER_KEYS.map((k) => [k, null]));
  updateFilterButtonStates();
}

function rowFieldValues(row) {
  if (!row.ok) {
    return {
      ip: row.ip,
      country: "—",
      city: "—",
      region: "—",
      isp: row.error || "ошибка",
    };
  }
  return {
    ip: row.ip,
    country: row.country || "—",
    city: row.city || "—",
    region: row.region || "—",
    isp: row.isp || "—",
  };
}

function rowsForColumnFilter(key) {
  return allRows.filter((row) => {
    const fields = rowFieldValues(row);
    return FILTER_KEYS.every((k) => {
      if (k === key) return true;
      const allowed = columnFilters[k];
      if (!allowed) return true;
      return allowed.has(String(fields[k]));
    });
  });
}

function uniqueValuesForColumn(key) {
  const values = rowsForColumnFilter(key).map(
    (row) => String(rowFieldValues(row)[key])
  );
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "ru"));
}

function hasActiveFilters() {
  return FILTER_KEYS.some((key) => columnFilters[key] !== null);
}

function matchesFilters(row) {
  const fields = rowFieldValues(row);
  return FILTER_KEYS.every((key) => {
    const allowed = columnFilters[key];
    if (!allowed) return true;
    return allowed.has(String(fields[key]));
  });
}

function getVisibleRows() {
  if (!hasActiveFilters()) return allRows;
  return allRows.filter((row) => matchesFilters(row));
}

function updateFilterButtonStates() {
  filterBtns.forEach((btn) => {
    const key = btn.dataset.filterKey;
    btn.classList.toggle("col-filter__btn--active", columnFilters[key] !== null);
  });
}

function closeFilterMenu() {
  if (!filterMenu.hidden) {
    filterMenu.hidden = true;
    if (openFilterBtn) {
      openFilterBtn.setAttribute("aria-expanded", "false");
    }
    openFilterKey = null;
    openFilterBtn = null;
  }
}

function syncSelectAllCheckbox() {
  const boxes = [...filterMenuList.querySelectorAll('input[type="checkbox"]')];
  const visible = boxes.filter((el) => el.closest("label").style.display !== "none");
  if (!visible.length) {
    filterMenuAll.checked = false;
    filterMenuAll.indeterminate = false;
    return;
  }
  const checked = visible.filter((el) => el.checked).length;
  filterMenuAll.checked = checked === visible.length;
  filterMenuAll.indeterminate = checked > 0 && checked < visible.length;
}

function renderFilterMenuList(values) {
  filterMenuList.replaceChildren();

  values.forEach((value) => {
    const label = document.createElement("label");
    label.className = "filter-menu__item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked =
      columnFilters[openFilterKey] === null ||
      pendingFilterValues.has(value);

    input.addEventListener("change", () => {
      if (input.checked) pendingFilterValues.add(value);
      else pendingFilterValues.delete(value);
      syncSelectAllCheckbox();
    });

    const span = document.createElement("span");
    span.className = "filter-menu__item-text";
    span.textContent = value;

    label.append(input, span);
    filterMenuList.appendChild(label);
  });

  syncSelectAllCheckbox();
}

function filterMenuListBySearch(query) {
  const q = query.trim().toLowerCase();
  filterMenuList.querySelectorAll(".filter-menu__item").forEach((label) => {
    const text = label.textContent.toLowerCase();
    label.style.display = !q || text.includes(q) ? "" : "none";
  });
  syncSelectAllCheckbox();
}

function openFilterMenu(key, btn) {
  closeFilterMenu();

  openFilterKey = key;
  openFilterBtn = btn;

  const values = uniqueValuesForColumn(key);
  const current = columnFilters[key];

  pendingFilterValues = current ? new Set(current) : new Set(values);

  filterMenuTitle.textContent = FILTER_LABELS[key];
  filterMenuSearch.value = "";
  renderFilterMenuList(values);

  const rect = btn.getBoundingClientRect();
  filterMenu.hidden = false;
  filterMenu.style.top = `${rect.bottom + 4}px`;
  filterMenu.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;

  btn.setAttribute("aria-expanded", "true");
  filterMenuSearch.focus();
}

function applyFilterMenu() {
  if (!openFilterKey) return;

  const values = uniqueValuesForColumn(openFilterKey);
  const checked = values.filter((v) => pendingFilterValues.has(v));

  if (checked.length === 0) {
    showToast("Выберите хотя бы одно значение");
    return;
  }

  columnFilters[openFilterKey] =
    checked.length === values.length ? null : new Set(checked);

  closeFilterMenu();
  updateFilterButtonStates();
  applyFilters();
}

function clearColumnFilter() {
  if (!openFilterKey) return;
  columnFilters[openFilterKey] = null;
  closeFilterMenu();
  updateFilterButtonStates();
  applyFilters();
}

function resetFilters() {
  initColumnFilters();
  closeFilterMenu();
  applyFilters();
}

function updateFilterUi(visibleCount) {
  const total = allRows.length;
  const filtered = hasActiveFilters();

  resetFiltersBtn.hidden = !filtered;

  if (!total) {
    filterCountEl.textContent = "";
    filterEmptyEl.hidden = true;
    return;
  }

  if (filtered && visibleCount !== total) {
    filterCountEl.textContent = `Показано ${visibleCount} из ${total}`;
  } else {
    filterCountEl.textContent = `${total} строк`;
  }

  filterEmptyEl.hidden = visibleCount > 0 || !filtered;
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2200);
}

function setBusy(busy) {
  lookupBtn.disabled = busy;
  inputEl.disabled = busy;
  fileInput.disabled = busy;
  dedupeEl.disabled = busy;
  cancelBtn.hidden = !busy;
  progressWrap.hidden = !busy;
}

function showInputError(message) {
  if (!message) {
    inputErrorEl.hidden = true;
    inputErrorEl.textContent = "";
    return;
  }
  inputErrorEl.textContent = message;
  inputErrorEl.hidden = false;
}

function renderStats(summary, invalidCount) {
  statsEl.replaceChildren();

  const items = [
    ["найдено", summary.ok],
    ["ошибок", summary.fail + invalidCount],
    ["стран", summary.countries.length],
    ["городов", summary.cities.length],
  ];

  items.forEach(([label, value]) => {
    const box = document.createElement("div");
    box.className = "stat card";
    const pLabel = document.createElement("p");
    pLabel.className = "label";
    pLabel.textContent = label;
    const pVal = document.createElement("p");
    pVal.className = "body stat__value";
    pVal.textContent = String(value);
    box.append(pLabel, pVal);
    statsEl.appendChild(box);
  });
}

function renderBreakdown(listEl, entries) {
  listEl.replaceChildren();
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "body secondary";
    li.textContent = "—";
    listEl.appendChild(li);
    return;
  }

  entries.forEach(([name, count]) => {
    const li = document.createElement("li");
    li.className = "breakdown__item";
    const nameSpan = document.createElement("span");
    nameSpan.className = "breakdown__name";
    nameSpan.textContent = name;
    const countSpan = document.createElement("span");
    countSpan.className = "breakdown__count";
    countSpan.textContent = String(count);
    li.append(nameSpan, countSpan);
    listEl.appendChild(li);
  });
}

function renderTable(rows) {
  resultsBody.replaceChildren();

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    if (!row.ok) tr.classList.add("results-table__row--error");

    const fields = rowFieldValues(row);
    const cells = [
      String(index + 1),
      fields.ip,
      fields.country,
      fields.city,
      fields.region,
      fields.isp,
    ];

    cells.forEach((text, i) => {
      const td = document.createElement("td");
      if (i === 1) td.className = "results-table__ip";
      td.textContent = text;
      tr.appendChild(td);
    });

    resultsBody.appendChild(tr);
  });
}

function applyFilters() {
  if (!allRows.length) return;

  const visible = getVisibleRows();
  renderTable(visible);
  updateFilterUi(visible.length);

  const okVisible = visible.filter((row) => row.ok);
  const invalidVisible = visible.filter((row) => !row.ok);
  const summary = summarize(okVisible);

  renderStats(summary, invalidVisible.length);
  renderBreakdown(countriesList, summary.countries);
  renderBreakdown(citiesList, summary.cities);
}

function renderResults(rows, invalid) {
  allRows = [...invalid, ...rows];
  initColumnFilters();
  applyFilters();

  summarySection.hidden = false;
  tableSection.hidden = false;
  exportBtn.disabled = !allRows.length;

  const okCount = rows.filter((r) => r.ok).length;
  headerStatusEl.textContent = `${okCount} из ${allRows.length}`;
}

async function runLookup() {
  showInputError("");
  const { ips, invalid, limited } = prepareIps(
    inputEl.value,
    dedupeEl.checked
  );

  if (!ips.length && !invalid.length) {
    showInputError("Добавьте хотя бы один IP-адрес.");
    return;
  }

  if (limited) {
    showToast(`Обработано первые ${MAX_IPS} адресов`);
  }

  if (!ips.length) {
    renderResults([], invalid);
    showInputError("Нет публичных IP для запроса.");
    return;
  }

  abortController = new AbortController();
  setBusy(true);
  progressFill.style.width = "0%";
  progressText.textContent = `0 / ${ips.length}`;

  try {
    const results = await lookupBatch(ips, {
      signal: abortController.signal,
      onProgress(done, total, statusText) {
        const pct = Math.round((done / total) * 100);
        progressFill.style.width = `${pct}%`;
        progressText.textContent = statusText || `${done} / ${total}`;
        if (progressBar) progressBar.setAttribute("aria-valuenow", String(pct));
      },
    });

    renderResults(results, invalid);
    showToast("Готово");
  } catch {
    showToast("Прервано");
  } finally {
    setBusy(false);
    abortController = null;
  }
}

function exportCsv() {
  const visible = getVisibleRows();
  if (!visible.length) return;
  const blob = new Blob([toCsv(visible)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ip-lookup.csv";
  a.click();
  URL.revokeObjectURL(url);
  showToast("Скачан ip-lookup.csv");
}

async function pasteInput() {
  try {
    inputEl.value = await navigator.clipboard.readText();
    showToast("Вставлено");
  } catch {
    showToast("Нет доступа к буферу");
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (file.size > 512 * 1024) {
    showInputError("Файл слишком большой (макс. 512 KB).");
    fileInput.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    inputEl.value = String(reader.result ?? "");
    showToast(`Загружен ${file.name}`);
    fileInput.value = "";
  };
  reader.onerror = () => showToast("Не удалось прочитать файл");
  reader.readAsText(file);
});

lookupBtn.addEventListener("click", runLookup);
exportBtn.addEventListener("click", exportCsv);
pasteBtn.addEventListener("click", pasteInput);
clearBtn.addEventListener("click", () => {
  if (abortController) abortController.abort();
  inputEl.value = "";
  allRows = [];
  initColumnFilters();
  closeFilterMenu();
  summarySection.hidden = true;
  tableSection.hidden = true;
  exportBtn.disabled = true;
  headerStatusEl.textContent = "";
  filterCountEl.textContent = "";
  filterEmptyEl.hidden = true;
  showInputError("");
  inputEl.focus();
});
cancelBtn.addEventListener("click", () => abortController?.abort());

filterBtns.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const key = btn.dataset.filterKey;
    if (openFilterKey === key && !filterMenu.hidden) {
      closeFilterMenu();
    } else {
      openFilterMenu(key, btn);
    }
  });
});

filterMenuApply.addEventListener("click", applyFilterMenu);
filterMenuClear.addEventListener("click", clearColumnFilter);
filterMenuSearch.addEventListener("input", () => {
  filterMenuListBySearch(filterMenuSearch.value);
});

filterMenuAll.addEventListener("change", () => {
  const checked = filterMenuAll.checked;
  filterMenuList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    const label = input.closest("label");
    if (label.style.display === "none") return;
    input.checked = checked;
    if (checked) pendingFilterValues.add(input.value);
    else pendingFilterValues.delete(input.value);
  });
  syncSelectAllCheckbox();
});

document.addEventListener("click", (e) => {
  if (
    !filterMenu.hidden &&
    !filterMenu.contains(e.target) &&
    !e.target.closest(".col-filter__btn")
  ) {
    closeFilterMenu();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeFilterMenu();
});

resetFiltersBtn.addEventListener("click", resetFilters);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (!lookupBtn.disabled) runLookup();
  }
});
