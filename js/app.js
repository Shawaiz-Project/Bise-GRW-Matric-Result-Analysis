/* global Chart */

(() => {
  "use strict";

  const BUNDLED_WORKBOOK_URL = "data/MA_2026_results_analysis.xlsx";
  const BUNDLED_WORKBOOK_NAME = "MA_2026_results_analysis.xlsx";

  const state = {
    worker: null,
    ready: false,
    payload: null,
    charts: new Map(),
    currentStudentPage: 1,
    currentStudentRequestId: 0,
    currentDetailRequestId: 0,
    currentExportRequestId: 0,
    schoolRows: [],
    subjectRows: [],
  };

  const pageMeta = {
    overview: ["Overview", "Interactive analysis of the complete result workbook"],
    students: ["Students", "Search, filter, inspect, and export candidate records"],
    schools: ["Schools", "Compare institution size, outcomes, and academic performance"],
    subjects: ["Subjects", "Analyze failed-subject and supplementary-slip patterns"],
    insights: ["Insights", "Automatically generated findings from the workbook"],
    quality: ["Data quality", "Review extraction checks and retained anomalies"],
  };

  const chartPalette = [
    "#2457d6",
    "#12a678",
    "#e14e5d",
    "#f0a126",
    "#7047d7",
    "#178aa5",
    "#df6b2b",
    "#72839f",
    "#9e4f9e",
    "#66a331",
    "#bb516f",
    "#3b78aa",
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/,/g, "").replace(/%$/, ""));
    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value) {
    const number = toNumber(value);
    return number === null ? "—" : Math.round(number).toLocaleString("en-US");
  }

  function formatDecimal(value) {
    const number = toNumber(value);
    return number === null
      ? "—"
      : number.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatPercent(value) {
    const number = toNumber(value);
    return number === null
      ? "—"
      : `${number.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
  }

  function shortText(value, maxLength = 42) {
    const text = String(value ?? "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}…`;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function showToast(title, message, type = "success", timeout = 4200) {
    const container = $("#toastContainer");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    window.setTimeout(() => toast.remove(), timeout);
  }

  function setDataStatus(mode, text) {
    const pill = $("#dataStatusPill");
    pill.classList.remove("ready", "loading", "error");
    if (mode) pill.classList.add(mode);
    const label = pill.querySelector("span:last-child");
    if (label) label.textContent = text;
  }

  function setProgress(percent, message) {
    $("#uploadProgress").classList.remove("hidden");
    $("#progressText").textContent = message || "Processing workbook";
    $("#progressPercent").textContent = `${Math.round(percent)}%`;
    $("#progressBar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function createWorker() {
    if (state.worker) state.worker.terminate();
    state.worker = new Worker("js/data-worker.js");
    state.worker.addEventListener("message", handleWorkerMessage);
    state.worker.addEventListener("error", (event) => {
      setDataStatus("error", "Worker error");
      showToast("Dashboard error", event.message || "The data worker could not start.", "error", 7000);
    });
  }

  function handleWorkerMessage(event) {
    const message = event.data || {};
    if (message.type === "progress") {
      setDataStatus("loading", message.message || "Loading data");
      setProgress(message.percent || 0, message.message || "Processing workbook");
      return;
    }
    if (message.type === "ready") {
      handleWorkbookReady(message.payload);
      return;
    }
    if (message.type === "studentResults") {
      if (message.requestId !== state.currentStudentRequestId) return;
      renderStudentResults(message);
      return;
    }
    if (message.type === "studentDetail") {
      if (message.requestId !== state.currentDetailRequestId) return;
      renderStudentModal(message.student);
      return;
    }
    if (message.type === "exportReady") {
      if (message.requestId !== state.currentExportRequestId) return;
      downloadCsv(message.csv, `student_search_results_${new Date().toISOString().slice(0, 10)}.csv`);
      const note = message.truncated
        ? `Exported ${formatNumber(message.exported)} of ${formatNumber(message.matched)} matches. The export limit is 50,000 rows.`
        : `Exported ${formatNumber(message.exported)} matching records.`;
      showToast("CSV created", note, "success");
      return;
    }
    if (message.type === "error") {
      setDataStatus("error", "Data error");
      showToast("Could not process data", message.message || "Unknown worker error", "error", 8000);
    }
  }

  async function loadWorkbookFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      showToast("Unsupported file", "Select an Excel workbook ending in .xlsx or .xls.", "error");
      return;
    }

    try {
      state.ready = false;
      setDataStatus("loading", "Reading workbook");
      setProgress(2, "Reading selected file");
      $("#uploadOverlay").classList.remove("hidden");
      const buffer = await file.arrayBuffer();
      createWorker();
      state.worker.postMessage({ type: "loadWorkbook", buffer, fileName: file.name }, [buffer]);
    } catch (error) {
      setDataStatus("error", "Upload failed");
      showToast("Upload failed", error.message || String(error), "error", 8000);
    }
  }

  async function loadBundledWorkbook() {
    try {
      state.ready = false;
      setDataStatus("loading", "Loading integrated workbook");
      setProgress(4, "Downloading integrated Excel workbook");
      $("#uploadOverlay").classList.remove("hidden");

      const response = await fetch(BUNDLED_WORKBOOK_URL, { cache: "default" });
      if (!response.ok) {
        throw new Error(`Integrated workbook was not found (${response.status}). Expected: ${BUNDLED_WORKBOOK_URL}`);
      }

      const contentLength = Number(response.headers.get("content-length")) || 0;
      if (contentLength > 0) {
        const sizeMb = contentLength / (1024 * 1024);
        setProgress(12, `Downloading ${sizeMb.toFixed(1)} MB workbook`);
      } else {
        setProgress(12, "Downloading integrated workbook");
      }

      const buffer = await response.arrayBuffer();
      setProgress(22, "Workbook downloaded; starting analysis");
      createWorker();
      state.worker.postMessage({
        type: "loadWorkbook",
        buffer,
        fileName: BUNDLED_WORKBOOK_NAME,
      }, [buffer]);
    } catch (error) {
      setDataStatus("error", "Integrated workbook unavailable");
      $("#uploadProgress").classList.add("hidden");
      showToast(
        "Workbook not found",
        `${error.message || error}. Upload ${BUNDLED_WORKBOOK_NAME} manually or place it in the data folder.`,
        "error",
        10000
      );
    }
  }

  function handleWorkbookReady(payload) {
    if (!payload) return;
    state.ready = true;
    state.payload = payload;
    state.schoolRows = [...(payload.institutions || [])];
    state.subjectRows = [...(payload.subjectFailures || [])];

    $("#sourceFileName").textContent = payload.sourceFileName || "Result workbook";
    $("#sourceRecordCount").textContent = `${formatNumber(payload.summary.totalExtracted)} student records`;
    setDataStatus("ready", "Workbook ready");
    setProgress(100, "Dashboard ready");
    window.setTimeout(() => $("#uploadOverlay").classList.add("hidden"), 320);

    populateFilterOptions(payload.filterOptions || {});
    renderEverything();
    runStudentSearch(1);
    showToast("Workbook loaded", `${formatNumber(payload.summary.totalExtracted)} student records are ready for analysis.`, "success");
  }

  function populateFilterOptions(options) {
    const statusSelect = $("#studentStatusFilter");
    statusSelect.innerHTML = '<option value="">All statuses</option>';
    (options.statuses || []).forEach((status) => {
      statusSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`);
    });

    const typeSelect = $("#studentTypeFilter");
    typeSelect.innerHTML = '<option value="">All candidate types</option>';
    (options.candidateTypes || []).forEach((type) => {
      typeSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`);
    });
  }

  function renderEverything() {
    renderOverviewKpis();
    renderOverviewCharts();
    renderTopStudents();
    renderSchoolPage();
    renderSubjectPage();
    renderInsights();
    renderQuality();
  }

  function renderOverviewKpis() {
    const summary = state.payload.summary;
    const items = [
      ["Extracted candidates", formatNumber(summary.totalExtracted), "Workbook total"],
      ["Appeared", formatNumber(summary.appeared), "Absent and cancelled excluded"],
      ["Passed", formatNumber(summary.passed), "Successful candidates"],
      ["Pass percentage", formatPercent(summary.passPercentage), "Passed ÷ appeared"],
      ["Fail / subject slip", formatNumber(summary.failSlip), "Direct subject-slip cases"],
      ["Highest marks", formatNumber(summary.highestMarks), "Maximum numeric result"],
      ["Average marks", formatDecimal(summary.averageMarks), `Median: ${formatDecimal(summary.medianMarks)}`],
      ["Schools", formatNumber(summary.schoolCount), `${formatNumber(summary.subjectCount)} subject codes summarized`],
    ];
    $("#overviewKpis").innerHTML = items.map(([label, value, note]) => `
      <article class="kpi-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(note)}</small>
      </article>
    `).join("");
  }

  function chartDefaults() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: cssVar("--muted"), usePointStyle: true, boxWidth: 8, padding: 16 },
        },
        tooltip: {
          backgroundColor: cssVar("--text"),
          titleColor: cssVar("--surface"),
          bodyColor: cssVar("--surface"),
          padding: 11,
          cornerRadius: 9,
        },
      },
      scales: {
        x: {
          grid: { color: cssVar("--border") },
          ticks: { color: cssVar("--muted"), maxRotation: 45, minRotation: 0 },
          border: { color: cssVar("--border") },
        },
        y: {
          beginAtZero: true,
          grid: { color: cssVar("--border") },
          ticks: { color: cssVar("--muted") },
          border: { color: cssVar("--border") },
        },
      },
    };
  }

  function createChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === "undefined") return;
    const existing = state.charts.get(id);
    if (existing) existing.destroy();
    const chart = new Chart(canvas, config);
    state.charts.set(id, chart);
  }

  function horizontalBarOptions({ percent = false, stacked = false } = {}) {
    const options = chartDefaults();
    options.indexAxis = "y";
    options.scales.x.stacked = stacked;
    options.scales.y.stacked = stacked;
    options.scales.y.grid.display = false;
    options.scales.y.ticks.autoSkip = false;
    if (percent) {
      options.scales.x.max = 100;
      options.scales.x.ticks.callback = (value) => `${value}%`;
    }
    return options;
  }

  function renderOverviewCharts() {
    const { summary, statusSummary, marksDistribution, candidateTypes, subjectFailures, institutions } = state.payload;
    const passData = [summary.passed, summary.notPassed];
    createChart("passFailChart", {
      type: "doughnut",
      data: {
        labels: ["Passed", "Not passed among appeared"],
        datasets: [{ data: passData, backgroundColor: ["#12a678", "#e14e5d"], borderWidth: 0, hoverOffset: 6 }],
      },
      options: {
        ...chartDefaults(),
        cutout: "67%",
        plugins: {
          ...chartDefaults().plugins,
          tooltip: {
            ...chartDefaults().plugins.tooltip,
            callbacks: {
              label: (context) => `${context.label}: ${formatNumber(context.raw)} (${formatPercent((context.raw / summary.appeared) * 100)})`,
            },
          },
        },
      },
    });

    const statuses = [...statusSummary].sort((a, b) => b.students - a.students);
    createChart("statusChart", {
      type: "doughnut",
      data: {
        labels: statuses.map((row) => row.status),
        datasets: [{ data: statuses.map((row) => row.students), backgroundColor: chartPalette, borderWidth: 0, hoverOffset: 5 }],
      },
      options: { ...chartDefaults(), cutout: "54%" },
    });

    createChart("marksChart", {
      type: "line",
      data: {
        labels: marksDistribution.ranges.map((row) => row.range),
        datasets: [{
          label: "Students",
          data: marksDistribution.ranges.map((row) => row.students),
          borderColor: "#2457d6",
          backgroundColor: "rgba(36,87,214,0.14)",
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 5,
        }],
      },
      options: chartDefaults(),
    });

    createChart("gradeChart", {
      type: "bar",
      data: {
        labels: marksDistribution.grades.map((row) => row.grade),
        datasets: [{
          label: "Students",
          data: marksDistribution.grades.map((row) => row.students),
          backgroundColor: chartPalette.slice(0, marksDistribution.grades.length),
          borderRadius: 7,
        }],
      },
      options: chartDefaults(),
    });

    createChart("candidateTypeChart", {
      type: "bar",
      data: {
        labels: candidateTypes.map((row) => row.type),
        datasets: [
          { label: "Passed", data: candidateTypes.map((row) => row.passed), backgroundColor: "#12a678", borderRadius: 5 },
          { label: "Not passed / other", data: candidateTypes.map((row) => row.other), backgroundColor: "#e14e5d", borderRadius: 5 },
        ],
      },
      options: {
        ...chartDefaults(),
        scales: {
          x: { ...chartDefaults().scales.x, stacked: true },
          y: { ...chartDefaults().scales.y, stacked: true },
        },
      },
    });

    const topSubjects = [...subjectFailures].sort((a, b) => b.uniqueStudents - a.uniqueStudents).slice(0, 12).reverse();
    createChart("subjectFailureChart", {
      type: "bar",
      data: {
        labels: topSubjects.map((row) => shortText(row.name || row.code, 35)),
        datasets: [{ label: "Unique students", data: topSubjects.map((row) => row.uniqueStudents), backgroundColor: "#7047d7", borderRadius: 5 }],
      },
      options: horizontalBarOptions(),
    });

    const topPartSubjects = [...subjectFailures].sort((a, b) => b.total - a.total).slice(0, 10).reverse();
    createChart("subjectPartsChart", {
      type: "bar",
      data: {
        labels: topPartSubjects.map((row) => shortText(row.name || row.code, 34)),
        datasets: [
          { label: "Part I", data: topPartSubjects.map((row) => row.part1), backgroundColor: "#2457d6", borderRadius: 4 },
          { label: "Part II", data: topPartSubjects.map((row) => row.part2), backgroundColor: "#f0a126", borderRadius: 4 },
        ],
      },
      options: horizontalBarOptions({ stacked: true }),
    });

    const largest = [...institutions].sort((a, b) => b.candidates - a.candidates).slice(0, 10).reverse();
    createChart("largestSchoolsChart", {
      type: "bar",
      data: {
        labels: largest.map((row) => shortText(row.name || row.code, 34)),
        datasets: [{ label: "Candidates", data: largest.map((row) => row.candidates), backgroundColor: "#178aa5", borderRadius: 5 }],
      },
      options: horizontalBarOptions(),
    });

    const bestPass = [...institutions]
      .filter((row) => row.candidates >= 20)
      .sort((a, b) => b.passPercentage - a.passPercentage || b.candidates - a.candidates)
      .slice(0, 10)
      .reverse();
    createChart("schoolPassRateChart", {
      type: "bar",
      data: {
        labels: bestPass.map((row) => shortText(row.name || row.code, 34)),
        datasets: [{ label: "Pass %", data: bestPass.map((row) => row.passPercentage), backgroundColor: "#12a678", borderRadius: 5 }],
      },
      options: horizontalBarOptions({ percent: true }),
    });
  }

  function renderTopStudents() {
    const rows = (state.payload.topStudents || []).slice(0, 15);
    const tbody = $("#topStudentsTable tbody");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No top-student summary is available.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td class="numeric">${escapeHtml(row.rank ?? "—")}</td>
        <td>${escapeHtml(row.roll)}</td>
        <td class="name-cell"><strong>${escapeHtml(row.name)}</strong></td>
        <td class="numeric">${formatNumber(row.marks)}</td>
        <td><span class="grade-badge">${escapeHtml(row.grade || "—")}</span></td>
        <td class="school-cell" title="${escapeHtml(row.institutionName)}">${escapeHtml(shortText(row.institutionName, 48))}</td>
      </tr>
    `).join("");
  }

  function currentStudentFilters() {
    return {
      query: $("#studentQuery").value.trim(),
      field: $("#studentSearchField").value,
      status: $("#studentStatusFilter").value,
      grade: $("#studentGradeFilter").value,
      candidateType: $("#studentTypeFilter").value,
      minMarks: $("#studentMinMarks").value,
      maxMarks: $("#studentMaxMarks").value,
      school: $("#studentSchoolFilter").value.trim(),
    };
  }

  function runStudentSearch(page = 1) {
    if (!state.ready || !state.worker) return;
    state.currentStudentPage = page;
    state.currentStudentRequestId += 1;
    $("#studentResultSummary").textContent = "Searching student records…";
    state.worker.postMessage({
      type: "searchStudents",
      requestId: state.currentStudentRequestId,
      filters: currentStudentFilters(),
      page,
      pageSize: Number($("#studentPageSize").value) || 50,
    });
  }

  function statusClass(status) {
    if (status === "PASS") return "status-pass";
    if (/FAIL|DISQUALIFIED|CANCELLED|NOT_ELIGIBLE/.test(status)) return "status-fail";
    if (/RESULT_LATER|ABSENT|SECOND_NOTIFICATION|UNKNOWN|MISSING/.test(status)) return "status-warning";
    return "status-neutral";
  }

  function renderStudentResults(message) {
    const tbody = $("#studentsTable tbody");
    $("#studentResultSummary").textContent = `${formatNumber(message.total)} matching students · page ${formatNumber(message.page)} of ${formatNumber(message.pages)}`;
    if (!message.results.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">No student matches the selected search and filters.</td></tr>';
      renderPagination(message.page, message.pages);
      return;
    }

    tbody.innerHTML = message.results.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.roll)}</strong><br><small>Page ${escapeHtml(row.pdfPage ?? "—")}</small></td>
        <td class="name-cell"><strong>${escapeHtml(row.name || "Unknown")}</strong><small>${escapeHtml(row.institutionCode || "")}</small></td>
        <td>${escapeHtml(row.type || "—")}</td>
        <td class="school-cell" title="${escapeHtml(row.institutionName)}">${escapeHtml(shortText(row.institutionName || "—", 55))}</td>
        <td><span class="status-badge ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
        <td class="numeric">${formatNumber(row.marks)}</td>
        <td class="numeric">${formatPercent(row.percentage)}</td>
        <td><span class="grade-badge">${escapeHtml(row.grade || "—")}</span></td>
        <td title="${escapeHtml(row.allFailedNames)}">${escapeHtml(shortText(row.allFailedNames || "—", 42))}</td>
        <td><button class="view-button" type="button" data-student-roll="${escapeHtml(row.roll)}">View</button></td>
      </tr>
    `).join("");
    renderPagination(message.page, message.pages);
  }

  function renderPagination(page, pages) {
    const container = $("#studentPagination");
    const maxButtons = 7;
    let start = Math.max(1, page - Math.floor(maxButtons / 2));
    let end = Math.min(pages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);
    const buttons = [];
    buttons.push(`<button type="button" data-page-number="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>`);
    if (start > 1) {
      buttons.push('<button type="button" data-page-number="1">1</button>');
      if (start > 2) buttons.push('<button type="button" disabled>…</button>');
    }
    for (let current = start; current <= end; current += 1) {
      buttons.push(`<button type="button" data-page-number="${current}" class="${current === page ? "active" : ""}">${current}</button>`);
    }
    if (end < pages) {
      if (end < pages - 1) buttons.push('<button type="button" disabled>…</button>');
      buttons.push(`<button type="button" data-page-number="${pages}">${pages}</button>`);
    }
    buttons.push(`<button type="button" data-page-number="${page + 1}" ${page >= pages ? "disabled" : ""}>›</button>`);
    container.innerHTML = buttons.join("");
  }

  function requestStudentDetail(roll) {
    if (!state.worker) return;
    state.currentDetailRequestId += 1;
    state.worker.postMessage({ type: "getStudent", requestId: state.currentDetailRequestId, roll });
  }

  function renderStudentModal(student) {
    if (!student) {
      showToast("Student not found", "The requested roll number was not found in the loaded workbook.", "error");
      return;
    }
    $("#studentModalTitle").textContent = `${student.name || "Candidate"} · ${student.roll}`;
    const details = [
      ["Roll number", student.roll],
      ["Candidate name", student.name],
      ["Candidate type", student.type],
      ["Status", student.status],
      ["Marks", formatNumber(student.marks)],
      ["Percentage", formatPercent(student.percentage)],
      ["Grade", student.grade || "—"],
      ["Failed subject count", formatNumber(student.failedCount)],
      ["Institution code", student.institutionCode],
      ["Institution name", student.institutionName, true],
      ["Part-I failed subjects", student.partINames || student.partICodes || "—", true],
      ["Part-II failed subjects", student.partIINames || student.partIICodes || "—", true],
      ["Status flags", student.statusFlags || "—", true],
      ["Raw result", student.rawResult || "—", true],
      ["PDF location", `Page ${student.pdfPage ?? "—"}, column ${student.pdfColumn ?? "—"}`],
      ["Unknown parsed items", student.unknownItems || "—", true],
    ];
    $("#studentModalBody").innerHTML = `<div class="detail-grid">${details.map(([label, value, full]) => `
      <div class="detail-item ${full ? "full" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "—")}</strong></div>
    `).join("")}</div>`;
    $("#studentModal").classList.remove("hidden");
  }

  function renderSchoolPage() {
    const schools = state.payload.institutions || [];
    const with20 = schools.filter((row) => row.candidates >= 20);
    const bestPass = [...with20].sort((a, b) => b.passPercentage - a.passPercentage || b.candidates - a.candidates)[0];
    const largest = [...schools].sort((a, b) => b.candidates - a.candidates)[0];
    const bestAverage = [...with20].filter((row) => row.averageMarks !== null).sort((a, b) => b.averageMarks - a.averageMarks)[0];
    const items = [
      ["Institutions", formatNumber(schools.length)],
      ["Median school size", formatDecimal(state.payload.summary.medianSchoolSize)],
      ["Largest institution", largest ? formatNumber(largest.candidates) : "—"],
      ["Best qualifying pass rate", bestPass ? formatPercent(bestPass.passPercentage) : "—"],
    ];
    $("#schoolKpis").innerHTML = items.map(([label, value]) => `<article class="mini-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
    if (bestAverage) $("#schoolKpis").title = `${bestAverage.name}: average marks ${formatDecimal(bestAverage.averageMarks)}`;
    applySchoolFilters();
  }

  function applySchoolFilters() {
    if (!state.ready) return;
    const query = $("#schoolQuery").value.trim().toLocaleLowerCase();
    const minCandidates = Math.max(0, Number($("#schoolMinCandidates").value) || 0);
    const sortBy = $("#schoolSort").value;
    const sorters = {
      candidates: (a, b) => b.candidates - a.candidates,
      passRate: (a, b) => b.passPercentage - a.passPercentage || b.candidates - a.candidates,
      averageMarks: (a, b) => (b.averageMarks ?? -Infinity) - (a.averageMarks ?? -Infinity),
      highestMarks: (a, b) => (b.highestMarks ?? -Infinity) - (a.highestMarks ?? -Infinity),
    };
    state.schoolRows = (state.payload.institutions || [])
      .filter((row) => row.candidates >= minCandidates)
      .filter((row) => !query || `${row.code} ${row.name}`.toLocaleLowerCase().includes(query))
      .sort(sorters[sortBy] || sorters.candidates);
    renderSchoolTable();
    renderSchoolCharts(minCandidates);
  }

  function renderSchoolTable() {
    const rows = state.schoolRows.slice(0, 500);
    $("#schoolTableSummary").textContent = `${formatNumber(state.schoolRows.length)} matching institutions${state.schoolRows.length > 500 ? " · first 500 shown" : ""}`;
    const tbody = $("#schoolsTable tbody");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">No institution matches the selected filters.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.code)}</td>
        <td class="school-cell"><strong>${escapeHtml(row.name)}</strong></td>
        <td class="numeric">${formatNumber(row.candidates)}</td>
        <td class="numeric">${formatNumber(row.passed)}</td>
        <td class="numeric">${formatNumber(row.failSlip)}</td>
        <td class="numeric">${formatNumber(row.absent)}</td>
        <td class="numeric">${formatNumber(row.resultLater)}</td>
        <td class="numeric">${formatPercent(row.passPercentage)}</td>
        <td class="numeric">${formatDecimal(row.averageMarks)}</td>
        <td class="numeric">${formatNumber(row.highestMarks)}</td>
      </tr>
    `).join("");
  }

  function renderSchoolCharts(minCandidates) {
    const eligible = (state.payload.institutions || []).filter((row) => row.candidates >= minCandidates);
    const topPass = [...eligible].sort((a, b) => b.passPercentage - a.passPercentage || b.candidates - a.candidates).slice(0, 12).reverse();
    const topAverage = [...eligible].filter((row) => row.averageMarks !== null).sort((a, b) => b.averageMarks - a.averageMarks).slice(0, 12).reverse();

    createChart("schoolsPassChart", {
      type: "bar",
      data: {
        labels: topPass.map((row) => shortText(row.name || row.code, 36)),
        datasets: [{ label: "Pass %", data: topPass.map((row) => row.passPercentage), backgroundColor: "#12a678", borderRadius: 5 }],
      },
      options: horizontalBarOptions({ percent: true }),
    });
    createChart("schoolsAverageChart", {
      type: "bar",
      data: {
        labels: topAverage.map((row) => shortText(row.name || row.code, 36)),
        datasets: [{ label: "Average marks", data: topAverage.map((row) => row.averageMarks), backgroundColor: "#2457d6", borderRadius: 5 }],
      },
      options: horizontalBarOptions(),
    });
  }

  function renderSubjectPage() {
    const subjects = state.payload.subjectFailures || [];
    const totalEntries = subjects.reduce((sum, row) => sum + row.total, 0);
    const totalUniqueSum = subjects.reduce((sum, row) => sum + row.uniqueStudents, 0);
    const largest = [...subjects].sort((a, b) => b.uniqueStudents - a.uniqueStudents)[0];
    const part2Entries = subjects.reduce((sum, row) => sum + row.part2, 0);
    const items = [
      ["Subject codes", formatNumber(subjects.length)],
      ["Total slip entries", formatNumber(totalEntries)],
      ["Unique-student sum", formatNumber(totalUniqueSum)],
      ["Part-II share", formatPercent(totalEntries ? (part2Entries / totalEntries) * 100 : 0)],
    ];
    $("#subjectKpis").innerHTML = items.map(([label, value]) => `<article class="mini-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
    if (largest) $("#subjectKpis").title = `Leading subject: ${largest.name} (${formatNumber(largest.uniqueStudents)} unique students)`;
    applySubjectFilters();
  }

  function applySubjectFilters() {
    if (!state.ready) return;
    const query = $("#subjectQuery").value.trim().toLocaleLowerCase();
    const sortBy = $("#subjectSort").value;
    const sorters = {
      unique: (a, b) => b.uniqueStudents - a.uniqueStudents,
      total: (a, b) => b.total - a.total,
      part1: (a, b) => b.part1 - a.part1,
      part2: (a, b) => b.part2 - a.part2,
    };
    state.subjectRows = (state.payload.subjectFailures || [])
      .filter((row) => !query || `${row.code} ${row.name}`.toLocaleLowerCase().includes(query))
      .sort(sorters[sortBy] || sorters.unique);
    renderSubjectTable();
    renderSubjectCharts();
  }

  function renderSubjectTable() {
    const rows = state.subjectRows;
    $("#subjectTableSummary").textContent = `${formatNumber(rows.length)} matching subject records`;
    const tbody = $("#subjectsTable tbody");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No subject matches the selected search.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.code)}</strong></td>
        <td>${escapeHtml(row.name)}</td>
        <td class="numeric">${formatNumber(row.part1)}</td>
        <td class="numeric">${formatNumber(row.part2)}</td>
        <td class="numeric">${formatNumber(row.total)}</td>
        <td class="numeric">${formatNumber(row.uniqueStudents)}</td>
        <td class="numeric">${formatPercent(row.total ? (row.part2 / row.total) * 100 : 0)}</td>
      </tr>
    `).join("");
  }

  function renderSubjectCharts() {
    const topUnique = [...state.subjectRows].sort((a, b) => b.uniqueStudents - a.uniqueStudents).slice(0, 14).reverse();
    const topTotal = [...state.subjectRows].sort((a, b) => b.total - a.total).slice(0, 12).reverse();
    createChart("subjectsUniqueChart", {
      type: "bar",
      data: {
        labels: topUnique.map((row) => shortText(row.name || row.code, 37)),
        datasets: [{ label: "Unique students", data: topUnique.map((row) => row.uniqueStudents), backgroundColor: "#7047d7", borderRadius: 5 }],
      },
      options: horizontalBarOptions(),
    });
    createChart("subjectsPartChart", {
      type: "bar",
      data: {
        labels: topTotal.map((row) => shortText(row.name || row.code, 37)),
        datasets: [
          { label: "Part I", data: topTotal.map((row) => row.part1), backgroundColor: "#2457d6", borderRadius: 4 },
          { label: "Part II", data: topTotal.map((row) => row.part2), backgroundColor: "#f0a126", borderRadius: 4 },
        ],
      },
      options: horizontalBarOptions({ stacked: true }),
    });
  }

  function renderInsights() {
    const insights = state.payload.insights || [];
    $("#insightGrid").innerHTML = insights.map((item, index) => `
      <article class="insight-card" data-watermark="${String(index + 1).padStart(2, "0")}">
        <span class="insight-number">INSIGHT ${String(index + 1).padStart(2, "0")}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.text)}</p>
      </article>
    `).join("");

    const scatterRows = (state.payload.institutions || [])
      .filter((row) => row.candidates >= 10 && Number.isFinite(row.passPercentage))
      .slice(0, 2500);
    createChart("schoolScatterChart", {
      type: "scatter",
      data: {
        datasets: [{
          label: "Institutions",
          data: scatterRows.map((row) => ({ x: row.candidates, y: row.passPercentage, school: row.name })),
          backgroundColor: "rgba(36,87,214,0.48)",
          pointRadius: 3,
          pointHoverRadius: 6,
        }],
      },
      options: {
        ...chartDefaults(),
        parsing: false,
        scales: {
          x: { ...chartDefaults().scales.x, title: { display: true, text: "Candidates", color: cssVar("--muted") } },
          y: { ...chartDefaults().scales.y, min: 0, max: 100, title: { display: true, text: "Pass percentage", color: cssVar("--muted") }, ticks: { color: cssVar("--muted"), callback: (value) => `${value}%` } },
        },
        plugins: {
          ...chartDefaults().plugins,
          tooltip: {
            ...chartDefaults().plugins.tooltip,
            callbacks: {
              label: (context) => `${context.raw.school}: ${formatNumber(context.raw.x)} candidates, ${formatPercent(context.raw.y)}`,
            },
          },
        },
      },
    });

    const statusRows = [...(state.payload.statusSummary || [])].sort((a, b) => b.percentExtracted - a.percentExtracted).reverse();
    createChart("statusPercentChart", {
      type: "bar",
      data: {
        labels: statusRows.map((row) => row.status),
        datasets: [{ label: "% of extracted", data: statusRows.map((row) => row.percentExtracted), backgroundColor: chartPalette, borderRadius: 5 }],
      },
      options: horizontalBarOptions({ percent: true }),
    });
  }

  function renderQuality() {
    const rows = state.payload.dataQuality || [];
    const tbody = $("#qualityTable tbody");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">No data-quality sheet was found in the workbook.</td></tr>';
      $("#qualityBanner").className = "quality-banner warning";
      $("#qualityBanner").innerHTML = "<strong>Quality summary unavailable.</strong><span>The workbook does not contain a readable Data_Quality sheet.</span>";
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr><td><strong>${escapeHtml(row.check)}</strong></td><td class="numeric">${escapeHtml(row.value)}</td><td>${escapeHtml(row.notes)}</td></tr>
    `).join("");

    const warnings = rows.filter((row) => {
      const number = toNumber(row.value);
      return number !== null && number > 0 && /duplicate|missing|unknown|unmapped/i.test(row.check);
    });
    const banner = $("#qualityBanner");
    if (warnings.length) {
      banner.className = "quality-banner warning";
      banner.innerHTML = `<strong>${formatNumber(warnings.length)} warning checks require review.</strong><span>The original result text remains available in the Students sheet and student detail view.</span>`;
    } else {
      banner.className = "quality-banner good";
      banner.innerHTML = "<strong>Main extraction checks contain no non-zero warning.</strong><span>Continue to verify unusual and high-stakes records against the original gazette.</span>";
    }
  }

  function exportStudents() {
    if (!state.ready || !state.worker) {
      showToast("No data", "Load a workbook before exporting student records.", "error");
      return;
    }
    state.currentExportRequestId += 1;
    showToast("Preparing export", "Filtered records are being converted to CSV.", "success");
    state.worker.postMessage({
      type: "exportStudents",
      requestId: state.currentExportRequestId,
      filters: currentStudentFilters(),
      limit: 50000,
    });
  }

  function downloadCsv(csv, fileName) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function switchPage(pageName) {
    if (!pageMeta[pageName]) return;
    $$(".page-section").forEach((section) => section.classList.toggle("active", section.dataset.page === pageName));
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.pageTarget === pageName));
    const [title, subtitle] = pageMeta[pageName];
    $("#pageTitle").textContent = title;
    $("#pageSubtitle").textContent = subtitle;
    $("#sidebar").classList.remove("open");
    window.location.hash = pageName;
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      state.charts.forEach((chart) => chart.resize());
    }, 80);
  }

  function resetStudentFilters() {
    $("#studentQuery").value = "";
    $("#studentSearchField").value = "all";
    $("#studentStatusFilter").value = "";
    $("#studentGradeFilter").value = "";
    $("#studentTypeFilter").value = "";
    $("#studentMinMarks").value = "";
    $("#studentMaxMarks").value = "";
    $("#studentSchoolFilter").value = "";
    $("#studentPageSize").value = "50";
    runStudentSearch(1);
  }

  function resetSchoolFilters() {
    $("#schoolQuery").value = "";
    $("#schoolMinCandidates").value = "20";
    $("#schoolSort").value = "candidates";
    applySchoolFilters();
  }

  function resetSubjectFilters() {
    $("#subjectQuery").value = "";
    $("#subjectSort").value = "unique";
    applySubjectFilters();
  }

  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("resultDashboardTheme", theme);
    if (state.ready) {
      window.setTimeout(() => {
        renderOverviewCharts();
        renderSchoolCharts(Math.max(0, Number($("#schoolMinCandidates").value) || 0));
        renderSubjectCharts();
        renderInsights();
      }, 30);
    }
  }

  function bindEvents() {
    $$("[data-page-target]").forEach((element) => {
      element.addEventListener("click", () => switchPage(element.dataset.pageTarget));
    });

    $("#mobileMenuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#themeToggle").addEventListener("click", () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      applyTheme(isDark ? "light" : "dark");
    });
    $("#refreshChartsButton").addEventListener("click", () => {
      if (state.ready) renderOverviewCharts();
    });

    const fileInput = $("#excelFileInput");
    fileInput.addEventListener("change", () => loadWorkbookFile(fileInput.files[0]));
    $("#changeFileButton").addEventListener("click", () => {
      $("#uploadOverlay").classList.remove("hidden");
      $("#uploadProgress").classList.add("hidden");
      fileInput.value = "";
    });

    const dropZone = $("#dropZone");
    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("dragging");
      });
    });
    dropZone.addEventListener("drop", (event) => loadWorkbookFile(event.dataTransfer.files[0]));

    $("#studentSearchButton").addEventListener("click", () => runStudentSearch(1));
    $("#studentResetButton").addEventListener("click", resetStudentFilters);
    $("#studentPageSize").addEventListener("change", () => runStudentSearch(1));
    $("#studentQuery").addEventListener("keydown", (event) => {
      if (event.key === "Enter") runStudentSearch(1);
    });
    $("#studentsTable").addEventListener("click", (event) => {
      const button = event.target.closest("[data-student-roll]");
      if (button) requestStudentDetail(button.dataset.studentRoll);
    });
    $("#studentPagination").addEventListener("click", (event) => {
      const button = event.target.closest("[data-page-number]");
      if (!button || button.disabled) return;
      runStudentSearch(Number(button.dataset.pageNumber));
    });
    $("#exportStudentResultsButton").addEventListener("click", exportStudents);

    $("#schoolApplyButton").addEventListener("click", applySchoolFilters);
    $("#schoolResetButton").addEventListener("click", resetSchoolFilters);
    $("#schoolQuery").addEventListener("keydown", (event) => {
      if (event.key === "Enter") applySchoolFilters();
    });

    $("#subjectApplyButton").addEventListener("click", applySubjectFilters);
    $("#subjectResetButton").addEventListener("click", resetSubjectFilters);
    $("#subjectQuery").addEventListener("keydown", (event) => {
      if (event.key === "Enter") applySubjectFilters();
    });

    $("#closeStudentModal").addEventListener("click", () => $("#studentModal").classList.add("hidden"));
    $("#studentModal").addEventListener("click", (event) => {
      if (event.target.id === "studentModal") $("#studentModal").classList.add("hidden");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        $("#studentModal").classList.add("hidden");
        $("#sidebar").classList.remove("open");
      }
    });
  }

  function initialize() {
    bindEvents();
    const savedTheme = localStorage.getItem("resultDashboardTheme");
    applyTheme(savedTheme === "dark" ? "dark" : "light");
    const initialPage = window.location.hash.replace("#", "");
    if (pageMeta[initialPage]) switchPage(initialPage);
    createWorker();
    loadBundledWorkbook();
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
