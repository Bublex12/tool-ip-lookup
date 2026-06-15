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
const toastEl = document.getElementById("toast");

let allRows = [];
let abortController = null;

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

    const cells = row.ok
      ? [
          String(index + 1),
          row.ip,
          row.country,
          row.city,
          row.region,
          row.isp,
        ]
      : [String(index + 1), row.ip, "—", "—", "—", row.error || "ошибка"];

    cells.forEach((text, i) => {
      const td = document.createElement("td");
      if (i === 1) td.className = "results-table__ip";
      td.textContent = text;
      tr.appendChild(td);
    });

    resultsBody.appendChild(tr);
  });
}

function renderResults(rows, invalid) {
  allRows = [...invalid, ...rows];
  const summary = summarize(rows);

  renderStats(summary, invalid.length);
  renderBreakdown(countriesList, summary.countries);
  renderBreakdown(citiesList, summary.cities);
  renderTable(allRows);

  summarySection.hidden = false;
  tableSection.hidden = false;
  exportBtn.disabled = !allRows.length;

  headerStatusEl.textContent = `${summary.ok} из ${allRows.length}`;
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
      onProgress(done, total) {
        const pct = Math.round((done / total) * 100);
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `${done} / ${total}`;
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
  if (!allRows.length) return;
  const blob = new Blob([toCsv(allRows)], {
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
  summarySection.hidden = true;
  tableSection.hidden = true;
  exportBtn.disabled = true;
  headerStatusEl.textContent = "";
  showInputError("");
  inputEl.focus();
});
cancelBtn.addEventListener("click", () => abortController?.abort());

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (!lookupBtn.disabled) runLookup();
  }
});
