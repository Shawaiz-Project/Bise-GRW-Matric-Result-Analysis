/* global XLSX */

importScripts("https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js");

let students = [];
let rollIndex = new Map();
let summaryPayload = null;
let sourceFileName = "";

const STUDENT_FIELDS = {
  roll: 0,
  name: 1,
  type: 2,
  institutionCode: 3,
  institutionName: 4,
  status: 5,
  marks: 6,
  maxMarks: 7,
  percentage: 8,
  grade: 9,
  failedCount: 10,
  partICodes: 11,
  partINames: 12,
  partIICodes: 13,
  partIINames: 14,
  allFailedCodes: 15,
  allFailedNames: 16,
  statusFlags: 17,
  resultPartIRaw: 18,
  resultPartIIRaw: 19,
  rawResult: 20,
  pdfPage: 21,
  pdfColumn: 22,
  unknownItems: 23,
};

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function lower(value) {
  return cleanText(value).toLocaleLowerCase();
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = cleanText(value).replace(/,/g, "").replace(/%$/, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
  const number = toNumber(value);
  return number === null ? null : Math.trunc(number);
}

function toPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && value.trim().endsWith("%")) {
    return toNumber(value);
  }
  const number = toNumber(value);
  if (number === null) return null;
  return Math.abs(number) <= 1.000001 ? number * 100 : number;
}

function postProgress(percent, message) {
  self.postMessage({ type: "progress", percent, message });
}

function getSheet(workbook, name) {
  return workbook.Sheets[name] || null;
}

function sheetRows(workbook, name) {
  const sheet = getSheet(workbook, name);
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
}

function createHeaderMap(headerRow) {
  const map = new Map();
  headerRow.forEach((value, index) => {
    map.set(lower(value), index);
  });
  return map;
}

function columnIndex(headerMap, possibleNames) {
  for (const name of possibleNames) {
    const index = headerMap.get(lower(name));
    if (index !== undefined) return index;
  }
  return -1;
}

function parseStudents(workbook) {
  const rows = sheetRows(workbook, "Students");
  if (!rows.length) throw new Error("The Students sheet is missing or empty.");

  const headers = createHeaderMap(rows[0]);
  const idx = {
    roll: columnIndex(headers, ["Roll No", "Roll Number", "Roll No."]),
    name: columnIndex(headers, ["Candidate Name", "Student Name", "Name"]),
    type: columnIndex(headers, ["Candidate Type", "Type"]),
    institutionCode: columnIndex(headers, ["Institution Code", "School Code"]),
    institutionName: columnIndex(headers, ["Institution Name", "School Name"]),
    status: columnIndex(headers, ["Status", "Result Status"]),
    marks: columnIndex(headers, ["Marks", "Obtained Marks"]),
    maxMarks: columnIndex(headers, ["Max Marks Assumption", "Maximum Marks"]),
    percentage: columnIndex(headers, ["Percentage", "Percent"]),
    grade: columnIndex(headers, ["Grade"]),
    failedCount: columnIndex(headers, ["Failed Subject Count", "Number of Failed Subjects"]),
    partICodes: columnIndex(headers, ["Failed Subjects - Part I Codes", "Part-I Failed Subject Codes"]),
    partINames: columnIndex(headers, ["Failed Subjects - Part I Names", "Part-I Failed Subject Names"]),
    partIICodes: columnIndex(headers, ["Failed Subjects - Part II Codes", "Part-II Failed Subject Codes"]),
    partIINames: columnIndex(headers, ["Failed Subjects - Part II Names", "Part-II Failed Subject Names"]),
    allFailedCodes: columnIndex(headers, ["All Failed Subject Codes"]),
    allFailedNames: columnIndex(headers, ["All Failed Subject Names", "All Failed Subjects"]),
    statusFlags: columnIndex(headers, ["Status Flags"]),
    resultPartIRaw: columnIndex(headers, ["Result Part I Raw"]),
    resultPartIIRaw: columnIndex(headers, ["Result Part II Raw"]),
    rawResult: columnIndex(headers, ["Raw Result", "Original Result Text"]),
    pdfPage: columnIndex(headers, ["PDF Page", "PDF Page Number"]),
    pdfColumn: columnIndex(headers, ["PDF Column"]),
    unknownItems: columnIndex(headers, ["Unknown Parsed Items", "Unknown Items"]),
  };

  if (idx.roll < 0 || idx.name < 0 || idx.status < 0) {
    throw new Error("Students sheet does not contain the expected Roll No, Candidate Name, and Status columns.");
  }

  const compact = [];
  const index = new Map();
  const statusCounts = new Map();
  const typeCounts = new Map();
  const marks = [];
  let absent = 0;
  let cancelled = 0;
  let passed = 0;
  let failSlip = 0;

  for (let rowNumber = 1; rowNumber < rows.length; rowNumber += 1) {
    const row = rows[rowNumber];
    const roll = cleanText(row[idx.roll]);
    if (!roll) continue;

    const status = cleanText(row[idx.status]) || "UNKNOWN";
    const candidateType = idx.type >= 0 ? cleanText(row[idx.type]) : "";
    const numericMarks = idx.marks >= 0 ? toInteger(row[idx.marks]) : null;
    const record = [
      roll,
      cleanText(row[idx.name]),
      candidateType,
      idx.institutionCode >= 0 ? cleanText(row[idx.institutionCode]) : "",
      idx.institutionName >= 0 ? cleanText(row[idx.institutionName]) : "",
      status,
      numericMarks,
      idx.maxMarks >= 0 ? toInteger(row[idx.maxMarks]) : null,
      idx.percentage >= 0 ? toPercent(row[idx.percentage]) : null,
      idx.grade >= 0 ? cleanText(row[idx.grade]) : "",
      idx.failedCount >= 0 ? toInteger(row[idx.failedCount]) || 0 : 0,
      idx.partICodes >= 0 ? cleanText(row[idx.partICodes]) : "",
      idx.partINames >= 0 ? cleanText(row[idx.partINames]) : "",
      idx.partIICodes >= 0 ? cleanText(row[idx.partIICodes]) : "",
      idx.partIINames >= 0 ? cleanText(row[idx.partIINames]) : "",
      idx.allFailedCodes >= 0 ? cleanText(row[idx.allFailedCodes]) : "",
      idx.allFailedNames >= 0 ? cleanText(row[idx.allFailedNames]) : "",
      idx.statusFlags >= 0 ? cleanText(row[idx.statusFlags]) : "",
      idx.resultPartIRaw >= 0 ? cleanText(row[idx.resultPartIRaw]) : "",
      idx.resultPartIIRaw >= 0 ? cleanText(row[idx.resultPartIIRaw]) : "",
      idx.rawResult >= 0 ? cleanText(row[idx.rawResult]) : "",
      idx.pdfPage >= 0 ? toInteger(row[idx.pdfPage]) : null,
      idx.pdfColumn >= 0 ? toInteger(row[idx.pdfColumn]) : null,
      idx.unknownItems >= 0 ? cleanText(row[idx.unknownItems]) : "",
    ];

    index.set(roll, compact.length);
    compact.push(record);

    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    if (candidateType) typeCounts.set(candidateType, (typeCounts.get(candidateType) || 0) + 1);
    if (status === "PASS") passed += 1;
    if (status === "FAIL/SLIP") failSlip += 1;
    if (status === "ABSENT") absent += 1;
    if (status === "CANCELLED") cancelled += 1;
    if (numericMarks !== null) marks.push(numericMarks);
  }

  marks.sort((a, b) => a - b);
  const appeared = compact.length - absent - cancelled;
  const averageMarks = marks.length ? marks.reduce((sum, value) => sum + value, 0) / marks.length : null;
  const medianMarks = marks.length
    ? marks.length % 2
      ? marks[(marks.length - 1) / 2]
      : (marks[marks.length / 2 - 1] + marks[marks.length / 2]) / 2
    : null;

  students = compact;
  rollIndex = index;

  return {
    totalExtracted: compact.length,
    appeared,
    passed,
    notPassed: Math.max(0, appeared - passed),
    failSlip,
    absent,
    cancelled,
    passPercentage: appeared ? (passed / appeared) * 100 : null,
    highestMarks: marks.length ? marks[marks.length - 1] : null,
    averageMarks,
    medianMarks,
    statusCounts: Array.from(statusCounts, ([statusName, count]) => ({ status: statusName, count })),
    typeValues: Array.from(typeCounts.keys()).sort(),
  };
}

function parseSimpleTable(workbook, sheetName) {
  const rows = sheetRows(workbook, sheetName);
  if (rows.length < 2) return [];
  const headers = rows[0].map(cleanText);
  return rows.slice(1).filter((row) => row.some((value) => cleanText(value) !== "")).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      if (header) object[header] = row[index] ?? "";
    });
    return object;
  });
}

function parseStatusSummary(workbook, fallbackStatusCounts, totalExtracted, appeared) {
  const rows = parseSimpleTable(workbook, "Status_Summary");
  if (!rows.length) {
    return fallbackStatusCounts.map((row) => ({
      status: row.status,
      students: row.count,
      percentExtracted: totalExtracted ? (row.count / totalExtracted) * 100 : 0,
      percentAppeared: appeared ? (row.count / appeared) * 100 : 0,
    }));
  }
  return rows.map((row) => ({
    status: cleanText(row.Status),
    students: toInteger(row.Students) || 0,
    percentExtracted: toPercent(row["% of extracted"]) || 0,
    percentAppeared: toPercent(row["% of appeared"]) || 0,
  })).filter((row) => row.status);
}

function parseSubjectFailures(workbook) {
  return parseSimpleTable(workbook, "Subject_Failures").map((row) => ({
    code: cleanText(row["Subject Code"]),
    name: cleanText(row["Subject Name"]),
    part1: toInteger(row["Part I Entries"]) || 0,
    part2: toInteger(row["Part II Entries"]) || 0,
    total: toInteger(row["Total Entries"]) || 0,
    uniqueStudents: toInteger(row["Unique Students"]) || 0,
  })).filter((row) => row.code || row.name);
}

function parseMarksDistribution(workbook) {
  const rows = sheetRows(workbook, "Marks_Distribution");
  if (!rows.length) return { ranges: [], grades: [] };

  const ranges = [];
  const grades = [];
  let gradeHeaderIndex = -1;

  for (let i = 1; i < rows.length; i += 1) {
    const first = cleanText(rows[i][0]);
    if (lower(first) === "grade") {
      gradeHeaderIndex = i;
      break;
    }
    if (/^\d+\s*-\s*\d+$/.test(first)) {
      ranges.push({
        range: first,
        students: toInteger(rows[i][1]) || 0,
        percent: toPercent(rows[i][2]) || 0,
      });
    }
  }

  if (gradeHeaderIndex >= 0) {
    for (let i = gradeHeaderIndex + 1; i < rows.length; i += 1) {
      const grade = cleanText(rows[i][0]);
      if (!grade) continue;
      if (!["A+", "A", "B", "C", "D", "E", "F"].includes(grade)) continue;
      grades.push({
        grade,
        students: toInteger(rows[i][1]) || 0,
        percent: toPercent(rows[i][2]) || 0,
      });
    }
  }

  return { ranges, grades };
}

function parseTopStudents(workbook) {
  return parseSimpleTable(workbook, "Top_Students").map((row) => ({
    rank: toInteger(row.Rank),
    roll: cleanText(row["Roll No"]),
    name: cleanText(row["Candidate Name"]),
    marks: toInteger(row.Marks),
    percentage: toPercent(row.Percentage),
    grade: cleanText(row.Grade),
    institutionCode: cleanText(row["Institution Code"]),
    institutionName: cleanText(row["Institution Name"]),
  })).filter((row) => row.roll).slice(0, 100);
}

function parseCandidateTypes(workbook) {
  return parseSimpleTable(workbook, "Candidate_Type").map((row) => ({
    type: cleanText(row["Candidate Type"]),
    extracted: toInteger(row.Extracted) || 0,
    passed: toInteger(row.Passed) || 0,
    other: toInteger(row["Not Passed / Other"]) || 0,
    passPercentage: toPercent(row["Pass %"]) || 0,
  })).filter((row) => row.type);
}

function parseInstitutions(workbook) {
  return parseSimpleTable(workbook, "Institute_Summary").map((row) => ({
    code: cleanText(row["Institution Code"]),
    name: cleanText(row["Institution Name"]),
    candidates: toInteger(row.Candidates) || 0,
    passed: toInteger(row.Passed) || 0,
    failSlip: toInteger(row["Fail/Slip"]) || 0,
    absent: toInteger(row.Absent) || 0,
    resultLater: toInteger(row["Result Later"]) || 0,
    other: toInteger(row.Other) || 0,
    passPercentage: toPercent(row["Pass %"]) || 0,
    averageMarks: toNumber(row["Average Marks (passed)"]),
    highestMarks: toInteger(row["Highest Marks"]),
  })).filter((row) => row.code || row.name);
}

function parseDataQuality(workbook) {
  const rows = sheetRows(workbook, "Data_Quality");
  if (!rows.length) return [];
  const result = [];
  for (let i = 1; i < rows.length; i += 1) {
    const check = cleanText(rows[i][0]);
    const value = rows[i][1];
    const notes = cleanText(rows[i][2]);
    if (!check) continue;
    if (lower(check) === "unknown result item") break;
    result.push({ check, value: cleanText(value), notes });
  }
  return result;
}

function buildInsights(summary, statusSummary, subjects, institutions, topStudents, quality) {
  const statusMap = new Map(statusSummary.map((row) => [row.status, row.students]));
  const topSubject = [...subjects].sort((a, b) => b.uniqueStudents - a.uniqueStudents)[0] || null;
  const eligibleSchools = institutions.filter((school) => school.candidates >= 20);
  const bestPassSchool = [...eligibleSchools].sort((a, b) => b.passPercentage - a.passPercentage || b.candidates - a.candidates)[0] || null;
  const largestSchool = [...institutions].sort((a, b) => b.candidates - a.candidates)[0] || null;
  const bestAverageSchool = [...eligibleSchools].filter((school) => school.averageMarks !== null).sort((a, b) => b.averageMarks - a.averageMarks)[0] || null;
  const qualityWarnings = quality.filter((item) => {
    const numeric = toNumber(item.value);
    return numeric !== null && numeric > 0 && /duplicate|missing|unknown|unmapped/i.test(item.check);
  }).length;

  return [
    {
      title: "Overall pass performance",
      text: `${formatNumber(summary.passed)} of ${formatNumber(summary.appeared)} appeared candidates passed, producing a ${formatPercent(summary.passPercentage)} pass rate.`,
    },
    {
      title: "Students needing another attempt",
      text: `${formatNumber(summary.notPassed)} appeared candidates did not pass. ${formatNumber(summary.failSlip)} were directly classified as fail or subject-slip cases.`,
    },
    {
      title: "Highest recorded score",
      text: topStudents.length
        ? `${topStudents[0].name || "The leading candidate"} (${topStudents[0].roll}) recorded ${formatNumber(summary.highestMarks)} marks.`
        : `The highest numeric result in the workbook is ${formatNumber(summary.highestMarks)} marks.`,
    },
    {
      title: "Most common slip subject",
      text: topSubject
        ? `${topSubject.name || topSubject.code} affected ${formatNumber(topSubject.uniqueStudents)} unique students across ${formatNumber(topSubject.total)} entries.`
        : "No subject-slip summary is available.",
    },
    {
      title: "Highest qualifying school pass rate",
      text: bestPassSchool
        ? `${bestPassSchool.name} achieved ${formatPercent(bestPassSchool.passPercentage)} among ${formatNumber(bestPassSchool.candidates)} candidates.`
        : "No institution satisfies the minimum 20-candidate comparison rule.",
    },
    {
      title: "Largest institution by candidates",
      text: largestSchool
        ? `${largestSchool.name} has ${formatNumber(largestSchool.candidates)} extracted candidate records and ${formatPercent(largestSchool.passPercentage)} pass performance.`
        : "Institution summary data is unavailable.",
    },
    {
      title: "Strongest average marks",
      text: bestAverageSchool
        ? `${bestAverageSchool.name} has the highest average numeric marks (${formatDecimal(bestAverageSchool.averageMarks)}) among institutions with at least 20 candidates.`
        : "Average school marks are unavailable.",
    },
    {
      title: "Special result cases",
      text: `${formatNumber(statusMap.get("ABSENT") || 0)} absent, ${formatNumber(statusMap.get("RESULT_LATER") || 0)} result-later, and ${formatNumber(statusMap.get("CANCELLED") || 0)} cancelled records were retained.`,
    },
    {
      title: "Extraction quality signals",
      text: qualityWarnings
        ? `${qualityWarnings} quality checks contain a non-zero missing, duplicate, unknown, or unmapped value. Review the Data quality page.`
        : "No non-zero warning was detected in the main quality checks.",
    },
  ];
}

function formatNumber(value) {
  const number = toNumber(value);
  return number === null ? "—" : Math.round(number).toLocaleString("en-US");
}

function formatDecimal(value) {
  const number = toNumber(value);
  return number === null ? "—" : number.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatPercent(value) {
  const number = toNumber(value);
  return number === null ? "—" : `${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function studentObject(record) {
  return {
    roll: record[STUDENT_FIELDS.roll],
    name: record[STUDENT_FIELDS.name],
    type: record[STUDENT_FIELDS.type],
    institutionCode: record[STUDENT_FIELDS.institutionCode],
    institutionName: record[STUDENT_FIELDS.institutionName],
    status: record[STUDENT_FIELDS.status],
    marks: record[STUDENT_FIELDS.marks],
    maxMarks: record[STUDENT_FIELDS.maxMarks],
    percentage: record[STUDENT_FIELDS.percentage],
    grade: record[STUDENT_FIELDS.grade],
    failedCount: record[STUDENT_FIELDS.failedCount],
    partICodes: record[STUDENT_FIELDS.partICodes],
    partINames: record[STUDENT_FIELDS.partINames],
    partIICodes: record[STUDENT_FIELDS.partIICodes],
    partIINames: record[STUDENT_FIELDS.partIINames],
    allFailedCodes: record[STUDENT_FIELDS.allFailedCodes],
    allFailedNames: record[STUDENT_FIELDS.allFailedNames],
    statusFlags: record[STUDENT_FIELDS.statusFlags],
    resultPartIRaw: record[STUDENT_FIELDS.resultPartIRaw],
    resultPartIIRaw: record[STUDENT_FIELDS.resultPartIIRaw],
    rawResult: record[STUDENT_FIELDS.rawResult],
    pdfPage: record[STUDENT_FIELDS.pdfPage],
    pdfColumn: record[STUDENT_FIELDS.pdfColumn],
    unknownItems: record[STUDENT_FIELDS.unknownItems],
  };
}

function matchesStudent(record, filters) {
  const query = lower(filters.query);
  const field = filters.field || "all";
  const status = cleanText(filters.status);
  const grade = cleanText(filters.grade);
  const candidateType = cleanText(filters.candidateType);
  const schoolFilter = lower(filters.school);
  const minMarks = toNumber(filters.minMarks);
  const maxMarks = toNumber(filters.maxMarks);

  if (status && record[STUDENT_FIELDS.status] !== status) return false;
  if (grade && record[STUDENT_FIELDS.grade] !== grade) return false;
  if (candidateType && record[STUDENT_FIELDS.type] !== candidateType) return false;
  if (schoolFilter && !lower(record[STUDENT_FIELDS.institutionName]).includes(schoolFilter)) return false;

  const marks = record[STUDENT_FIELDS.marks];
  if (minMarks !== null && (marks === null || marks < minMarks)) return false;
  if (maxMarks !== null && (marks === null || marks > maxMarks)) return false;

  if (!query) return true;

  if (field === "roll") return lower(record[STUDENT_FIELDS.roll]).includes(query);
  if (field === "name") return lower(record[STUDENT_FIELDS.name]).includes(query);
  if (field === "school") {
    return lower(`${record[STUDENT_FIELDS.institutionCode]} ${record[STUDENT_FIELDS.institutionName]}`).includes(query);
  }
  if (field === "subject") {
    return lower(`${record[STUDENT_FIELDS.allFailedCodes]} ${record[STUDENT_FIELDS.allFailedNames]} ${record[STUDENT_FIELDS.partINames]} ${record[STUDENT_FIELDS.partIINames]}`).includes(query);
  }

  return lower([
    record[STUDENT_FIELDS.roll],
    record[STUDENT_FIELDS.name],
    record[STUDENT_FIELDS.institutionCode],
    record[STUDENT_FIELDS.institutionName],
    record[STUDENT_FIELDS.status],
    record[STUDENT_FIELDS.grade],
    record[STUDENT_FIELDS.allFailedCodes],
    record[STUDENT_FIELDS.allFailedNames],
  ].join(" ")).includes(query);
}

function searchStudents(requestId, filters, page, pageSize) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(10, Math.min(500, Number(pageSize) || 50));
  const start = (safePage - 1) * safePageSize;
  const end = start + safePageSize;
  const results = [];
  let total = 0;

  const exactRoll = filters.field === "roll" && /^\d{5,8}$/.test(cleanText(filters.query));
  if (exactRoll && !filters.status && !filters.grade && !filters.candidateType && !filters.school && !filters.minMarks && !filters.maxMarks) {
    const index = rollIndex.get(cleanText(filters.query));
    if (index !== undefined) {
      results.push(studentObject(students[index]));
      total = 1;
    }
  } else {
    for (const record of students) {
      if (!matchesStudent(record, filters)) continue;
      if (total >= start && total < end) results.push(studentObject(record));
      total += 1;
    }
  }

  self.postMessage({
    type: "studentResults",
    requestId,
    results,
    total,
    page: safePage,
    pageSize: safePageSize,
    pages: Math.max(1, Math.ceil(total / safePageSize)),
  });
}

function csvEscape(value) {
  const text = cleanText(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportFilteredStudents(requestId, filters, limit) {
  const safeLimit = Math.max(1, Math.min(100000, Number(limit) || 50000));
  const header = [
    "Roll No",
    "Candidate Name",
    "Candidate Type",
    "Institution Code",
    "Institution Name",
    "Status",
    "Marks",
    "Percentage",
    "Grade",
    "Failed Subject Count",
    "Part-I Failed Subjects",
    "Part-II Failed Subjects",
    "All Failed Subjects",
    "PDF Page",
  ];
  const lines = [header.map(csvEscape).join(",")];
  let matched = 0;
  let exported = 0;

  for (const record of students) {
    if (!matchesStudent(record, filters)) continue;
    matched += 1;
    if (exported >= safeLimit) continue;
    const row = [
      record[STUDENT_FIELDS.roll],
      record[STUDENT_FIELDS.name],
      record[STUDENT_FIELDS.type],
      record[STUDENT_FIELDS.institutionCode],
      record[STUDENT_FIELDS.institutionName],
      record[STUDENT_FIELDS.status],
      record[STUDENT_FIELDS.marks] ?? "",
      record[STUDENT_FIELDS.percentage] ?? "",
      record[STUDENT_FIELDS.grade],
      record[STUDENT_FIELDS.failedCount],
      record[STUDENT_FIELDS.partINames],
      record[STUDENT_FIELDS.partIINames],
      record[STUDENT_FIELDS.allFailedNames],
      record[STUDENT_FIELDS.pdfPage] ?? "",
    ];
    lines.push(row.map(csvEscape).join(","));
    exported += 1;
  }

  const csv = `\uFEFF${lines.join("\r\n")}`;
  self.postMessage({ type: "exportReady", requestId, csv, matched, exported, truncated: matched > exported });
}

async function loadWorkbook(buffer, fileName) {
  sourceFileName = fileName || "result-workbook.xlsx";
  postProgress(5, "Reading Excel file");
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    dense: true,
  });

  postProgress(20, "Parsing student records");
  const computedSummary = parseStudents(workbook);

  postProgress(53, "Reading result summaries");
  const statusSummary = parseStatusSummary(
    workbook,
    computedSummary.statusCounts,
    computedSummary.totalExtracted,
    computedSummary.appeared,
  );
  const subjectFailures = parseSubjectFailures(workbook);
  const marksDistribution = parseMarksDistribution(workbook);

  postProgress(68, "Reading schools and candidate groups");
  const candidateTypes = parseCandidateTypes(workbook);
  const institutions = parseInstitutions(workbook);
  const topStudents = parseTopStudents(workbook);

  postProgress(82, "Calculating dashboard insights");
  const dataQuality = parseDataQuality(workbook);
  const insights = buildInsights(
    computedSummary,
    statusSummary,
    subjectFailures,
    institutions,
    topStudents,
    dataQuality,
  );

  const schoolCandidates = institutions.map((school) => school.candidates).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const medianSchoolSize = schoolCandidates.length
    ? schoolCandidates.length % 2
      ? schoolCandidates[(schoolCandidates.length - 1) / 2]
      : (schoolCandidates[schoolCandidates.length / 2 - 1] + schoolCandidates[schoolCandidates.length / 2]) / 2
    : null;

  const summary = {
    ...computedSummary,
    schoolCount: institutions.length,
    subjectCount: subjectFailures.length,
    medianSchoolSize,
  };

  summaryPayload = {
    sourceFileName,
    summary,
    statusSummary,
    subjectFailures,
    marksDistribution,
    candidateTypes,
    institutions,
    topStudents,
    dataQuality,
    insights,
    filterOptions: {
      statuses: statusSummary.map((row) => row.status).filter(Boolean).sort(),
      candidateTypes: computedSummary.typeValues,
    },
  };

  postProgress(100, "Dashboard ready");
  self.postMessage({ type: "ready", payload: summaryPayload });
}

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === "loadWorkbook") {
      await loadWorkbook(message.buffer, message.fileName);
      return;
    }
    if (message.type === "searchStudents") {
      if (!students.length) throw new Error("Load a workbook before searching students.");
      searchStudents(message.requestId, message.filters || {}, message.page, message.pageSize);
      return;
    }
    if (message.type === "getStudent") {
      const index = rollIndex.get(cleanText(message.roll));
      self.postMessage({
        type: "studentDetail",
        requestId: message.requestId,
        student: index === undefined ? null : studentObject(students[index]),
      });
      return;
    }
    if (message.type === "exportStudents") {
      if (!students.length) throw new Error("Load a workbook before exporting students.");
      exportFilteredStudents(message.requestId, message.filters || {}, message.limit);
      return;
    }
    if (message.type === "getSummary") {
      self.postMessage({ type: "ready", payload: summaryPayload });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: message.requestId || null,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : "",
    });
  }
};
