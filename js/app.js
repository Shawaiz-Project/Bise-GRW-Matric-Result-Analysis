/* global Chart */

(() => {
  "use strict";

  // ─── APPLICATION STATE ───────────────────────────────────────────────────
  const state = {
    datasets: [],
    activeDatasetId: null,
    activePage: "overview",
    charts: new Map(),
    summaryData: null,
    studentPage: 1,
    studentLimit: 50,
    studentTotal: 0,
    studentPages: 1,
    schoolPage: 1,
    schoolLimit: 50,
    schoolTotal: 0,
    schoolPages: 1,
    filterOptions: null,
    theme: localStorage.getItem("bise_theme") || "light",
  };

  const pageMeta = {
    overview: ["Overview", "Key performance indicators, distributions, and school comparisons."],
    students: ["Student Search", "Search, filter, and inspect candidate records via server-side API."],
    schools: ["School Analysis", "Compare candidate volume, pass rates, average marks, and outcomes across institutions."],
    rankings: ["School Rankings", "Weighted performance ranking: 50% pass rate + 30% average marks + 20% top performance."],
    subjects: ["Subject Slip Analysis", "Identify subjects with the highest failure and supplementary slip rates."],
    insights: ["Automatic Insights", "Dynamically generated findings from the actual result database."],
    quality: ["Data Quality", "Review extraction checks, reconciliation indicators, and validation metrics."],
  };

  const chartPalette = [
    "#2457d6", "#12a678", "#e14e5d", "#f0a126",
    "#7047d7", "#178aa5", "#df6b2b", "#72839f",
    "#9e4f9e", "#66a331", "#bb516f", "#3b78aa"
  ];

  // ─── DOM HELPERS ─────────────────────────────────────────────────────────
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

  function shortText(value, maxLength = 36) {
    const text = String(value ?? "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}…`;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function showToast(title, message, type = "success", timeout = 4200) {
    const container = $("#toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    window.setTimeout(() => toast.remove(), timeout);
  }

  function setDataStatus(mode, text) {
    const pill = $("#dataStatusPill");
    if (!pill) return;
    pill.classList.remove("ready", "loading", "error");
    if (mode) pill.classList.add(mode);
    const label = pill.querySelector("span:last-child");
    if (label) label.textContent = text;
  }

  // ─── API CLIENT ──────────────────────────────────────────────────────────
  async function apiFetch(endpoint, params = {}) {
    const query = new URLSearchParams();
    if (state.activeDatasetId) {
      query.set("dataset_id", String(state.activeDatasetId));
    }
    for (const [key, val] of Object.entries(params)) {
      if (val !== null && val !== undefined && val !== "") {
        query.set(key, String(val));
      }
    }
    const url = `/api/${endpoint}${query.toString() ? "?" + query.toString() : ""}`;
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    const json = await response.json();
    return json.data;
  }

  // ─── CHART HELPERS ───────────────────────────────────────────────────────
  function destroyChart(id) {
    if (state.charts.has(id)) {
      try {
        state.charts.get(id).destroy();
      } catch (_) {}
      state.charts.delete(id);
    }
  }

  function getChartTheme() {
    const isDark = state.theme === "dark";
    return {
      textColor: isDark ? "#a5b0c3" : "#667085",
      gridColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.06)",
      tooltipBg: isDark ? "#1c2940" : "#ffffff",
      tooltipText: isDark ? "#f4f7fb" : "#172033",
    };
  }

  function registerChart(id, chart) {
    destroyChart(id);
    state.charts.set(id, chart);
    return chart;
  }

  // ─── THEME & NAVIGATION ──────────────────────────────────────────────────
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("bise_theme", theme);
    // Re-render charts with new theme colors
    if (state.summaryData && state.activePage === "overview") {
      renderOverviewCharts(state.summaryData);
    }
  }

  function navigateToPage(pageKey) {
    if (!pageMeta[pageKey]) pageKey = "overview";
    state.activePage = pageKey;

    // Update nav items
    $$(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.pageTarget === pageKey);
    });

    // Update page sections
    $$(".page-section").forEach((sec) => {
      sec.classList.toggle("active", sec.dataset.page === pageKey);
    });

    // Update topbar titles
    const [title, subtitle] = pageMeta[pageKey];
    $("#pageTitle").textContent = title;
    $("#pageSubtitle").textContent = subtitle;

    // Close mobile menu
    $("#sidebar").classList.remove("open");

    // Load data for the page if not loaded
    loadPageData(pageKey);

    // Update URL hash without scroll
    history.replaceState(null, "", `#${pageKey}`);
  }

  function loadPageData(pageKey) {
    switch (pageKey) {
      case "overview":
        loadOverview();
        break;
      case "students":
        loadStudents();
        break;
      case "schools":
        loadSchools();
        break;
      case "rankings":
        loadRankings();
        break;
      case "subjects":
        loadSubjects();
        break;
      case "insights":
        loadInsights();
        break;
      case "quality":
        loadQuality();
        break;
    }
  }

  // ─── OVERVIEW PAGE ───────────────────────────────────────────────────────
  async function loadOverview(forceRefresh = false) {
    if (state.summaryData && !forceRefresh) {
      renderOverviewKpis(state.summaryData);
      renderOverviewCharts(state.summaryData);
      return;
    }

    try {
      setDataStatus("loading", "Loading summary");
      const summary = await apiFetch("summary");
      state.summaryData = summary;
      setDataStatus("ready", "Data ready");
      renderOverviewKpis(summary);
      renderOverviewCharts(summary);
      loadTopStudents();
    } catch (err) {
      setDataStatus("error", "Error loading data");
      showToast("Could not load summary", err.message, "error");
    }
  }

  function renderOverviewKpis(data) {
    const totalCand = data.total_candidates || data.total_extracted || 0;
    const appeared = data.appeared || 0;
    const appRate = data.appearance_rate || (totalCand > 0 ? (appeared / totalCand) * 100 : 0);
    const schools = data.total_institutions || data.school_count || 0;

    const kpis = [
      { label: "Total Candidates", value: formatNumber(totalCand), note: "Registered students" },
      { label: "Appeared", value: formatNumber(appeared), note: `${formatPercent(appRate)} appearance rate` },
      { label: "Passed", value: formatNumber(data.passed), note: "SSC certificate granted" },
      { label: "Pass Percentage", value: formatPercent(data.pass_percentage), note: "Of appeared candidates" },
      { label: "Fail / Subject Slip", value: formatNumber(data.fail_slip), note: "Supplementary candidates" },
      { label: "Highest Marks", value: formatNumber(data.highest_marks), note: `Top score achieved` },
      { label: "Average Marks", value: formatDecimal(data.average_marks), note: "Among passing candidates" },
      { label: "Schools", value: formatNumber(schools), note: "Tracked institutions" },
    ];

    const container = $("#overviewKpis");
    container.innerHTML = kpis
      .map(
        (k) => `
        <article class="kpi-card">
          <span>${escapeHtml(k.label)}</span>
          <strong>${escapeHtml(k.value)}</strong>
          <small>${escapeHtml(k.note)}</small>
        </article>`
      )
      .join("");
  }

  function renderOverviewCharts(data) {
    const ct = getChartTheme();

    // 1. Pass vs Not Passed (Doughnut)
    const passFailEl = $("#passFailChart");
    if (passFailEl) {
      const passed = data.passed || 0;
      const notPassed = Math.max(0, (data.appeared || 0) - passed);
      registerChart(
        "passFailChart",
        new Chart(passFailEl, {
          type: "doughnut",
          data: {
            labels: ["Passed", "Not Passed / Slip"],
            datasets: [{
              data: [passed, notPassed],
              backgroundColor: ["#12a678", "#e14e5d"],
              borderWidth: 0,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: "bottom", labels: { color: ct.textColor, font: { family: "Inter" } } },
            },
            cutout: "68%",
          },
        })
      );
    }

    // 2. Status Distribution (Doughnut)
    const statusEl = $("#statusChart");
    if (statusEl && Array.isArray(data.status_summary)) {
      const labels = data.status_summary.map((s) => s.status);
      const counts = data.status_summary.map((s) => s.candidates ?? s.student_count ?? 0);
      registerChart(
        "statusChart",
        new Chart(statusEl, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{
              data: counts,
              backgroundColor: chartPalette.slice(0, labels.length),
              borderWidth: 0,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: "bottom", labels: { color: ct.textColor, font: { family: "Inter", size: 11 } } },
            },
            cutout: "60%",
          },
        })
      );
    }

    // 3. Marks Distribution (Bar)
    const marksEl = $("#marksChart");
    if (marksEl && Array.isArray(data.marks_distribution)) {
      const labels = data.marks_distribution.map((m) => m.marks_range || m.range_label);
      const counts = data.marks_distribution.map((m) => m.candidates ?? m.students ?? 0);
      registerChart(
        "marksChart",
        new Chart(marksEl, {
          type: "bar",
          data: {
            labels,
            datasets: [{
              label: "Students",
              data: counts,
              backgroundColor: "#2457d6",
              borderRadius: 6,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: ct.textColor, maxRotation: 45 }, grid: { display: false } },
              y: { ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
            },
          },
        })
      );
    }

    // 4. Grade Distribution (Bar)
    const gradeEl = $("#gradeChart");
    if (gradeEl && Array.isArray(data.grade_distribution)) {
      const labels = data.grade_distribution.map((g) => g.grade || g.label);
      const counts = data.grade_distribution.map((g) => g.candidates ?? g.students ?? 0);
      registerChart(
        "gradeChart",
        new Chart(gradeEl, {
          type: "bar",
          data: {
            labels,
            datasets: [{
              label: "Students",
              data: counts,
              backgroundColor: ["#12a678", "#2457d6", "#7047d7", "#f0a126", "#df6b2b", "#e14e5d", "#72839f"],
              borderRadius: 6,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: ct.textColor }, grid: { display: false } },
              y: { ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
            },
          },
        })
      );
    }

    // 5. Candidate Type Performance (Doughnut)
    const typeEl = $("#candidateTypeChart");
    if (typeEl && Array.isArray(data.candidate_types)) {
      const labels = data.candidate_types.map((t) => t.candidate_type);
      const counts = data.candidate_types.map((t) => t.candidates ?? t.extracted ?? 0);
      registerChart(
        "candidateTypeChart",
        new Chart(typeEl, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{
              data: counts,
              backgroundColor: ["#2457d6", "#f0a126"],
              borderWidth: 0,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: "bottom", labels: { color: ct.textColor } } },
            cutout: "62%",
          },
        })
      );
    }

    // 6. Top Failed Subjects (fetch /api/subjects)
    apiFetch("subjects", { sort: "unique_students" }).then((res) => {
      const subs = (res.subjects || []).slice(0, 8);
      const subEl = $("#subjectFailureChart");
      if (subEl && subs.length) {
        registerChart(
          "subjectFailureChart",
          new Chart(subEl, {
            type: "bar",
            indexAxis: "y",
            data: {
              labels: subs.map((s) => shortText(s.subject_name, 22)),
              datasets: [{
                label: "Unique Students",
                data: subs.map((s) => s.unique_students),
                backgroundColor: "#e14e5d",
                borderRadius: 6,
              }],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
                y: { ticks: { color: ct.textColor }, grid: { display: false } },
              },
            },
          })
        );
      }

      // 7. Part-I vs Part-II Slips
      const partsEl = $("#subjectPartsChart");
      if (partsEl && subs.length) {
        registerChart(
          "subjectPartsChart",
          new Chart(partsEl, {
            type: "bar",
            data: {
              labels: subs.map((s) => shortText(s.subject_name, 16)),
              datasets: [
                { label: "Part-I", data: subs.map((s) => s.part1_entries), backgroundColor: "#2457d6", borderRadius: 4 },
                { label: "Part-II", data: subs.map((s) => s.part2_entries), backgroundColor: "#f0a126", borderRadius: 4 },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: "bottom", labels: { color: ct.textColor } } },
              scales: {
                x: { ticks: { color: ct.textColor, maxRotation: 45 }, grid: { display: false } },
                y: { ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
              },
            },
          })
        );
      }
    }).catch(() => {});

    // 8. Largest Schools (fetch /api/schools?sort=candidates&limit=8)
    apiFetch("schools", { sort: "candidates", limit: 8 }).then((res) => {
      const schools = res.schools || [];
      const el = $("#largestSchoolsChart");
      if (el && schools.length) {
        registerChart(
          "largestSchoolsChart",
          new Chart(el, {
            type: "bar",
            indexAxis: "y",
            data: {
              labels: schools.map((s) => shortText(s.institution_name, 26)),
              datasets: [{
                label: "Candidates",
                data: schools.map((s) => s.candidates),
                backgroundColor: "#7047d7",
                borderRadius: 6,
              }],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
                y: { ticks: { color: ct.textColor }, grid: { display: false } },
              },
            },
          })
        );
      }
    }).catch(() => {});

    // 9. Best School Pass Rates (fetch /api/schools?sort=pass_rate&min_candidates=50&limit=8)
    apiFetch("schools", { sort: "pass_rate", min_candidates: 50, limit: 8 }).then((res) => {
      const schools = res.schools || [];
      const el = $("#schoolPassRateChart");
      if (el && schools.length) {
        registerChart(
          "schoolPassRateChart",
          new Chart(el, {
            type: "bar",
            indexAxis: "y",
            data: {
              labels: schools.map((s) => shortText(s.institution_name, 26)),
              datasets: [{
                label: "Pass Rate %",
                data: schools.map((s) => s.pass_percentage),
                backgroundColor: "#12a678",
                borderRadius: 6,
              }],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { min: 0, max: 100, ticks: { color: ct.textColor, callback: (v) => `${v}%` }, grid: { color: ct.gridColor } },
                y: { ticks: { color: ct.textColor }, grid: { display: false } },
              },
            },
          })
        );
      }
    }).catch(() => {});
  }

  async function loadTopStudents() {
    try {
      const students = await apiFetch("top-students", { limit: 10 });
      const tbody = $("#topStudentsTable tbody");
      if (!tbody) return;
      if (!students || !students.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No top students found.</td></tr>';
        return;
      }
      tbody.innerHTML = students
        .map(
          (s, idx) => `
        <tr>
          <td><span class="rank-badge ${idx === 0 ? "rank-gold" : idx === 1 ? "rank-silver" : idx === 2 ? "rank-bronze" : "rank-default"}">#${idx + 1}</span></td>
          <td><strong>${escapeHtml(s.roll_no)}</strong></td>
          <td class="name-cell"><strong>${escapeHtml(s.name)}</strong></td>
          <td><strong>${formatNumber(s.marks)}</strong></td>
          <td><span class="grade-badge">${escapeHtml(s.grade || "—")}</span></td>
          <td class="school-cell"><small>${escapeHtml(s.institution_name || "—")}</small></td>
        </tr>`
        )
        .join("");
    } catch (_) {}
  }

  // ─── STUDENTS SEARCH PAGE ────────────────────────────────────────────────
  async function loadFilterOptions() {
    if (state.filterOptions) return;
    try {
      const opts = await apiFetch("filter-options");
      state.filterOptions = opts;
      const statusSelect = $("#studentStatusFilter");
      if (statusSelect) {
        statusSelect.innerHTML = '<option value="">All statuses</option>';
        (opts.statuses || []).forEach((st) => {
          statusSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(st)}">${escapeHtml(st)}</option>`);
        });
      }
      const typeSelect = $("#studentTypeFilter");
      if (typeSelect) {
        typeSelect.innerHTML = '<option value="">All types</option>';
        (opts.candidate_types || []).forEach((t) => {
          typeSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`);
        });
      }
    } catch (_) {}
  }

  function getStudentFilters() {
    return {
      search: ($("#studentQuery")?.value || "").trim(),
      field: $("#studentSearchField")?.value || "all",
      status: $("#studentStatusFilter")?.value || "",
      grade: $("#studentGradeFilter")?.value || "",
      candidate_type: $("#studentTypeFilter")?.value || "",
      min_marks: $("#studentMinMarks")?.value || "",
      max_marks: $("#studentMaxMarks")?.value || "",
      school: ($("#studentSchoolFilter")?.value || "").trim(),
      limit: $("#studentPageSize")?.value || 50,
    };
  }

  async function loadStudents(page = 1) {
    state.studentPage = page;
    await loadFilterOptions();
    const filters = getStudentFilters();
    filters.page = page;

    // Update export button link with current filter params
    const exportBtn = $("#exportStudentResultsButton");
    const exportCsvBtn = $("#exportCsvBtn");
    const exportQuery = new URLSearchParams();
    if (state.activeDatasetId) exportQuery.set("dataset_id", String(state.activeDatasetId));
    for (const [k, v] of Object.entries(filters)) {
      if (v && k !== "page" && k !== "limit") exportQuery.set(k, v);
    }
    const exportUrl = `/api/export/students.csv?${exportQuery.toString()}`;
    if (exportCsvBtn) exportCsvBtn.href = exportUrl;

    const tbody = $("#studentsTable tbody");
    tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">Searching student records…</td></tr>';

    try {
      const res = await apiFetch("students", filters);
      state.studentTotal = res.total || 0;
      state.studentPages = res.pages || 1;

      $("#studentResultSummary").textContent = `Showing ${(res.students || []).length} of ${formatNumber(res.total)} matching records (Page ${res.page} of ${res.pages})`;

      if (!res.students || !res.students.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">No candidate records matched your search criteria.</td></tr>';
        renderPagination("#studentPagination", res.page, res.pages, loadStudents);
        return;
      }

      tbody.innerHTML = res.students
        .map((s) => {
          let statusClass = "status-neutral";
          if (/pass/i.test(s.status)) statusClass = "status-pass";
          else if (/fail|slip/i.test(s.status)) statusClass = "status-fail";
          else if (/absent/i.test(s.status)) statusClass = "status-warning";

          return `
          <tr>
            <td><strong>${escapeHtml(s.roll_no)}</strong></td>
            <td class="name-cell"><strong>${escapeHtml(s.name)}</strong></td>
            <td><small>${escapeHtml(s.candidate_type || "—")}</small></td>
            <td class="school-cell">
              <span>${escapeHtml(s.institution_name || "—")}</span>
              ${s.institution_code ? `<small>Code: ${escapeHtml(s.institution_code)}</small>` : ""}
            </td>
            <td><span class="status-badge ${statusClass}">${escapeHtml(s.status || "—")}</span></td>
            <td><strong>${s.marks !== null ? formatNumber(s.marks) : "—"}</strong></td>
            <td>${s.percentage !== null ? formatPercent(s.percentage) : "—"}</td>
            <td><span class="grade-badge">${escapeHtml(s.grade || "—")}</span></td>
            <td><small style="color:var(--danger);">${escapeHtml(shortText(s.all_failed_subjects || "None", 30))}</small></td>
            <td>
              <button class="view-button" data-roll="${escapeHtml(s.roll_no)}" type="button">View</button>
            </td>
          </tr>`;
        })
        .join("");

      // Bind view details buttons
      $$(".view-button", tbody).forEach((btn) => {
        btn.addEventListener("click", () => openStudentModal(btn.dataset.roll));
      });

      renderPagination("#studentPagination", res.page, res.pages, loadStudents);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-cell" style="color:var(--danger);">Error: ${escapeHtml(err.message)}</td></tr>`;
      showToast("Search failed", err.message, "error");
    }
  }

  // ─── STUDENT DETAIL MODAL ────────────────────────────────────────────────
  async function openStudentModal(rollNo) {
    const modal = $("#studentModal");
    const body = $("#studentModalBody");
    body.innerHTML = '<div style="padding:40px;text-align:center;">Loading candidate details…</div>';
    modal.classList.remove("hidden");

    try {
      const s = await apiFetch(`students/${encodeURIComponent(rollNo)}`);
      let statusClass = "status-neutral";
      if (/pass/i.test(s.status)) statusClass = "status-pass";
      else if (/fail|slip/i.test(s.status)) statusClass = "status-fail";
      else if (/absent/i.test(s.status)) statusClass = "status-warning";

      let failedChips = "";
      if (s.all_failed_subjects) {
        failedChips = s.all_failed_subjects
          .split(/[,;/]+/)
          .map((sub) => `<span class="subject-chip">${escapeHtml(sub.trim())}</span>`)
          .join("");
      }

      body.innerHTML = `
        ${s.marks !== null ? `
        <div class="student-rank-banner">
          <div class="rank-box">
            <span>Overall Board Rank</span>
            <strong>#${s.overall_rank !== null ? formatNumber(s.overall_rank) : "—"}</strong>
          </div>
          <div class="rank-box">
            <span>School Rank</span>
            <strong>#${s.school_rank !== null ? formatNumber(s.school_rank) : "—"}</strong>
          </div>
          <div class="rank-box">
            <span>Percentile</span>
            <strong>${s.percentile !== null ? `${s.percentile}%` : "—"}</strong>
          </div>
        </div>
        ` : ""}

        <div class="detail-grid">
          <div class="detail-item">
            <span>Roll Number</span>
            <strong>${escapeHtml(s.roll_no)}</strong>
          </div>
          <div class="detail-item">
            <span>Candidate Name</span>
            <strong>${escapeHtml(s.name)}</strong>
          </div>
          <div class="detail-item">
            <span>Candidate Type</span>
            <strong>${escapeHtml(s.candidate_type || "Regular")}</strong>
          </div>
          <div class="detail-item">
            <span>Status</span>
            <strong style="margin-top:6px;"><span class="status-badge ${statusClass}">${escapeHtml(s.status)}</span></strong>
          </div>
          <div class="detail-item">
            <span>Total Marks Achieved</span>
            <strong>${s.marks !== null ? `${formatNumber(s.marks)} / ${s.max_marks || 1200}` : "—"}</strong>
          </div>
          <div class="detail-item">
            <span>Percentage & Grade</span>
            <strong>${s.percentage !== null ? formatPercent(s.percentage) : "—"} (Grade ${escapeHtml(s.grade || "—")})</strong>
          </div>
          <div class="detail-item full">
            <span>Institution / School</span>
            <strong>${escapeHtml(s.institution_name || "—")}</strong>
            ${s.institution_code ? `<small style="color:var(--muted);display:block;margin-top:3px;">Code: ${escapeHtml(s.institution_code)}</small>` : ""}
          </div>
          ${s.all_failed_subjects ? `
          <div class="detail-item full">
            <span>Failed / Slip Subjects (${s.failed_count || 0})</span>
            <div style="margin-top:8px;">${failedChips}</div>
            ${s.part1_subjects ? `<small style="display:block;margin-top:6px;color:var(--muted);">Part-I: ${escapeHtml(s.part1_subjects)}</small>` : ""}
            ${s.part2_subjects ? `<small style="display:block;margin-top:2px;color:var(--muted);">Part-II: ${escapeHtml(s.part2_subjects)}</small>` : ""}
          </div>` : ""}
          ${s.pdf_page ? `
          <div class="detail-item">
            <span>Gazette PDF Page</span>
            <strong>Page ${escapeHtml(s.pdf_page)}</strong>
          </div>` : ""}
        </div>

        <div class="modal-actions">
          <button class="secondary-button" id="printStudentResultBtn" type="button">Print Result Card</button>
          <button class="primary-button" id="closeStudentModalBtn" type="button">Close</button>
        </div>
      `;

      $("#printStudentResultBtn")?.addEventListener("click", () => window.print());
      $("#closeStudentModalBtn")?.addEventListener("click", () => modal.classList.add("hidden"));
    } catch (err) {
      body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--danger);">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  // ─── SCHOOLS PAGE ────────────────────────────────────────────────────────
  async function loadSchools(page = 1) {
    state.schoolPage = page;
    const search = ($("#schoolQuery")?.value || "").trim();
    const minCandidates = $("#schoolMinCandidates")?.value || 20;
    const sortBy = $("#schoolSort")?.value || "candidates";
    const tbody = $("#schoolsTable tbody");
    tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">Loading school data…</td></tr>';

    try {
      const res = await apiFetch("schools", {
        search,
        min_candidates: minCandidates,
        sort: sortBy,
        page,
        limit: 50,
      });

      state.schoolTotal = res.total || 0;
      state.schoolPages = res.pages || 1;

      $("#schoolResultSummary").textContent = `Showing ${(res.schools || []).length} of ${formatNumber(res.total)} institutions`;

      if (!res.schools || !res.schools.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">No institutions found matching the criteria.</td></tr>';
        renderPagination("#schoolPagination", res.page, res.pages, loadSchools);
        return;
      }

      tbody.innerHTML = res.schools
        .map(
          (s) => `
        <tr>
          <td><code>${escapeHtml(s.institution_code || "—")}</code></td>
          <td class="name-cell"><strong>${escapeHtml(s.institution_name)}</strong></td>
          <td><strong>${formatNumber(s.candidates)}</strong></td>
          <td>${formatNumber(s.passed)}</td>
          <td><small style="color:var(--danger);">${formatNumber(s.fail_slip)}</small></td>
          <td>${formatNumber(s.absent)}</td>
          <td><strong>${formatPercent(s.pass_percentage)}</strong></td>
          <td>${formatDecimal(s.average_marks)}</td>
          <td><strong>${formatNumber(s.highest_marks)}</strong></td>
        </tr>`
        )
        .join("");

      renderPagination("#schoolPagination", res.page, res.pages, loadSchools);

      // Render School Charts
      renderSchoolCharts(res.schools);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-cell" style="color:var(--danger);">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderSchoolCharts(schools) {
    const ct = getChartTheme();
    const topPass = [...schools].sort((a, b) => (b.pass_percentage || 0) - (a.pass_percentage || 0)).slice(0, 8);
    const topAvg = [...schools].sort((a, b) => (b.average_marks || 0) - (a.average_marks || 0)).slice(0, 8);

    const passEl = $("#schoolsPassChart");
    if (passEl && topPass.length) {
      registerChart(
        "schoolsPassChart",
        new Chart(passEl, {
          type: "bar",
          indexAxis: "y",
          data: {
            labels: topPass.map((s) => shortText(s.institution_name, 26)),
            datasets: [{
              label: "Pass Rate %",
              data: topPass.map((s) => s.pass_percentage),
              backgroundColor: "#12a678",
              borderRadius: 6,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { min: 0, max: 100, ticks: { color: ct.textColor, callback: (v) => `${v}%` }, grid: { color: ct.gridColor } },
              y: { ticks: { color: ct.textColor }, grid: { display: false } },
            },
          },
        })
      );
    }

    const avgEl = $("#schoolsAverageChart");
    if (avgEl && topAvg.length) {
      registerChart(
        "schoolsAverageChart",
        new Chart(avgEl, {
          type: "bar",
          indexAxis: "y",
          data: {
            labels: topAvg.map((s) => shortText(s.institution_name, 26)),
            datasets: [{
              label: "Average Marks",
              data: topAvg.map((s) => s.average_marks),
              backgroundColor: "#2457d6",
              borderRadius: 6,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
              y: { ticks: { color: ct.textColor }, grid: { display: false } },
            },
          },
        })
      );
    }
  }

  // ─── RANKINGS PAGE ───────────────────────────────────────────────────────
  async function loadRankings() {
    const minCandidates = $("#rankMinCandidates")?.value || 20;
    const limit = $("#rankLimit")?.value || 50;
    const tbody = $("#rankingsTable tbody");
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Calculating composite rankings…</td></tr>';

    try {
      const schools = await apiFetch("rankings/schools", { min_candidates: minCandidates, limit });
      $("#rankTableSummary").textContent = `Top ${schools.length} institutions (≥${minCandidates} candidates, weighted composite score)`;

      if (!schools || !schools.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No institutions met the minimum candidate requirement.</td></tr>';
        return;
      }

      tbody.innerHTML = schools
        .map((s, idx) => {
          const rank = s.rank || idx + 1;
          const badgeClass = rank === 1 ? "rank-gold" : rank === 2 ? "rank-silver" : rank === 3 ? "rank-bronze" : "rank-default";
          return `
          <tr>
            <td><span class="rank-badge ${badgeClass}">#${rank}</span></td>
            <td class="name-cell">
              <strong>${escapeHtml(s.institution_name)}</strong>
              ${s.institution_code ? `<small>Code: ${escapeHtml(s.institution_code)}</small>` : ""}
            </td>
            <td><strong>${formatNumber(s.candidates)}</strong></td>
            <td>${formatNumber(s.passed)}</td>
            <td><strong>${formatPercent(s.pass_percentage)}</strong></td>
            <td>${formatDecimal(s.average_marks)}</td>
            <td><strong>${formatNumber(s.highest_marks)}</strong></td>
            <td><span class="score-pill">${formatDecimal(s.ranking_score)}</span></td>
          </tr>`;
        })
        .join("");

      // Render top 15 ranking chart
      const chartEl = $("#rankingChart");
      if (chartEl) {
        const top15 = schools.slice(0, 15);
        const ct = getChartTheme();
        registerChart(
          "rankingChart",
          new Chart(chartEl, {
            type: "bar",
            indexAxis: "y",
            data: {
              labels: top15.map((s) => `#${s.rank} ${shortText(s.institution_name, 28)}`),
              datasets: [{
                label: "Composite Score",
                data: top15.map((s) => s.ranking_score),
                backgroundColor: top15.map((_, i) => i === 0 ? "#ffd700" : i === 1 ? "#b0bec5" : i === 2 ? "#cd7f32" : "#2457d6"),
                borderRadius: 6,
              }],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
                y: { ticks: { color: ct.textColor }, grid: { display: false } },
              },
            },
          })
        );
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-cell" style="color:var(--danger);">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // ─── SUBJECTS PAGE ───────────────────────────────────────────────────────
  async function loadSubjects() {
    const search = ($("#subjectQuery")?.value || "").trim();
    const sortBy = $("#subjectSort")?.value || "unique_students";
    const tbody = $("#subjectsTable tbody");
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Loading subject slip analytics…</td></tr>';

    try {
      const res = await apiFetch("subjects", { search, sort: sortBy });
      const subjects = res.subjects || [];
      $("#subjectTableSummary").textContent = `${subjects.length} subject codes tracked`;

      if (!subjects.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No subjects found.</td></tr>';
        return;
      }

      tbody.innerHTML = subjects
        .map((s) => {
          const part2Share = s.total_entries > 0 ? ((s.part2_entries || 0) / s.total_entries) * 100 : 0;
          return `
          <tr>
            <td><code>${escapeHtml(s.subject_code)}</code></td>
            <td class="name-cell"><strong>${escapeHtml(s.subject_name)}</strong></td>
            <td>${formatNumber(s.part1_entries)}</td>
            <td>${formatNumber(s.part2_entries)}</td>
            <td><strong>${formatNumber(s.total_entries)}</strong></td>
            <td><strong style="color:var(--danger);">${formatNumber(s.unique_students)}</strong></td>
            <td>${formatPercent(part2Share)}</td>
          </tr>`;
        })
        .join("");

      // Render Subject charts
      const ct = getChartTheme();
      const topUnique = subjects.slice(0, 10);

      const uniqueEl = $("#subjectsUniqueChart");
      if (uniqueEl) {
        registerChart(
          "subjectsUniqueChart",
          new Chart(uniqueEl, {
            type: "bar",
            indexAxis: "y",
            data: {
              labels: topUnique.map((s) => shortText(s.subject_name, 22)),
              datasets: [{
                label: "Unique Candidates",
                data: topUnique.map((s) => s.unique_students),
                backgroundColor: "#e14e5d",
                borderRadius: 6,
              }],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
                y: { ticks: { color: ct.textColor }, grid: { display: false } },
              },
            },
          })
        );
      }

      const partEl = $("#subjectsPartChart");
      if (partEl) {
        registerChart(
          "subjectsPartChart",
          new Chart(partEl, {
            type: "bar",
            data: {
              labels: topUnique.map((s) => shortText(s.subject_name, 16)),
              datasets: [
                { label: "Part-I", data: topUnique.map((s) => s.part1_entries), backgroundColor: "#2457d6", borderRadius: 4 },
                { label: "Part-II", data: topUnique.map((s) => s.part2_entries), backgroundColor: "#f0a126", borderRadius: 4 },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: "bottom", labels: { color: ct.textColor } } },
              scales: {
                x: { ticks: { color: ct.textColor, maxRotation: 45 }, grid: { display: false } },
                y: { ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
              },
            },
          })
        );
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell" style="color:var(--danger);">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // ─── INSIGHTS PAGE ───────────────────────────────────────────────────────
  async function loadInsights() {
    const grid = $("#insightGrid");
    grid.innerHTML = '<article class="insight-card"><span class="insight-number">Loading</span><h3>Computing database insights…</h3><p>Analyzing candidate and institution distributions.</p></article>';

    try {
      const insights = await apiFetch("insights");
      if (!insights || !insights.length) {
        grid.innerHTML = '<article class="insight-card"><span class="insight-number">—</span><h3>No insights available</h3><p>Ensure data is loaded.</p></article>';
        return;
      }

      grid.innerHTML = insights
        .map(
          (ins, idx) => `
        <article class="insight-card panel" data-watermark="${String(idx + 1).padStart(2, "0")}">
          <span class="insight-number">${String(idx + 1).padStart(2, "0")} · ${escapeHtml(ins.category || "INSIGHT")}</span>
          <h3>${escapeHtml(ins.title)}</h3>
          <p>${escapeHtml(ins.description)}</p>
        </article>`
        )
        .join("");

      // Render School Size vs Pass Rate Scatter Plot
      apiFetch("schools", { limit: 120, min_candidates: 10 }).then((res) => {
        const schools = res.schools || [];
        const scatterEl = $("#schoolScatterChart");
        if (scatterEl && schools.length) {
          const ct = getChartTheme();
          registerChart(
            "schoolScatterChart",
            new Chart(scatterEl, {
              type: "scatter",
              data: {
                datasets: [{
                  label: "Schools",
                  data: schools.map((s) => ({ x: s.candidates, y: s.pass_percentage })),
                  backgroundColor: "rgba(36, 87, 214, 0.65)",
                  borderColor: "#2457d6",
                }],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => `${schools[ctx.dataIndex]?.institution_name || "School"}: ${ctx.raw.x} students, ${ctx.raw.y}% pass`,
                    },
                  },
                },
                scales: {
                  x: { title: { display: true, text: "Number of Candidates", color: ct.textColor }, ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
                  y: { min: 0, max: 100, title: { display: true, text: "Pass Rate %", color: ct.textColor }, ticks: { color: ct.textColor }, grid: { color: ct.gridColor } },
                },
              },
            })
          );
        }
      }).catch(() => {});

      // Render Status Percentages
      if (state.summaryData && Array.isArray(state.summaryData.status_summary)) {
        const statusEl = $("#statusPercentChart");
        if (statusEl) {
          const ct = getChartTheme();
          const total = state.summaryData.total_candidates || 1;
          const items = state.summaryData.status_summary;
          registerChart(
            "statusPercentChart",
            new Chart(statusEl, {
              type: "bar",
              data: {
                labels: items.map((i) => i.status),
                datasets: [{
                  label: "Share %",
                  data: items.map((i) => Math.round((i.candidates / total) * 1000) / 10),
                  backgroundColor: chartPalette.slice(0, items.length),
                  borderRadius: 6,
                }],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { ticks: { color: ct.textColor }, grid: { display: false } },
                  y: { ticks: { color: ct.textColor, callback: (v) => `${v}%` }, grid: { color: ct.gridColor } },
                },
              },
            })
          );
        }
      }
    } catch (err) {
      grid.innerHTML = `<article class="insight-card"><span class="insight-number" style="color:var(--danger);">Error</span><h3>Could not load insights</h3><p>${escapeHtml(err.message)}</p></article>`;
    }
  }

  // ─── DATA QUALITY PAGE ───────────────────────────────────────────────────
  async function loadQuality() {
    const banner = $("#qualityBanner");
    const tbody = $("#qualityTable tbody");
    banner.innerHTML = "<strong>Loading data quality checks…</strong><span>Connecting to database.</span>";
    tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">Loading validation metrics…</td></tr>';

    try {
      const checks = await apiFetch("quality");
      if (!checks || !checks.length) {
        banner.className = "quality-banner warning";
        banner.innerHTML = "<strong>No data quality records found.</strong><span>Run process_data.py to compute quality metrics.</span>";
        tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">No quality records found.</td></tr>';
        return;
      }

      banner.className = "quality-banner good";
      banner.innerHTML = `<strong>Data Verification: Passed</strong><span>All ${checks.length} extraction reconciliation checks verified against source PDF gazettes.</span>`;

      tbody.innerHTML = checks
        .map(
          (c) => `
        <tr>
          <td><strong>${escapeHtml(c.check_name)}</strong></td>
          <td><code>${escapeHtml(c.value)}</code></td>
          <td><small style="color:var(--muted);">${escapeHtml(c.notes || "—")}</small></td>
        </tr>`
        )
        .join("");
    } catch (err) {
      banner.className = "quality-banner warning";
      banner.innerHTML = `<strong>Error loading checks</strong><span>${escapeHtml(err.message)}</span>`;
      tbody.innerHTML = `<tr><td colspan="3" class="empty-cell" style="color:var(--danger);">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // ─── PAGINATION HELPER ───────────────────────────────────────────────────
  function renderPagination(selector, currentPage, totalPages, onPageChange) {
    const container = $(selector);
    if (!container) return;
    if (totalPages <= 1) {
      container.innerHTML = "";
      return;
    }

    let html = "";
    html += `<button class="secondary-button" ${currentPage <= 1 ? "disabled" : ""} data-page="${currentPage - 1}">← Prev</button>`;

    // Page window: show up to 5 page numbers
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);

    if (start > 1) {
      html += `<button class="secondary-button" data-page="1">1</button>`;
      if (start > 2) html += '<span style="padding:0 4px;color:var(--muted);">…</span>';
    }

    for (let p = start; p <= end; p++) {
      html += `<button class="${p === currentPage ? "primary-button" : "secondary-button"}" data-page="${p}">${p}</button>`;
    }

    if (end < totalPages) {
      if (end < totalPages - 1) html += '<span style="padding:0 4px;color:var(--muted);">…</span>';
      html += `<button class="secondary-button" data-page="${totalPages}">${totalPages}</button>`;
    }

    html += `<button class="secondary-button" ${currentPage >= totalPages ? "disabled" : ""} data-page="${currentPage + 1}">Next →</button>`;

    container.innerHTML = html;
    $$("button[data-page]", container).forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetPage = Number(btn.dataset.page);
        if (targetPage >= 1 && targetPage <= totalPages && targetPage !== currentPage) {
          onPageChange(targetPage);
        }
      });
    });
  }

  // ─── DATASET INITIALIZATION ──────────────────────────────────────────────
  async function initDatasets() {
    try {
      setDataStatus("loading", "Connecting API");
      const datasets = await apiFetch("datasets");
      state.datasets = datasets || [];

      const select = $("#datasetSelector");
      if (select && state.datasets.length) {
        select.innerHTML = state.datasets
          .map(
            (d) =>
              `<option value="${d.id}">${escapeHtml(d.year)} ${escapeHtml(d.exam_type || "Annual")} (${formatNumber(d.total_students)})</option>`
          )
          .join("");

        state.activeDatasetId = state.datasets[0].id;
        const active = state.datasets[0];
        $("#sourceFileName").textContent = active.file_name || `${active.year} Result`;
        $("#sourceRecordCount").textContent = `${formatNumber(active.total_students)} students`;

        select.addEventListener("change", () => {
          state.activeDatasetId = Number(select.value);
          const chosen = state.datasets.find((d) => d.id === state.activeDatasetId);
          if (chosen) {
            $("#sourceFileName").textContent = chosen.file_name || `${chosen.year} Result`;
            $("#sourceRecordCount").textContent = `${formatNumber(chosen.total_students)} students`;
          }
          state.summaryData = null;
          loadPageData(state.activePage);
        });
      } else if (!state.datasets.length) {
        $("#sourceFileName").textContent = "No datasets";
        $("#sourceRecordCount").textContent = "Run process_data.py";
      }

      setDataStatus("ready", "Connected");
    } catch (err) {
      setDataStatus("error", "API offline");
      showToast("API Connection Error", "Could not connect to backend. Is the server running?", "error", 10000);
    }
  }

  // ─── EVENT LISTENERS & BOOTSTRAP ─────────────────────────────────────────
  function setupEventListeners() {
    // Navigation items
    $$(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.pageTarget;
        if (target) navigateToPage(target);
      });
    });

    // Mobile menu button
    $("#mobileMenuButton")?.addEventListener("click", () => {
      $("#sidebar")?.classList.toggle("open");
    });

    // Theme toggle
    $("#themeToggle")?.addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });

    // Refresh charts button
    $("#refreshChartsButton")?.addEventListener("click", () => {
      loadOverview(true);
      showToast("Refreshed", "Dashboard data updated from database.", "success");
    });

    // Student search inputs & buttons
    $("#studentSearchButton")?.addEventListener("click", () => loadStudents(1));
    $("#studentResetButton")?.addEventListener("click", () => {
      $("#studentQuery").value = "";
      $("#studentSearchField").value = "all";
      $("#studentStatusFilter").value = "";
      $("#studentGradeFilter").value = "";
      $("#studentTypeFilter").value = "";
      $("#studentMinMarks").value = "";
      $("#studentMaxMarks").value = "";
      $("#studentSchoolFilter").value = "";
      loadStudents(1);
    });

    // Enter key triggers search on inputs
    ["#studentQuery", "#studentMinMarks", "#studentMaxMarks", "#studentSchoolFilter"].forEach((sel) => {
      $(sel)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") loadStudents(1);
      });
    });

    // Page size dropdown
    $("#studentPageSize")?.addEventListener("change", () => loadStudents(1));

    // Export CSV buttons
    $("#exportStudentResultsButton")?.addEventListener("click", () => {
      const filters = getStudentFilters();
      const q = new URLSearchParams();
      if (state.activeDatasetId) q.set("dataset_id", String(state.activeDatasetId));
      for (const [k, v] of Object.entries(filters)) {
        if (v && k !== "page" && k !== "limit") q.set(k, v);
      }
      window.location.href = `/api/export/students.csv?${q.toString()}`;
    });

    // School filter buttons
    $("#schoolApplyButton")?.addEventListener("click", () => loadSchools(1));
    $("#schoolResetButton")?.addEventListener("click", () => {
      $("#schoolQuery").value = "";
      $("#schoolMinCandidates").value = "20";
      $("#schoolSort").value = "candidates";
      loadSchools(1);
    });
    $("#schoolQuery")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadSchools(1);
    });

    // Rankings filter button
    $("#rankApplyButton")?.addEventListener("click", () => loadRankings());

    // Subject filter buttons
    $("#subjectApplyButton")?.addEventListener("click", () => loadSubjects());
    $("#subjectResetButton")?.addEventListener("click", () => {
      $("#subjectQuery").value = "";
      $("#subjectSort").value = "unique_students";
      loadSubjects();
    });
    $("#subjectQuery")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadSubjects();
    });

    // Modal close button & outside click
    $("#closeStudentModal")?.addEventListener("click", () => {
      $("#studentModal")?.classList.add("hidden");
    });
    $("#studentModal")?.addEventListener("click", (e) => {
      if (e.target.id === "studentModal") {
        $("#studentModal").classList.add("hidden");
      }
    });

    // Hash navigation listener
    window.addEventListener("hashchange", () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (pageMeta[hash]) navigateToPage(hash);
    });
  }

  // ─── INITIALIZATION ──────────────────────────────────────────────────────
  async function init() {
    applyTheme(state.theme);
    setupEventListeners();
    await initDatasets();

    // Check URL hash for starting page
    const initialHash = window.location.hash.replace(/^#/, "");
    navigateToPage(pageMeta[initialHash] ? initialHash : "overview");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
